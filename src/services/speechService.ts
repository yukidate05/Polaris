import * as Speech from 'expo-speech';

export type SpeechRate = 0.75 | 1.0 | 1.25 | 1.5 | 1.75 | 2.0;
export const SPEECH_RATES: SpeechRate[] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export interface SpeechCallbacks {
  onProgress?: (charIndex: number, totalChars: number) => void;
  onDone?:     () => void;
  onError?:    (err: string) => void;
}

const MAX_CHUNK = 3800; // ExpoSpeech limit is 4000; stay conservative

function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (start + MAX_CHUNK >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    const seg = text.slice(start, start + MAX_CHUNK);
    const lastPunct = Math.max(seg.lastIndexOf('。'), seg.lastIndexOf('！'), seg.lastIndexOf('？'));
    const cut = lastPunct > 0 ? lastPunct + 1 : MAX_CHUNK;
    chunks.push(text.slice(start, start + cut));
    start += cut;
  }
  return chunks;
}

class SpeechService {
  private _progressTimer: ReturnType<typeof setInterval> | null = null;
  private _startTime  = 0;
  private _totalMs    = 0;
  private _totalChars = 0;
  private _rate: SpeechRate = 1.0;
  private _stopped = false;

  async speak(text: string, rate: SpeechRate = 1.0, callbacks: SpeechCallbacks = {}): Promise<void> {
    await this.stop();
    this._stopped    = false;
    this._rate       = rate;
    this._totalChars = text.length;
    this._startTime  = Date.now();
    this._totalMs    = (text.length / (5 * rate)) * 1000;

    this._startProgressTimer(callbacks.onProgress);
    this._speakChunks(splitIntoChunks(text), 0, rate, callbacks);
  }

  private _speakChunks(chunks: string[], idx: number, rate: SpeechRate, cb: SpeechCallbacks): void {
    if (this._stopped || idx >= chunks.length) {
      if (!this._stopped) {
        this._stopTimer();
        cb.onProgress?.(this._totalChars, this._totalChars);
        cb.onDone?.();
      }
      return;
    }
    Speech.speak(chunks[idx], {
      language: 'ja-JP',
      rate,
      onDone:  () => { this._speakChunks(chunks, idx + 1, rate, cb); },
      onError: (err) => { this._stopTimer(); cb.onError?.(String(err)); },
    });
  }

  async stop(): Promise<void> {
    this._stopped = true;
    this._stopTimer();
    await Speech.stop();
  }

  async isSpeaking(): Promise<boolean> {
    return Speech.isSpeakingAsync();
  }

  getProgress(): { charIndex: number; totalChars: number; elapsedMs: number; totalMs: number } {
    const elapsedMs = Date.now() - this._startTime;
    const charIndex = this._totalMs > 0
      ? Math.min(Math.floor((elapsedMs / this._totalMs) * this._totalChars), this._totalChars)
      : 0;
    return { charIndex, totalChars: this._totalChars, elapsedMs, totalMs: this._totalMs };
  }

  private _startProgressTimer(onProgress?: (charIndex: number, totalChars: number) => void) {
    this._progressTimer = setInterval(() => {
      const { charIndex, totalChars } = this.getProgress();
      onProgress?.(charIndex, totalChars);
    }, 300);
  }

  private _stopTimer() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  }
}

export const speechService = new SpeechService();

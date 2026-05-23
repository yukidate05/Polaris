import * as Speech from 'expo-speech';

export type SpeechRate = 0.75 | 1.0 | 1.25 | 1.5 | 1.75 | 2.0;
export const SPEECH_RATES: SpeechRate[] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export interface SpeechCallbacks {
  onProgress?: (charIndex: number, totalChars: number) => void;
  onDone?:     () => void;
  onError?:    (err: string) => void;
}

class SpeechService {
  private _progressTimer: ReturnType<typeof setInterval> | null = null;
  private _startTime = 0;
  private _totalMs   = 0;
  private _totalChars = 0;
  private _rate: SpeechRate = 1.0;

  async speak(text: string, rate: SpeechRate = 1.0, callbacks: SpeechCallbacks = {}): Promise<void> {
    await this.stop();

    this._rate       = rate;
    this._totalChars = text.length;
    this._startTime  = Date.now();
    // Japanese TTS: ~5 chars/sec at 1.0x
    this._totalMs = (text.length / (5 * rate)) * 1000;

    this._startProgressTimer(callbacks.onProgress);

    Speech.speak(text, {
      language: 'ja-JP',
      rate,
      onDone: () => {
        this._stopTimer();
        callbacks.onProgress?.(this._totalChars, this._totalChars);
        callbacks.onDone?.();
      },
      onError: (err) => {
        this._stopTimer();
        callbacks.onError?.(String(err));
      },
    });
  }

  async stop(): Promise<void> {
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

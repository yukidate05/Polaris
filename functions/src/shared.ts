// Shared infrastructure for HTTP endpoints (index.ts) and the briefing worker
// (briefingWorker.ts). initializeApp() must run exactly once, before any
// getFirestore/getStorage call — importing this module guarantees that.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret } from 'firebase-functions/params';
import { randomUUID } from 'crypto';

initializeApp();
export const db = getFirestore();

export const GEMINI_KEY = defineSecret('GEMINI_API_KEY');

export const BUCKET_NAME = 'polaris-app-yukid.firebasestorage.app';

// ── Subscription check (server-authoritative) ─────────────────────────────────
const TRIAL_DAYS         = 5;
const FREE_COOLDOWN_DAYS = 3;

export async function checkSubscription(uid: string): Promise<{ allowed: boolean; message: string }> {
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.data() ?? {};

  if (data.plan === 'pro') return { allowed: true, message: 'pro' };

  const firstOpenedAt: Date = data.firstOpenedAt?.toDate?.() ?? new Date();
  const trialEnd = new Date(firstOpenedAt.getTime() + TRIAL_DAYS * 86_400_000);
  if (new Date() < trialEnd) return { allowed: true, message: 'trial' };

  const lastFreeUseAt: Date | null = data.lastFreeUseAt?.toDate?.() ?? null;
  if (!lastFreeUseAt) return { allowed: true, message: 'free_first' };

  const lastDay = new Date(lastFreeUseAt);
  lastDay.setHours(0, 0, 0, 0);
  const nextFreeDay = new Date(lastDay);
  nextFreeDay.setDate(nextFreeDay.getDate() + FREE_COOLDOWN_DAYS);
  if (new Date() < nextFreeDay) return { allowed: false, message: 'cooldown_active' };

  return { allowed: true, message: 'free' };
}

// ── Gemini text generation ────────────────────────────────────────────────────
export async function callGeminiApi(
  prompt: string,
  systemPrompt: string,
  useSearch: boolean,
  apiKey: string,
): Promise<string> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: useSearch ? {} : { responseMimeType: 'application/json' },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`gemini:${response.status} ${err.slice(0, 300)}`);
  }

  const data  = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  // thought=true parts are thinking tokens; prefer the non-thought part containing "chapters"
  const withJson = parts.find(p => !p.thought && p.text?.includes('"chapters"'));
  const anyText  = parts.find(p => !p.thought && p.text);
  return withJson?.text ?? anyText?.text ?? parts[0]?.text ?? '';
}

// ── JSON / chapter parsing (mirrors client claudeService) ─────────────────────
export interface DialogueTurn { speaker: 'A' | 'B'; text: string }
export interface ChapterDraft {
  id:       string;
  title:    string;
  iconName: string;
  text:     string;
  dialogue: DialogueTurn[];
}

export function extractJsonFromText(text: string): string | null {
  try { JSON.parse(text); return text; } catch { /* fall through */ }
  let depth = 0, end = -1, start = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') { if (end === -1) end = i; depth++; }
    else if (c === '{') { depth--; if (depth === 0) { start = i; break; } }
  }
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);
  return null;
}

export function parseChapters(text: string): ChapterDraft[] {
  const jsonStr = extractJsonFromText(text);
  if (!jsonStr) throw new Error('gemini_parse');
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(jsonStr); } catch { throw new Error('gemini_parse_json'); }
  const chapters = (parsed.chapters
    ?? (parsed as { briefing?: { chapters?: unknown } }).briefing?.chapters
    ?? (parsed as { script?: { chapters?: unknown } }).script?.chapters) as unknown[];
  if (!Array.isArray(chapters)) throw new Error('gemini_parse_no_chapters');
  return chapters.map((c) => {
    const ch = c as ChapterDraft;
    return { ...ch, text: (ch.dialogue ?? []).map((t) => t.text).join('　') };
  });
}

// Split long dialogue turns at sentence boundaries (mirrors client briefingService)
export function splitTurns(turns: DialogueTurn[], maxLen = 80): DialogueTurn[] {
  const result: DialogueTurn[] = [];
  for (const turn of turns) {
    if (turn.text.length <= maxLen) { result.push(turn); continue; }
    const segs = turn.text.split(/(?<=。|！|？|…|。」|！」|？」)/);
    let chunk = '';
    for (const seg of segs) {
      if (chunk.length + seg.length > maxLen && chunk.length > 0) {
        result.push({ speaker: turn.speaker, text: chunk });
        chunk = seg;
      } else {
        chunk += seg;
      }
    }
    if (chunk.trim()) result.push({ speaker: turn.speaker, text: chunk });
  }
  return result;
}

// ── WAV / TTS helpers ─────────────────────────────────────────────────────────
export function buildWavHeader(pcmLength: number): Buffer {
  const sampleRate    = 24000;
  const bitsPerSample = 16;
  const channels      = 1;
  const byteRate      = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign    = channels * (bitsPerSample / 8);
  const buf           = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(pcmLength, 40);
  return buf;
}

// PCM 24kHz 16-bit mono → duration in seconds
export function wavDurationSec(pcmLength: number): number {
  return Math.round(pcmLength / (24000 * 2));
}

// Gemini multi-speaker TTS → WAV buffer. Throws on failure.
export async function synthesizeGeminiTtsWav(
  transcript: string,
  speakerConfigs: { speaker: string; voice: string }[],
  apiKey: string,
): Promise<{ wav: Buffer; durationSec: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: transcript }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakerConfigs.map(sc => ({
              speaker:     sc.speaker,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: sc.voice } },
            })),
          },
        },
      },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`gemini-tts:${response.status} ${err.slice(0, 200)}`);
  }
  const data = await response.json() as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const pcmBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? '';
  if (!pcmBase64) throw new Error('gemini-tts:no_audio_data');
  const pcm = Buffer.from(pcmBase64, 'base64');
  return { wav: Buffer.concat([buildWavHeader(pcm.length), pcm]), durationSec: wavDurationSec(pcm.length) };
}

// ── Google Cloud TTS fallback ─────────────────────────────────────────────────
const GOOGLE_TTS_SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
export const GOOGLE_VOICES_BY_LANG: Record<string, { A: { languageCode: string; name: string; ssmlGender: 'FEMALE' | 'MALE' }; B: { languageCode: string; name: string; ssmlGender: 'FEMALE' | 'MALE' } }> = {
  ja: { A: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B',  ssmlGender: 'FEMALE' }, B: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-C',  ssmlGender: 'MALE' } },
  en: { A: { languageCode: 'en-US', name: 'en-US-Standard-F', ssmlGender: 'FEMALE' }, B: { languageCode: 'en-US', name: 'en-US-Standard-D', ssmlGender: 'MALE' } },
  zh: { A: { languageCode: 'cmn-CN', name: 'cmn-CN-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'cmn-CN', name: 'cmn-CN-Standard-B', ssmlGender: 'MALE' } },
  ko: { A: { languageCode: 'ko-KR', name: 'ko-KR-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'ko-KR', name: 'ko-KR-Standard-C', ssmlGender: 'MALE' } },
  es: { A: { languageCode: 'es-ES', name: 'es-ES-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'es-ES', name: 'es-ES-Standard-B', ssmlGender: 'MALE' } },
  fr: { A: { languageCode: 'fr-FR', name: 'fr-FR-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'fr-FR', name: 'fr-FR-Standard-B', ssmlGender: 'MALE' } },
  de: { A: { languageCode: 'de-DE', name: 'de-DE-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'de-DE', name: 'de-DE-Standard-B', ssmlGender: 'MALE' } },
  pt: { A: { languageCode: 'pt-BR', name: 'pt-BR-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'pt-BR', name: 'pt-BR-Standard-B', ssmlGender: 'MALE' } },
  it: { A: { languageCode: 'it-IT', name: 'it-IT-Standard-A', ssmlGender: 'FEMALE' }, B: { languageCode: 'it-IT', name: 'it-IT-Standard-B', ssmlGender: 'MALE' } },
};

export async function googleSynthesize(text: string, speaker: 'A' | 'B', apiKey: string, language: string): Promise<Buffer> {
  const voices = GOOGLE_VOICES_BY_LANG[language] ?? GOOGLE_VOICES_BY_LANG.ja;
  const resp = await fetch(`${GOOGLE_TTS_SYNTH_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input:       { text },
      voice:       voices[speaker],
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0.0 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`gcloud-tts:${resp.status} ${body.slice(0, 100)}`);
  }
  const { audioContent } = await resp.json() as { audioContent: string };
  return Buffer.from(audioContent, 'base64');
}

export async function synthesizeGoogleDialogueMp3(
  dialogue: DialogueTurn[],
  apiKey: string,
  language: string,
): Promise<Buffer> {
  const BATCH = 5;
  const segments: Buffer[] = [];
  for (let i = 0; i < dialogue.length; i += BATCH) {
    const batch   = dialogue.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(t => googleSynthesize(t.text, t.speaker, apiKey, language)));
    segments.push(...results);
  }
  return Buffer.concat(segments);
}

// ── Storage upload ────────────────────────────────────────────────────────────
export async function uploadUserAudio(
  uid: string,
  filename: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  const bucket   = getStorage().bucket(BUCKET_NAME);
  const uuid     = randomUUID();
  const fileName = `audio/${uid}/${filename}`;
  await bucket.file(fileName).save(buf, {
    resumable: false,
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: uuid },
    },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET_NAME)}/o/${encodeURIComponent(fileName)}?alt=media&token=${uuid}`;
}

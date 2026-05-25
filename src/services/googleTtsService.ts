import * as FileSystem from 'expo-file-system';
import type { DialogueTurn } from './claudeService';

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

const VOICES = {
  A: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B', ssmlGender: 'FEMALE' }, // Aria
  B: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-C', ssmlGender: 'MALE'   }, // Kai
} as const;

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(arr.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function synthesize(text: string, speaker: 'A' | 'B', apiKey: string): Promise<string> {
  const resp = await fetch(`${TTS_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: VOICES[speaker],
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0.0 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`gcloud-tts:${resp.status} ${body.slice(0, 100)}`);
  }
  const { audioContent } = await resp.json() as { audioContent: string };
  return audioContent; // base64 MP3
}

export const googleTtsService = {
  // Single voice (used as fallback / simple case)
  async generateAudio(text: string): Promise<string> {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_TTS_API_KEY;
    if (!apiKey) throw new Error('no_key');

    const audioContent = await synthesize(text, 'A', apiKey);

    const dir = `${FileSystem.cacheDirectory}polaris_audio/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const path = `${dir}brief_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(path, audioContent, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  },

  // Dual voice: generate each dialogue turn and concatenate MP3 binary
  async generateDialogueAudio(dialogue: DialogueTurn[]): Promise<string> {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_TTS_API_KEY;
    if (!apiKey) throw new Error('no_key');

    // Process in batches of 5 to respect rate limits
    const BATCH = 5;
    const audioSegments: string[] = [];
    for (let i = 0; i < dialogue.length; i += BATCH) {
      const batch = dialogue.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((turn) => synthesize(turn.text, turn.speaker, apiKey))
      );
      audioSegments.push(...results);
    }

    // Concatenate all MP3 binary data
    const uint8Arrays = audioSegments.map(base64ToUint8);
    const totalLen    = uint8Arrays.reduce((sum, a) => sum + a.length, 0);
    const combined    = new Uint8Array(totalLen);
    let offset        = 0;
    for (const arr of uint8Arrays) {
      combined.set(arr, offset);
      offset += arr.length;
    }

    const base64 = uint8ToBase64(combined);
    const dir    = `${FileSystem.cacheDirectory}polaris_audio/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const path   = `${dir}brief_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(path, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  },
};

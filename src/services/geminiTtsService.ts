import * as FileSystem from 'expo-file-system/legacy';
import type { DialogueTurn } from './claudeService';

const TTS_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';

const SPEAKERS = {
  A: { name: 'Aria', voice: 'Aoede' }, // bright female
  B: { name: 'Kai',  voice: 'Puck'  }, // upbeat male
} as const;

function buildWavHeader(pcmLength: number): Uint8Array {
  const sampleRate    = 24000;
  const bitsPerSample = 16;
  const channels      = 1;
  const byteRate      = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign    = channels * (bitsPerSample / 8);

  const buf  = new ArrayBuffer(44);
  const view = new DataView(buf);

  view.setUint32( 0, 0x52494646, false); // "RIFF"
  view.setUint32( 4, 36 + pcmLength, true);
  view.setUint32( 8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);          // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmLength, true);

  return new Uint8Array(buf);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function uint8ToBase64(arr: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk)
    binary += String.fromCharCode(...Array.from(arr.subarray(i, i + chunk)));
  return btoa(binary);
}

export const geminiTtsService = {
  async generateDialogueAudio(dialogue: DialogueTurn[]): Promise<string> {
    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) throw new Error('no_key');

    const transcript = dialogue
      .map((t) => `${SPEAKERS[t.speaker].name}: ${t.text}`)
      .join('\n');

    const body = {
      contents: [{ parts: [{ text: transcript }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: 'Aria', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
              { speaker: 'Kai',  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck'  } } },
            ],
          },
        },
      },
    };

    const resp = await fetch(`${TTS_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`gemini-tts:${resp.status} ${err.slice(0, 150)}`);
    }

    const data = await resp.json();
    const b64  = data.candidates[0].content.parts[0].inlineData.data as string;
    const pcm  = base64ToUint8(b64);

    const wav = new Uint8Array(44 + pcm.length);
    wav.set(buildWavHeader(pcm.length), 0);
    wav.set(pcm, 44);

    const dir  = `${FileSystem.cacheDirectory}polaris_audio/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const path = `${dir}brief_${Date.now()}.wav`;
    await FileSystem.writeAsStringAsync(path, uint8ToBase64(wav), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  },
};

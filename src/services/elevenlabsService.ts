import * as FileSystem from 'expo-file-system/legacy';

const API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// Default Japanese-capable voice (Sarah)
const DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < uint8.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(uint8.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export const elevenlabsService = {
  async generateAudio(text: string): Promise<string> {
    const apiKey  = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
    const voiceId = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE;

    if (!apiKey) throw new Error('no_key');

    const resp = await fetch(`${API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!resp.ok) throw new Error(`elevenlabs:${resp.status}`);

    const arrayBuffer = await resp.arrayBuffer();
    const base64      = arrayBufferToBase64(arrayBuffer);

    const dir = `${FileSystem.cacheDirectory}polaris_audio/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const path = `${dir}brief_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(path, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return path;
  },
};

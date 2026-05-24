import * as FileSystem from 'expo-file-system';

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

export const googleTtsService = {
  async generateAudio(text: string): Promise<string> {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_TTS_API_KEY;
    if (!apiKey) throw new Error('no_key');

    const resp = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'ja-JP',
          name: 'ja-JP-Neural2-C',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.1,
        },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`google-tts:${resp.status}: ${body.slice(0, 200)}`);
    }

    const { audioContent } = await resp.json() as { audioContent: string };

    const dir = `${FileSystem.cacheDirectory}polaris_audio/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const path = `${dir}brief_${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(path, audioContent, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return path;
  },
};

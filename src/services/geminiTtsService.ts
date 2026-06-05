import * as FileSystem from 'expo-file-system/legacy';
import type { DialogueTurn } from './claudeService';
import { getSelectedHosts, DEFAULT_HOST_IDS } from './voiceService';
import { callFunction } from './functionsService';

// Circuit breaker: skip Gemini TTS for the session if quota is exceeded
let quotaExceeded = false;

async function writeAudioFile(base64: string, filename: string): Promise<string> {
  const dir = `${FileSystem.cacheDirectory}polaris_audio/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const path = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export const geminiTtsService = {
  async generatePreview(voiceName: string, text: string): Promise<string> {
    const speakerName = 'Host';
    const { audioBase64 } = await callFunction<{ audioBase64: string; mimeType: string }>(
      'geminiTts',
      { transcript: `${speakerName}: ${text}`, speakerConfigs: [{ speaker: speakerName, voice: voiceName }] }
    );
    return writeAudioFile(audioBase64, `preview_${voiceName}_${Date.now()}.wav`);
  },

  async generateDialogueAudio(
    dialogue: DialogueTurn[],
    hostIds:  string[] = DEFAULT_HOST_IDS,
  ): Promise<string> {
    if (quotaExceeded) throw new Error('gemini-tts:quota_exceeded');

    const [hostA, hostB] = getSelectedHosts(hostIds);
    const transcript = dialogue
      .map(t => `${t.speaker === 'A' ? hostA.name : hostB.name}: ${t.text}`)
      .join('\n');

    try {
      const { audioBase64 } = await callFunction<{ audioBase64: string; mimeType: string }>(
        'geminiTts',
        {
          transcript,
          speakerConfigs: [
            { speaker: hostA.name, voice: hostA.voice },
            { speaker: hostB.name, voice: hostB.voice },
          ],
        }
      );
      return writeAudioFile(audioBase64, `brief_${Date.now()}.wav`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429')) {
        quotaExceeded = true;
        console.warn('[gemini-tts] quota exceeded — switching to Google TTS for this session');
      }
      throw err;
    }
  },
};

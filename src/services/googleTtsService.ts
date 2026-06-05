import * as FileSystem from 'expo-file-system/legacy';
import type { DialogueTurn } from './claudeService';
import { callFunction } from './functionsService';

async function writeAudioFile(base64: string, filename: string): Promise<string> {
  const dir = `${FileSystem.cacheDirectory}polaris_audio/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const path = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export const googleTtsService = {
  async generateAudio(text: string): Promise<string> {
    const { audioBase64 } = await callFunction<{ audioBase64: string }>(
      'googleTts',
      { text }
    );
    return writeAudioFile(audioBase64, `brief_${Date.now()}.mp3`);
  },

  async generateDialogueAudio(dialogue: DialogueTurn[]): Promise<string> {
    const { audioBase64 } = await callFunction<{ audioBase64: string }>(
      'googleTts',
      { dialogue }
    );
    return writeAudioFile(audioBase64, `brief_${Date.now()}.mp3`);
  },
};

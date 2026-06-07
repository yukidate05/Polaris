import type { DialogueTurn } from './claudeService';
import { getSelectedHosts, DEFAULT_HOST_IDS } from './voiceService';
import { callFunction } from './functionsService';

// Circuit breaker: skip Gemini TTS for the session if quota is exceeded
let quotaExceeded = false;

export const geminiTtsService = {
  async generatePreview(voiceName: string, text: string): Promise<string> {
    const speakerName = 'Host';
    const { audioUrl } = await callFunction<{ audioUrl: string; mimeType: string }>(
      'geminiTts',
      { transcript: `${speakerName}: ${text}`, speakerConfigs: [{ speaker: speakerName, voice: voiceName }] },
      'POST',
      60_000,
    );
    return audioUrl;
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
      const { audioUrl } = await callFunction<{ audioUrl: string; mimeType: string }>(
        'geminiTts',
        {
          transcript,
          speakerConfigs: [
            { speaker: hostA.name, voice: hostA.voice },
            { speaker: hostB.name, voice: hostB.voice },
          ],
        },
        'POST',
        280_000, // 280s — Functionのタイムアウト300sより少し短く
      );
      return audioUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // rate_limited は自前レート制限 → セッション無効化しない（次回試行可能にする）
      // 実際のGemini APIクォータ超過のみ quotaExceeded を立てる
      if (msg.includes('429') && !msg.includes('rate_limited') && !msg.includes('cooldown_active')) {
        quotaExceeded = true;
        console.warn('[gemini-tts] Gemini API quota exceeded — switching to Google TTS for this session');
      }
      throw err;
    }
  },
};

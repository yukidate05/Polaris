import { Asset } from 'expo-asset';
import type { SupportedLang } from '@/i18n';

// ニュースパートへの遷移セリフ（固定フレーズ、Aria/AoedeでGemini TTS事前生成）。
// テキストは src/i18n/index.ts の news_transition と同一。差し替え時は両方を更新すること。
const CLIPS: Record<SupportedLang, number> = {
  ja: require('../../assets/audio/transition/transition_ja.wav'),
  en: require('../../assets/audio/transition/transition_en.wav'),
  zh: require('../../assets/audio/transition/transition_zh.wav'),
  ko: require('../../assets/audio/transition/transition_ko.wav'),
  es: require('../../assets/audio/transition/transition_es.wav'),
  it: require('../../assets/audio/transition/transition_it.wav'),
  fr: require('../../assets/audio/transition/transition_fr.wav'),
  de: require('../../assets/audio/transition/transition_de.wav'),
  pt: require('../../assets/audio/transition/transition_pt.wav'),
};

export async function getTransitionAudioUri(lang: string): Promise<string | null> {
  try {
    const asset = Asset.fromModule(CLIPS[lang as SupportedLang] ?? CLIPS.ja);
    await asset.downloadAsync();
    return asset.localUri ?? asset.uri ?? null;
  } catch (e) {
    console.warn('[transitionVoice] load failed:', e);
    return null;
  }
}

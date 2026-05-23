import type { GoogleData } from './googleDataService';
import { claudeService, type ChapterDraft } from './claudeService';
import { elevenlabsService } from './elevenlabsService';

export interface BriefingChapter {
  id:       string;
  title:    string;
  iconName: string;
  text:     string;
  startSec: number;
}

export interface BriefingScript {
  fullText:         string;
  chapters:         BriefingChapter[];
  estimatedSeconds: number;
  audioUri:         string | null; // null → falls back to expo-speech
  topic:            string;        // "今日のブリーフィング" or custom DeepCast topic
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayString(): string {
  const now  = new Date();
  const days = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  return `${now.getMonth() + 1}月${now.getDate()}日、${days[now.getDay()]}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'おはようございます';
  if (h < 17) return 'こんにちは';
  return 'こんばんは';
}

function estimateChapterTimes(texts: string[], totalSec: number): number[] {
  const total = texts.reduce((s, t) => s + t.length, 0);
  let cursor  = 0;
  return texts.map((t) => {
    const start = total > 0 ? Math.floor((cursor / total) * totalSec) : 0;
    cursor += t.length;
    return start;
  });
}

// Template fallback when no Claude API key
function templateChapters(data: GoogleData, userName: string): ChapterDraft[] {
  const g  = greeting();
  const dt = todayString();

  const emailText = data.unreadCount === 0
    ? '未読メールはありません。受信トレイはきれいな状態です。'
    : (() => {
        let t = `未読メールが${data.unreadCount}件あります。`;
        data.topEmails.slice(0, 3).forEach((e, i) => {
          t += `${i + 1}件目は${e.from}さんから「${e.subject}」というメールです。`;
        });
        return t;
      })();

  const calText = data.todayEvents.length === 0
    ? '今日の予定はありません。自由な一日をお楽しみください。'
    : (() => {
        let t = `今日は${data.todayEvents.length}件の予定があります。`;
        data.todayEvents.forEach((ev) => {
          t += `${ev.startTime}から「${ev.title}」`;
          if (ev.location) t += `、${ev.location}で`;
          t += 'があります。';
        });
        return t;
      })();

  return [
    {
      id:       'opening',
      title:    'おはよう',
      iconName: 'sunny-outline',
      text:     `${g}、${userName}さん。今日は${dt}です。Polarisがあなたの今日をまとめました。`,
    },
    {
      id:       'email',
      title:    'メール',
      iconName: 'mail-outline',
      text:     emailText,
    },
    {
      id:       'schedule',
      title:    '予定',
      iconName: 'calendar-outline',
      text:     calText,
    },
    {
      id:       'insights',
      title:    'インサイト',
      iconName: 'bulb-outline',
      text:     '今日も素晴らしい一日をお過ごしください。',
    },
  ];
}

// ── Main service ───────────────────────────────────────────────────────────────

export const briefingService = {
  async generate(
    data:      GoogleData,
    userName:  string,
    interests: string[] = []
  ): Promise<BriefingScript> {
    // Step 1: Generate chapters (Claude or template)
    let rawChapters: ChapterDraft[];
    try {
      const result = await claudeService.generateBriefing({
        userName,
        unreadCount:    data.unreadCount,
        topEmails:      data.topEmails,
        todayEvents:    data.todayEvents,
        tomorrowEvents: data.tomorrowEvents,
        interests,
      });
      rawChapters = result.chapters;
    } catch {
      rawChapters = templateChapters(data, userName);
    }

    const fullText         = rawChapters.map((c) => c.text).join('　');
    const estimatedSeconds = Math.ceil(fullText.length / 5);
    const times            = estimateChapterTimes(rawChapters.map((c) => c.text), estimatedSeconds);

    const chapters: BriefingChapter[] = rawChapters.map((c, i) => ({
      ...c,
      startSec: times[i],
    }));

    // Step 2: Generate audio (ElevenLabs or null → expo-speech fallback)
    let audioUri: string | null = null;
    try {
      audioUri = await elevenlabsService.generateAudio(fullText);
    } catch {
      audioUri = null;
    }

    return {
      fullText,
      chapters,
      estimatedSeconds,
      audioUri,
      topic: '今日のブリーフィング',
    };
  },

  async generateDeepcast(topic: string): Promise<BriefingScript> {
    const result = await claudeService.generateDeepcast(topic);

    const fullText         = result.fullText;
    const estimatedSeconds = Math.ceil(fullText.length / 5);
    const times            = estimateChapterTimes(result.chapters.map((c) => c.text), estimatedSeconds);

    const chapters: BriefingChapter[] = result.chapters.map((c, i) => ({
      ...c,
      startSec: times[i],
    }));

    let audioUri: string | null = null;
    try {
      audioUri = await elevenlabsService.generateAudio(fullText);
    } catch {
      audioUri = null;
    }

    return { fullText, chapters, estimatedSeconds, audioUri, topic };
  },
};

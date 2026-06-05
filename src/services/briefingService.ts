import type { GoogleData } from './googleDataService';
import { claudeService, type ChapterDraft, type DialogueTurn } from './claudeService';
import { geminiTtsService } from './geminiTtsService';
import { googleTtsService } from './googleTtsService';
import { memoryService } from './memoryService';
import type { SessionData } from './sessionService';

export type { DialogueTurn };

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
  audioUri:         string | null;
  topic:            string;
  dialogue:         DialogueTurn[];
}

// Split a long dialogue turn at Japanese sentence boundaries so each chunk
// is ≤ maxLen characters. Applied to both template and Claude-generated content.
function splitTurns(turns: import('./claudeService').DialogueTurn[], maxLen = 80): import('./claudeService').DialogueTurn[] {
  const result: import('./claudeService').DialogueTurn[] = [];
  for (const turn of turns) {
    if (turn.text.length <= maxLen) { result.push(turn); continue; }
    // Split at sentence-ending punctuation, keeping the delimiter
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

function todayString(): string {
  const now  = new Date();
  const days = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  return `${now.getMonth() + 1}月${now.getDate()}日、${days[now.getDay()]}`;
}

function greeting(hour: number): string {
  if (hour < 12) return 'おはようございます';
  if (hour < 17) return 'こんにちは';
  return 'こんばんは';
}

function estimateChapterTimes(texts: string[], totalSec: number): number[] {
  const total  = texts.reduce((s, t) => s + t.length, 0);
  let cursor   = 0;
  return texts.map((t) => {
    const start = total > 0 ? Math.floor((cursor / total) * totalSec) : 0;
    cursor += t.length;
    return start;
  });
}

function templateChapters(data: GoogleData, userName: string): ChapterDraft[] {
  const g  = greeting(new Date().getHours());
  const dt = todayString();
  const d  = (text: string) => [{ speaker: 'A' as const, text }];

  const topMindText = data.unreadCount === 0
    ? `${g}、${userName}さん。今日は${dt}です。未読メールはありません。今日も集中して取り組みましょう。`
    : (() => {
        let t = `${g}、${userName}さん。今日は${dt}です。未読メールが${data.unreadCount}件あります。`;
        data.topEmails.slice(0, 2).forEach(e => { t += `${e.from}さんからの「${e.subject}」は要確認です。`; });
        return t;
      })();

  const scheduleText = data.todayEvents.length === 0
    ? '今日の予定はありません。自由な時間を有効に使いましょう。'
    : (() => {
        let t = `今日は${data.todayEvents.length}件の予定があります。`;
        data.todayEvents.slice(0, 3).forEach(ev => {
          t += `${ev.startTime}から「${ev.title}」${ev.location ? `、${ev.location}で` : ''}があります。`;
        });
        return t;
      })();

  const lookingAheadText = data.tomorrowEvents.length === 0
    ? '明日以降の予定は現在登録されていません。今のうちに準備を進めておきましょう。'
    : (() => {
        let t = '明日以降の予定を確認しましょう。';
        data.tomorrowEvents.slice(0, 2).forEach(ev => { t += `「${ev.title}」があります。`; });
        return t;
      })();

  return [
    { id: 'top_of_mind',   title: '最優先事項',       iconName: 'flame-outline',
      text: topMindText,       dialogue: d(topMindText) },
    { id: 'schedule',      title: '今日のスケジュール', iconName: 'calendar-outline',
      text: scheduleText,      dialogue: d(scheduleText) },
    { id: 'looking_ahead', title: '今後の展望',        iconName: 'telescope-outline',
      text: lookingAheadText,  dialogue: d(lookingAheadText) },
    { id: 'next_steps',    title: '推奨アクション',    iconName: 'checkmark-done-outline',
      text: `今日の${userName}さんへの推奨アクションです。優先度の高いメールへの返信と、今日の予定の最終確認をしておきましょう。`,
      dialogue: d(`今日の${userName}さんへの推奨アクションです。優先度の高いメールへの返信と、今日の予定の最終確認をしておきましょう。`) },
    { id: 'relevant_news', title: '関連ニュース',      iconName: 'newspaper-outline',
      text: '今日の業界動向や関連ニュースをお届けします。気になる情報はあとでチェックしてみてください。',
      dialogue: d('今日の業界動向や関連ニュースをお届けします。気になる情報はあとでチェックしてみてください。') },
  ];
}

export const briefingService = {
  async generate(
    data:        GoogleData,
    userName:    string,
    interests:   string[] = [],
    isReturning: boolean  = false,
    uid?:        string,
    sessionData?: SessionData | null,
    hostIds?:    string[],
    isPro?:      boolean,
    language?:   string,
  ): Promise<BriefingScript> {
    const currentHour = new Date().getHours();

    // 記憶・Notion・Slack・Teams・Chatworkデータを並行読み込み
    const [userContext, notionPages, slackMessages, teamsChats, chatworkMessages] = await Promise.all([
      uid ? memoryService.getContext(uid).catch(() => null) : Promise.resolve(null),
      (async () => {
        try {
          const { notionService } = await import('./notionService');
          const connected = await notionService.isConnected();
          if (!connected) return null;
          return await notionService.getPages();
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { slackService } = await import('./slackService');
          const connected = await slackService.isConnected();
          if (!connected) return null;
          return await slackService.getRecentMessages();
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { teamsService } = await import('./teamsService');
          const connected = await teamsService.isConnected();
          if (!connected) return null;
          return await teamsService.getRecentChats();
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const { chatworkService } = await import('./chatworkService');
          const connected = await chatworkService.isConnected();
          if (!connected) return null;
          return await chatworkService.getRecentMessages();
        } catch {
          return null;
        }
      })(),
    ]);

    let rawChapters: ChapterDraft[];
    try {
      // ブリーフィング + Pro向けニュースキャストを並行生成
      const dataSparse = data.unreadCount <= 1 && data.todayEvents.length <= 1;
      const newsPromise = isPro
        ? claudeService.generateNewsCast({ userName, interests, currentHour, hostIds, language, sparseData: dataSparse })
            .catch((e) => { console.error('[briefing] newsCast failed:', e); return null; })
        : Promise.resolve(null);

      const [briefingResult, newsResult] = await Promise.all([
        claudeService.generateBriefing({
          userName,
          unreadCount:    data.unreadCount,
          topEmails:      data.topEmails,
          todayEvents:    data.todayEvents,
          tomorrowEvents: data.tomorrowEvents,
          interests,
          currentHour,
          isReturning,
          userContext,
          sessionData,
          hostIds,
          language,
          notionPages:       notionPages ?? undefined,
          slackMessages:     slackMessages ?? undefined,
          teamsChats:        teamsChats ?? undefined,
          chatworkMessages:  chatworkMessages ?? undefined,
        }),
        newsPromise,
      ]);

      rawChapters = [
        ...briefingResult.chapters,
        ...(newsResult?.chapters ?? []),
      ];
    } catch (err) {
      console.error('[briefing] script generation failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('quota')) throw err;
      rawChapters = templateChapters(data, userName);
    }

    const fullText         = rawChapters.map((c) => c.text).join('　');
    const estimatedSeconds = Math.ceil(fullText.length / 5);
    const times            = estimateChapterTimes(rawChapters.map((c) => c.text), estimatedSeconds);

    const chapters: BriefingChapter[] = rawChapters.map((c, i) => ({
      id:       c.id,
      title:    c.title,
      iconName: c.iconName,
      text:     c.text,
      startSec: times[i],
    }));

    // Build flat dialogue from all chapters, splitting any long turns
    const allDialogue = splitTurns(rawChapters.flatMap((c) => c.dialogue ?? []));

    console.log('[briefing] dialogue turns:', allDialogue.length, 'fullText length:', fullText.length);

    let audioUri: string | null = null;
    try {
      audioUri = allDialogue.length > 0
        ? await geminiTtsService.generateDialogueAudio(allDialogue, hostIds)
        : await googleTtsService.generateAudio(fullText);
    } catch (err) {
      console.error('[briefing] Gemini TTS failed, falling back to Google TTS:', err);
      try {
        audioUri = allDialogue.length > 0
          ? await googleTtsService.generateDialogueAudio(allDialogue)
          : await googleTtsService.generateAudio(fullText);
      } catch (err2) {
        console.error('[briefing] TTS fallback also failed:', err2);
        audioUri = null;
      }
    }

    console.log('[briefing] audioUri:', audioUri);

    // 記憶を非同期で更新（ブリーフィング返却をブロックしない）
    if (uid) {
      memoryService.extractAndSave(uid, data, userContext).catch((e) =>
        console.error('[memory] background update failed:', e)
      );
    }

    return { fullText, chapters, estimatedSeconds, audioUri, topic: '今日のブリーフィング', dialogue: allDialogue };
  },

  async generateDeepcast(topic: string): Promise<BriefingScript> {
    const result = await claudeService.generateDeepcast(topic);

    const fullText         = result.fullText;
    const estimatedSeconds = Math.ceil(fullText.length / 5);
    const times            = estimateChapterTimes(result.chapters.map((c) => c.text), estimatedSeconds);

    const chapters: BriefingChapter[] = result.chapters.map((c, i) => ({
      id:       c.id,
      title:    c.title,
      iconName: c.iconName,
      text:     c.text,
      startSec: times[i],
    }));

    const allDialogue = result.chapters.flatMap((c) => c.dialogue ?? []);

    let audioUri: string | null = null;
    try {
      audioUri = allDialogue.length > 0
        ? await geminiTtsService.generateDialogueAudio(allDialogue)
        : await googleTtsService.generateAudio(fullText);
    } catch (err) {
      console.error('[deepcast] Gemini TTS failed, falling back:', err);
      try {
        audioUri = allDialogue.length > 0
          ? await googleTtsService.generateDialogueAudio(allDialogue)
          : await googleTtsService.generateAudio(fullText);
      } catch {
        audioUri = null;
      }
    }

    return { fullText, chapters, estimatedSeconds, audioUri, topic, dialogue: allDialogue };
  },
};

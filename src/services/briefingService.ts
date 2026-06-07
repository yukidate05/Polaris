import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import type { GoogleData } from './googleDataService';
import { claudeService, type ChapterDraft, type DialogueTurn } from './claudeService';
import { geminiTtsService } from './geminiTtsService';
import { googleTtsService } from './googleTtsService';
import { memoryService } from './memoryService';
import type { SessionData } from './sessionService';
import type { NotionPage } from './notionService';
import type { SlackChannelMessages } from './slackService';
import type { TeamsChat } from './teamsService';
import type { ChatworkMessage } from './chatworkService';

export type { DialogueTurn };

export interface BriefingChapter {
  id:       string;
  title:    string;
  iconName: string;
  text:     string;
  startSec: number;
}

export interface ExternalStats {
  slack?:    { messageCount: number };
  notion?:   { pageCount: number };
  teams?:    { chatCount: number };
  chatwork?: { messageCount: number };
}

export interface ExternalToolData {
  slackMessages:       SlackChannelMessages[] | null;
  slackTotalUnread:    number | null;
  notionPages:         NotionPage[] | null;
  teamsChats:          TeamsChat[] | null;
  chatworkMessages:    ChatworkMessage[] | null;
  chatworkTotalUnread: number | null;
}

export async function fetchExternalToolData(): Promise<ExternalToolData> {
  const [notionPages, slackResult, teamsChats, chatworkResult] = await Promise.all([
    (async () => { try { const { notionService }   = await import('./notionService');   if (!await notionService.isConnected())   return null; return await notionService.getPages(); }     catch { return null; } })(),
    // 接続済みなら fetch 失敗でも [] を返す（プロンプトからSlackセクションが消えないように）
    (async () => {
      try {
        const { slackService } = await import('./slackService');
        if (!await slackService.isConnected()) return null;
        try { return await slackService.getRecentMessages(); }
        catch (e) { console.error('[fetchExternal] slack error:', e); return { channels: [] as SlackChannelMessages[], totalUnread: 0 }; }
      } catch { return null; }
    })() as Promise<{ channels: SlackChannelMessages[]; totalUnread: number } | null>,
    (async () => { try { const { teamsService }    = await import('./teamsService');    if (!await teamsService.isConnected())    return null; return await teamsService.getRecentChats(); }   catch (e) { console.error('[fetchExternal] teams error:', e); return null; } })(),
    // 接続済みなら fetch 失敗でも [] を返す
    (async () => {
      try {
        const { chatworkService } = await import('./chatworkService');
        if (!await chatworkService.isConnected()) return null;
        try { return await chatworkService.getRecentMessages(); }
        catch (e) { console.error('[fetchExternal] chatwork error:', e); return { messages: [] as import('./chatworkService').ChatworkMessage[], totalUnread: 0 }; }
      } catch { return null; }
    })(),
  ]);
  return {
    slackMessages:    slackResult?.channels    ?? null,
    slackTotalUnread: slackResult?.totalUnread ?? null,
    notionPages, teamsChats,
    chatworkMessages:    chatworkResult?.messages    ?? null,
    chatworkTotalUnread: chatworkResult?.totalUnread ?? null,
  };
}

export interface BriefingScript {
  fullText:         string;
  chapters:         BriefingChapter[];
  estimatedSeconds: number;
  audioUri:         string | null;
  topic:            string;
  dialogue:         DialogueTurn[];
  externalStats?:   ExternalStats;
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

const todayDate = () => new Date().toISOString().slice(0, 10);

async function getCachedNews(uid: string, language: string): Promise<ChapterDraft[] | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'cache', 'dailyNews'));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d.date !== todayDate() || d.language !== language) return null;
    return d.chapters as ChapterDraft[];
  } catch {
    return null;
  }
}

async function cacheNews(uid: string, language: string, chapters: ChapterDraft[]): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid, 'cache', 'dailyNews'), {
      date: todayDate(),
      language,
      chapters,
      cachedAt: serverTimestamp(),
    });
  } catch {
    // non-critical
  }
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
    data:         GoogleData,
    userName:     string,
    interests:    string[] = [],
    isReturning:  boolean  = false,
    uid?:         string,
    sessionData?: SessionData | null,
    hostIds?:     string[],
    isPro?:       boolean,
    language?:    string,
    isMockData?:  boolean,
    externalData?: ExternalToolData | null,
    skipAudio?:   boolean,
  ): Promise<BriefingScript> {
    const currentHour = new Date().getHours();

    // 記憶・外部ツールデータを並行読み込み（Proユーザーのみ外部ツール＋記憶を使用）
    const emptyExternal: ExternalToolData = { slackMessages: null, slackTotalUnread: null, notionPages: null, teamsChats: null, chatworkMessages: null, chatworkTotalUnread: null };
    const [rawContext, { notionPages, slackMessages, slackTotalUnread, teamsChats, chatworkMessages, chatworkTotalUnread }] = await Promise.all([
      uid ? memoryService.getContext(uid).catch(() => null) : Promise.resolve(null),
      isPro
        ? (externalData != null ? Promise.resolve(externalData) : fetchExternalToolData())
        : Promise.resolve(emptyExternal),
    ]);
    // 非ProユーザーはtopicStatuses（Slack/Chatwork/Notion由来）を除去してClaudeに渡さない
    const userContext = rawContext && !isPro
      ? { ...rawContext, topicStatuses: [] }
      : rawContext;

    let rawChapters: ChapterDraft[];
    try {
      // ブリーフィング + Pro向けニュースキャストを並行生成（当日キャッシュあれば再利用）
      // isMockData時はニュースをスキップ（テスト時のAPI課金を防ぐ）
      const lang = language ?? 'ja';
      const newsPromise = isPro && !isMockData
        ? (async () => {
            if (uid) {
              const cached = await getCachedNews(uid, lang);
              if (cached) {
                console.log('[briefing] using cached news');
                return { chapters: cached, fullText: cached.map(c => c.text).join('　') };
              }
            }
            try {
              const result = await claudeService.generateNewsCast({
                userName, interests, currentHour, hostIds, language,
                userContext,
                topEmails: data.topEmails,
              });
              if (uid) cacheNews(uid, lang, result.chapters).catch(() => {});
              return result;
            } catch (e) {
              console.error('[briefing] newsCast failed:', e);
              return null;
            }
          })()
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
          notionPages:         notionPages ?? undefined,
          slackMessages:       slackMessages ?? undefined,
          slackTotalUnread:    slackTotalUnread ?? undefined,
          teamsChats:          teamsChats ?? undefined,
          chatworkMessages:    chatworkMessages ?? undefined,
          chatworkTotalUnread: chatworkTotalUnread ?? undefined,
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

    // isMockData or skipAudio時はTTSをスキップ
    let audioUri: string | null = null;
    if (!isMockData && !skipAudio) {
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
        }
      }
    }

    console.log('[briefing] audioUri:', audioUri);

    // 記憶を非同期で更新（モックデータ使用時はスキップ）
    if (uid && !isMockData) {
      memoryService.extractAndSave(uid, data, userContext, {
        slackMessages:    isPro ? slackMessages    : null,
        notionPages:      isPro ? notionPages      : null,
        chatworkMessages: isPro ? chatworkMessages : null,
      }).catch((e) => console.error('[memory] background update failed:', e));
    }

    const externalStats: ExternalStats = {};
    if (slackMessages !== null)    externalStats.slack    = { messageCount: slackTotalUnread ?? slackMessages.flatMap(ch => ch.messages).length };
    if (notionPages !== null) {
      const today = new Date().toDateString();
      externalStats.notion = { pageCount: notionPages.filter(p => new Date(p.lastEdited).toDateString() === today).length };
    }
    if (teamsChats !== null)       externalStats.teams    = { chatCount: teamsChats.length };
    if (chatworkMessages !== null) externalStats.chatwork = { messageCount: chatworkTotalUnread ?? chatworkMessages.length };

    return { fullText, chapters, estimatedSeconds, audioUri, topic: '今日のブリーフィング', dialogue: allDialogue, externalStats };
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

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

async function getCachedNews(uid: string, language: string, minTargetMinutes?: number): Promise<ChapterDraft[] | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'cache', 'dailyNews'));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d.date !== todayDate() || d.language !== language) return null;
    if (minTargetMinutes && (d.targetMinutes ?? 0) < minTargetMinutes) return null;
    return d.chapters as ChapterDraft[];
  } catch {
    return null;
  }
}

async function cacheNews(uid: string, language: string, chapters: ChapterDraft[], targetMinutes?: number): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid, 'cache', 'dailyNews'), {
      date: todayDate(),
      language,
      chapters,
      targetMinutes: targetMinutes ?? 5,
      cachedAt: serverTimestamp(),
    });
  } catch {
    // non-critical
  }
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


export interface NewsSegmentData {
  chapters:         BriefingChapter[];
  dialogue:         DialogueTurn[];
  estimatedSeconds: number;
  interestText:     string;
}

export async function generateNewsSegment(params: {
  uid:           string;
  userName:      string;
  interests:     string[];
  targetMinutes: number;
  hostIds?:      string[];
  language?:     string;
  topEmails?:    { from: string; subject: string }[];
  externalData?: ExternalToolData | null;
}): Promise<NewsSegmentData> {
  const lang = params.language ?? 'ja';

  const userContext = await memoryService.getContext(params.uid).catch(() => null);
  // 蓄積された記憶から推定した興味関心があればそちらを優先。
  // 無ければ（初回〜数回目の利用）今日のメール差出人・件名・チャット内容からその場で推定し、
  // それでも根拠が無ければ設定のデフォルトにフォールバックする
  let effectiveInterests = userContext?.inferredInterests?.length ? userContext.inferredInterests : null;
  if (!effectiveInterests) {
    const coldStart = await memoryService.inferColdStartInterests({
      topEmails:        params.topEmails,
      slackMessages:    params.externalData?.slackMessages    ?? null,
      notionPages:      params.externalData?.notionPages      ?? null,
      chatworkMessages: params.externalData?.chatworkMessages ?? null,
    }).catch(() => []);
    effectiveInterests = coldStart.length ? coldStart : params.interests;
  }

  const cached = await getCachedNews(params.uid, lang, params.targetMinutes);
  let rawChapters: ChapterDraft[];
  if (cached) {
    console.log('[newsSegment] using cached news');
    rawChapters = cached;
  } else {
    const theme = await claudeService.selectNewsTheme({
      userName:   params.userName,
      interests:  effectiveInterests,
      language:   params.language,
      userContext,
      topEmails:  params.topEmails,
    });
    const result = await claudeService.generateNewsCast({
      userName:      params.userName,
      interests:     effectiveInterests,
      currentHour:   new Date().getHours(),
      hostIds:       params.hostIds,
      language:      params.language,
      userContext,
      topEmails:     params.topEmails,
      targetMinutes: params.targetMinutes,
      theme,
    });
    rawChapters = result.chapters;
    cacheNews(params.uid, lang, rawChapters, params.targetMinutes).catch(() => {});
  }

  const fullText         = rawChapters.map(c => c.text).join('　');
  const estimatedSeconds = Math.ceil(fullText.length / 5);
  const times            = estimateChapterTimes(rawChapters.map(c => c.text), estimatedSeconds);

  const chapters: BriefingChapter[] = rawChapters.map((c, i) => ({
    id: c.id, title: c.title, iconName: c.iconName, text: c.text, startSec: times[i],
  }));

  const dialogue = splitTurns(rawChapters.flatMap(c => c.dialogue ?? []));
  const interestText = effectiveInterests.slice(0, 3).join(', ') || 'technology, business';

  return { chapters, dialogue, estimatedSeconds, interestText };
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
    chatworkMyName?: string,
    notionMyName?: string,
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
      // ニュースキャストは generateNewsSegment() 側（two-phase: テーマ選定→深堀り）で別途生成される
      const [briefingResult] = await Promise.all([
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
          notionPages:         notionPages
            ? notionPages.filter(p => {
                const t = Date.now() - new Date(p.lastEdited).getTime();
                if (!(t >= 0 && t < 24 * 3600 * 1000)) return false;
                // 自分自身が最終更新者のページは除外（自分の更新を「他者の行動」として報告させない）
                if (notionMyName && p.lastEditedBy === notionMyName) return false;
                return true;
              })
            : undefined,
          slackMessages:       slackMessages ?? undefined,
          slackTotalUnread:    slackTotalUnread ?? undefined,
          teamsChats:          teamsChats ?? undefined,
          chatworkMessages:    chatworkMessages ?? undefined,
          chatworkTotalUnread: chatworkTotalUnread ?? undefined,
          chatworkMyName:      chatworkMyName,
          notionMyName:        notionMyName,
        }),
      ]);

      rawChapters = briefingResult.chapters;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[briefing] script generation failed:', msg.slice(0, 400));
      if (msg.includes('429') || msg.includes('quota')) throw err;
      throw new Error(`generation_failed: ${msg.slice(0, 200)}`);
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
      externalStats.notion = { pageCount: notionPages.filter(p => { const t = Date.now() - new Date(p.lastEdited).getTime(); return t >= 0 && t < 24 * 3600 * 1000; }).length };
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

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import type { GoogleData } from './googleDataService';
import { callFunction } from './functionsService';

export interface ContactMemory {
  name:          string;
  recentTopics:  string[];
  lastSeen:      string; // YYYY-MM-DD
}

export interface FollowupMemory {
  contact: string;
  topic:   string;
  since:   string; // YYYY-MM-DD
}

// 外部ツール（Slack/Chatwork/Notion）から蓄積したプロジェクト・話題の現状メモ
export interface TopicStatus {
  topic:       string; // 話題・プロジェクト名
  status:      string; // 現在の状態（「進行中」「遅延あり」「解決済み」等）
  source:      string; // "Chatwork" | "Slack" | "Notion"
  lastUpdated: string; // YYYY-MM-DD
}

export interface UserContext {
  inferredRole:     string;
  frequentContacts: ContactMemory[];
  recentTopics:     string[];
  pendingFollowups: FollowupMemory[];
  topicStatuses:    TopicStatus[]; // 外部ツールから蓄積した現状スナップショット
}

// Circuit breaker: skip memory extraction for the session if quota is exceeded
let memoryQuotaExceeded = false;

async function callGemini(prompt: string): Promise<string> {
  if (memoryQuotaExceeded) throw new Error('gemini-memory:quota_exceeded');
  try {
    const { text } = await callFunction<{ text: string }>('gemini', {
      prompt,
      systemPrompt: 'You are a memory extraction assistant. Output JSON only.',
    });
    return text;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429')) {
      memoryQuotaExceeded = true;
      console.warn('[memory] quota exceeded — skipping memory extraction for this session');
    }
    throw new Error(`gemini-memory: ${msg}`);
  }
}

export const memoryService = {
  async getContext(uid: string): Promise<UserContext | null> {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'memory', 'context'));
      if (!snap.exists()) return null;
      const d = snap.data();
      return {
        inferredRole:     d.inferredRole     ?? '',
        frequentContacts: d.frequentContacts ?? [],
        recentTopics:     d.recentTopics     ?? [],
        pendingFollowups: d.pendingFollowups ?? [],
        topicStatuses:    d.topicStatuses    ?? [],
      };
    } catch {
      return null;
    }
  },

  async saveContext(uid: string, ctx: UserContext): Promise<void> {
    await setDoc(doc(db, 'users', uid, 'memory', 'context'), {
      ...ctx,
      updatedAt: serverTimestamp(),
    });
  },

  // メール・カレンダー・外部ツールから記憶を抽出してFirestoreに保存（非同期・ノンブロッキング）
  async extractAndSave(
    uid: string,
    googleData: GoogleData,
    existing: UserContext | null,
    externalData?: {
      slackMessages?:    { workspace: string; channelName: string; messages: string[] }[] | null;
      notionPages?:      { title: string; lastEditedBy?: string }[] | null;
      chatworkMessages?: { roomName: string; accountName: string; body: string; isMention: boolean }[] | null;
    } | null,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    // コードレベルのクリーンアップ（Geminiに頼らない）
    const cleanedExisting: UserContext | null = existing ? {
      ...existing,
      // 7日以上前のフォローアップは除去
      pendingFollowups: existing.pendingFollowups.filter(f => f.since >= sevenDaysAgo),
      // 30日以上更新のないトピックは除去、「完了」「解決」「終了」を含むstatusも除去
      topicStatuses: existing.topicStatuses.filter(s =>
        s.lastUpdated >= thirtyDaysAgo &&
        !['完了', '解決', '終了', 'クローズ', '完結'].some(w => s.status.includes(w))
      ),
    } : null;

    const emailLines = googleData.topEmails.slice(0, 8)
      .map(e => `・${e.from}: ${e.subject}`).join('\n') || 'なし';
    const eventLines = [...googleData.todayEvents, ...googleData.tomorrowEvents].slice(0, 8)
      .map(e => `・${e.startTime} ${e.title}`).join('\n') || 'なし';

    const existingStr = cleanedExisting
      ? JSON.stringify({
          inferredRole:     cleanedExisting.inferredRole,
          frequentContacts: cleanedExisting.frequentContacts.slice(0, 8),
          recentTopics:     cleanedExisting.recentTopics.slice(0, 10),
          pendingFollowups: cleanedExisting.pendingFollowups.slice(0, 5),
          topicStatuses:    cleanedExisting.topicStatuses.slice(0, 10),
        }, null, 2)
      : '{}';

    // 外部ツールデータを文字列化
    const slackLines = externalData?.slackMessages?.length
      ? externalData.slackMessages.map(ch =>
          `[${ch.workspace}/${ch.channelName}] ${ch.messages.slice(0, 3).join(' / ')}`
        ).join('\n')
      : null;
    const notionLines = externalData?.notionPages?.length
      ? externalData.notionPages.slice(0, 5).map(p =>
          `・${p.title}${p.lastEditedBy ? `（更新者: ${p.lastEditedBy}）` : ''}`
        ).join('\n')
      : null;
    const chatworkLines = externalData?.chatworkMessages?.length
      ? externalData.chatworkMessages.slice(0, 8).map(m =>
          `[${m.roomName}]${m.isMention ? '【メンション】' : ''} ${m.accountName}: ${m.body.slice(0, 100)}`
        ).join('\n')
      : null;

    const externalBlock = (slackLines || notionLines || chatworkLines)
      ? `\n【外部ツールの今日のやりとり（現状把握に使用）】
${slackLines    ? `Slack:\n${slackLines}\n`    : ''}${notionLines   ? `Notion:\n${notionLines}\n`   : ''}${chatworkLines ? `Chatwork:\n${chatworkLines}` : ''}`
      : '';

    const prompt = `今日は${today}です。
以下のデータと既存の記憶をもとに、ユーザーについての記憶をJSONで更新してください。

【既存の記憶】
${existingStr}

【今日のメール（メインのみ）】
${emailLines}

【今日・明日の予定】
${eventLines}
${externalBlock}

ルール:
- inferredRole: 会議・メールのパターンから職種・役割を推定（既存があれば大きく変えない）
- frequentContacts: メール・外部ツールの送信者を追加・更新（最大10人、lastSeen=${today}で更新）
- recentTopics: メール件名・予定・Slack/Chatworkのキーワードから主要トピック（最大10個）
- pendingFollowups: 返信待ち・続きが必要そうなもの（最大5個）
  【削除ルール】今日のデータで「返信済み」「解決」「完了」の証拠があるものは削除する。also最終確認日が1週間以上前のものは削除する。今日のメール・ツールデータに全く登場しないアイテムが5日以上経過している場合も削除する
- topicStatuses: Slack・Chatwork・Notionから読み取れる「プロジェクト・話題の現在の状態」を記録する（最大10個）
  例: {"topic": "プロジェクトX", "status": "遅延が発生、Aさんが対応中", "source": "Chatwork", "lastUpdated": "${today}"}
  【更新ルール】今日のデータで状態が変わっていれば上書き（lastUpdated=${today}に更新）
  【削除ルール】今日のデータで「完了」「解決」「終了」「クローズ」したことが明示されているトピックは出力JSONから除外すること（statusに「完了」等を書くのではなく、エントリ自体を削除する）
  変化がなく完了でもないものはそのまま保持

JSONのみ返してください:
{
  "inferredRole": "推定の職種・役割",
  "frequentContacts": [{"name": "名前", "recentTopics": ["関連トピック"], "lastSeen": "YYYY-MM-DD"}],
  "recentTopics": ["トピック1", "トピック2"],
  "pendingFollowups": [{"contact": "名前", "topic": "内容", "since": "YYYY-MM-DD"}],
  "topicStatuses": [{"topic": "話題・プロジェクト名", "status": "現在の状態", "source": "Chatwork|Slack|Notion", "lastUpdated": "YYYY-MM-DD"}]
}`;

    try {
      const raw   = await callGemini(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return;
      const ctx = JSON.parse(match[0]) as UserContext;
      await this.saveContext(uid, ctx);
      console.log('[memory] saved:', ctx.inferredRole, '/ contacts:', ctx.frequentContacts.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('429') || msg.includes('quota_exceeded')) return; // callGemini側でwarn済み
      console.warn('[memory] extract failed:', msg);
    }
  },
};

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

export interface UserContext {
  inferredRole:     string;
  frequentContacts: ContactMemory[];
  recentTopics:     string[];
  pendingFollowups: FollowupMemory[];
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

  // メール・カレンダーから記憶を抽出してFirestoreに保存（非同期・ノンブロッキング）
  async extractAndSave(uid: string, googleData: GoogleData, existing: UserContext | null): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    const emailLines = googleData.topEmails.slice(0, 8)
      .map(e => `・${e.from}: ${e.subject}`).join('\n') || 'なし';
    const eventLines = [...googleData.todayEvents, ...googleData.tomorrowEvents].slice(0, 8)
      .map(e => `・${e.startTime} ${e.title}`).join('\n') || 'なし';

    const existingStr = existing
      ? JSON.stringify({
          inferredRole:     existing.inferredRole,
          frequentContacts: existing.frequentContacts.slice(0, 8),
          recentTopics:     existing.recentTopics.slice(0, 10),
          pendingFollowups: existing.pendingFollowups.slice(0, 5),
        }, null, 2)
      : '{}';

    const prompt = `今日は${today}です。
以下のメール・カレンダーと既存の記憶をもとに、ユーザーについての記憶をJSONで更新してください。

【既存の記憶】
${existingStr}

【今日のメール（メインのみ）】
${emailLines}

【今日・明日の予定】
${eventLines}

ルール:
- inferredRole: 会議・メールのパターンから職種・役割を推定（既存があれば大きく変えない）
- frequentContacts: メール送信者を追加・更新（最大10人、lastSeen=${today}で更新）
- recentTopics: メール件名・予定タイトルから主要トピック（最大10個、新しいものを優先）
- pendingFollowups: 返信待ち・続きが必要そうなもの（最大5個、2週間以上前は除去）

JSONのみ返してください:
{
  "inferredRole": "推定の職種・役割（例：プロダクトマネージャー、エンジニア）",
  "frequentContacts": [{"name": "名前", "recentTopics": ["関連トピック"], "lastSeen": "YYYY-MM-DD"}],
  "recentTopics": ["トピック1", "トピック2"],
  "pendingFollowups": [{"contact": "名前", "topic": "内容", "since": "YYYY-MM-DD"}]
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

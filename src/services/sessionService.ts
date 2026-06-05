import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';

export interface SessionData {
  lastOpenedAt:     Date;
  lastChapterTitle: string;
  lastChapterIndex: number;
  completionRate:   number; // 0–1
  topicSummary:     string; // e.g. "おはよう、メール、予定"
}

export const sessionService = {
  async get(uid: string): Promise<SessionData | null> {
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'session', 'current'));
      if (!snap.exists()) return null;
      const d = snap.data();
      return {
        lastOpenedAt:     (d.lastOpenedAt as Timestamp)?.toDate() ?? new Date(0),
        lastChapterTitle: d.lastChapterTitle ?? '',
        lastChapterIndex: d.lastChapterIndex ?? 0,
        completionRate:   d.completionRate   ?? 0,
        topicSummary:     d.topicSummary     ?? '',
      };
    } catch {
      return null;
    }
  },

  async markOpened(uid: string): Promise<void> {
    setDoc(
      doc(db, 'users', uid, 'session', 'current'),
      { lastOpenedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  },

  async saveProgress(uid: string, progress: {
    chapterTitle:  string;
    chapterIndex:  number;
    completionRate: number;
    topicSummary:  string;
  }): Promise<void> {
    setDoc(
      doc(db, 'users', uid, 'session', 'current'),
      {
        lastChapterTitle: progress.chapterTitle,
        lastChapterIndex: progress.chapterIndex,
        completionRate:   progress.completionRate,
        topicSummary:     progress.topicSummary,
        lastOpenedAt:     serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  },
};

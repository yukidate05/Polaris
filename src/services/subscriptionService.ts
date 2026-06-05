import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';

const TRIAL_DAYS         = 5;
const FREE_COOLDOWN_DAYS = 3;

export interface AccessStatus {
  allowed:          boolean;
  reason:           'trial' | 'pro' | 'free_cooldown' | 'cooldown_active';
  trialDaysLeft:    number;  // >0 if in trial
  cooldownDaysLeft: number;  // days until next free use (0 = can use now)
}

export const subscriptionService = {
  async checkAccess(uid: string, isPro: boolean): Promise<AccessStatus> {
    if (isPro) {
      return { allowed: true, reason: 'pro', trialDaysLeft: 0, cooldownDaysLeft: 0 };
    }

    try {
      const ref  = doc(db, 'users', uid);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};

      if (data.plan === 'pro') {
        return { allowed: true, reason: 'pro', trialDaysLeft: 0, cooldownDaysLeft: 0 };
      }

      // firstOpenedAt がなければ今セット（初回起動）
      let firstOpenedAt: Date;
      if (!data.firstOpenedAt) {
        const now = new Date();
        await setDoc(ref, { firstOpenedAt: serverTimestamp() }, { merge: true });
        firstOpenedAt = now;
      } else {
        firstOpenedAt = (data.firstOpenedAt as Timestamp).toDate();
      }

      // ── トライアル判定 ────────────────────────────────────
      const trialEnd      = new Date(firstOpenedAt.getTime() + TRIAL_DAYS * 86_400_000);
      const now           = new Date();
      const trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000));

      if (now < trialEnd) {
        return { allowed: true, reason: 'trial', trialDaysLeft, cooldownDaysLeft: 0 };
      }

      // ── 3日クールダウン判定（深夜0時リセット）────────────
      const lastFreeUseAt = data.lastFreeUseAt
        ? (data.lastFreeUseAt as Timestamp).toDate()
        : null;

      if (!lastFreeUseAt) {
        return { allowed: true, reason: 'free_cooldown', trialDaysLeft: 0, cooldownDaysLeft: 0 };
      }

      // 「生成した日の深夜0時」 + 3日 = 解放される日の深夜0時
      const lastDay = new Date(lastFreeUseAt);
      lastDay.setHours(0, 0, 0, 0);
      const nextFreeDay = new Date(lastDay);
      nextFreeDay.setDate(nextFreeDay.getDate() + FREE_COOLDOWN_DAYS);

      if (now >= nextFreeDay) {
        return { allowed: true, reason: 'free_cooldown', trialDaysLeft: 0, cooldownDaysLeft: 0 };
      }

      // 残り日数は「今日の0時」からの暦日差
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const cooldownDaysLeft = Math.ceil(
        (nextFreeDay.getTime() - todayStart.getTime()) / 86_400_000
      );
      return { allowed: false, reason: 'cooldown_active', trialDaysLeft: 0, cooldownDaysLeft };

    } catch {
      return { allowed: true, reason: 'free_cooldown', trialDaysLeft: 0, cooldownDaysLeft: 0 };
    }
  },

  async recordGeneration(uid: string): Promise<void> {
    try {
      await setDoc(doc(db, 'users', uid), { lastFreeUseAt: serverTimestamp() }, { merge: true });
    } catch {
      // 記録失敗はサイレントに無視
    }
  },
};

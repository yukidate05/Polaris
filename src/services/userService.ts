import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '@lib/firebase';
import { UserProfile, UserPreferences } from '@models/index';

export const userService = {
  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate() ?? new Date(),
      updatedAt: data.updatedAt?.toDate() ?? new Date(),
    } as UserProfile;
  },

  async createProfile(user: User): Promise<UserProfile> {
    const profile: Omit<UserProfile, 'createdAt' | 'updatedAt'> = {
      uid:         user.uid,
      email:       user.email,
      displayName: user.displayName,
      photoURL:    user.photoURL,
      plan:        'free',
      locale:      'ja',
      timezone:    'Asia/Tokyo',
    };

    await setDoc(doc(db, 'users', user.uid), {
      ...profile,
      firstOpenedAt:            serverTimestamp(), // トライアル開始日
      monthlyGenerationCount:   0,
      monthlyGenerationResetAt: serverTimestamp(),
      createdAt:                serverTimestamp(),
      updatedAt:                serverTimestamp(),
    });

    return { ...profile, createdAt: new Date(), updatedAt: new Date() };
  },

  async upsertProfile(user: User): Promise<UserProfile> {
    const existing = await this.getProfile(user.uid);
    if (existing) return existing;
    return this.createProfile(user);
  },

  async updatePreferences(uid: string, prefs: Partial<UserPreferences>): Promise<void> {
    await updateDoc(doc(db, 'users', uid), {
      ...prefs,
      updatedAt: serverTimestamp(),
    });
  },
};

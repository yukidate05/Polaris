import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Episode, EpisodeType } from '@models/index';

function fromFirestore(id: string, data: Record<string, any>): Episode {
  return {
    id,
    userId:      data.userId,
    type:        data.type as EpisodeType,
    title:       data.title,
    summary:     data.summary ?? '',
    audioUrl:    data.audioUrl ?? null,
    durationSec: data.durationSec ?? 0,
    status:      data.status,
    chapters:    data.chapters ?? [],
    topics:      data.topics ?? [],
    thumbnailUrl:data.thumbnailUrl ?? null,
    createdAt:   (data.createdAt as Timestamp)?.toDate() ?? new Date(),
  };
}

export const episodeService = {
  async getTodayBriefing(userId: string): Promise<Episode | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'episodes'),
      where('userId', '==', userId),
      where('type', '==', 'daily_brief'),
      where('createdAt', '>=', Timestamp.fromDate(today)),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return fromFirestore(d.id, d.data());
  },

  async getEpisodes(
    userId: string,
    opts: { type?: EpisodeType; limitCount?: number } = {}
  ): Promise<Episode[]> {
    const constraints: any[] = [
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(opts.limitCount ?? 20),
    ];

    if (opts.type) {
      constraints.splice(1, 0, where('type', '==', opts.type));
    }

    const q = query(collection(db, 'episodes'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => fromFirestore(d.id, d.data()));
  },

  async getById(episodeId: string): Promise<Episode | null> {
    const snap = await getDoc(doc(db, 'episodes', episodeId));
    if (!snap.exists()) return null;
    return fromFirestore(snap.id, snap.data());
  },
};

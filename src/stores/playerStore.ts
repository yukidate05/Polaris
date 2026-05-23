import { create } from 'zustand';
import { Episode, Chapter, PlayerStatus } from '@models/index';

interface PlayerStore {
  episode:        Episode | null;
  status:         PlayerStatus;
  positionMs:     number;
  durationMs:     number;
  playbackRate:   number;
  currentChapter: Chapter | null;
  isExpanded:     boolean;

  setEpisode:     (episode: Episode) => void;
  setStatus:      (status: PlayerStatus) => void;
  setPosition:    (positionMs: number) => void;
  setDuration:    (durationMs: number) => void;
  setPlaybackRate:(rate: number) => void;
  setCurrentChapter: (chapter: Chapter | null) => void;
  setExpanded:    (expanded: boolean) => void;
  reset:          () => void;
}

const initialState = {
  episode:        null,
  status:         'idle' as PlayerStatus,
  positionMs:     0,
  durationMs:     0,
  playbackRate:   1.0,
  currentChapter: null,
  isExpanded:     false,
};

export const usePlayerStore = create<PlayerStore>((set) => ({
  ...initialState,

  setEpisode:    (episode) => set({ episode, status: 'loading', positionMs: 0 }),
  setStatus:     (status)  => set({ status }),
  setPosition:   (positionMs) => set({ positionMs }),
  setDuration:   (durationMs) => set({ durationMs }),
  setPlaybackRate:(playbackRate) => set({ playbackRate }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setExpanded:   (isExpanded) => set({ isExpanded }),
  reset:         () => set(initialState),
}));

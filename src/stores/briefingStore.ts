import { create } from 'zustand';
import type { BriefingScript, BriefingChapter } from '@services/briefingService';
import type { DialogueTurn } from '@services/claudeService';
import type { GoogleData } from '@services/googleDataService';

export type BriefingStatus =
  | 'idle'
  | 'fetching'           // loading Gmail/Calendar
  | 'generating_script'  // Claude writing
  | 'generating_audio'   // TTS rendering
  | 'ready'              // audio ready to play
  | 'error'
  | 'quota_exceeded';    // Gemini API 429 — daily limit reached

export type NewsStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface NewsSegment {
  chapters:         BriefingChapter[];
  dialogue:         DialogueTurn[];
  audioUri:         string | null;
  estimatedSeconds: number;
  interestText:     string;
}

interface BriefingStore {
  status:             BriefingStatus;
  googleData:         GoogleData | null;
  script:             BriefingScript | null;
  error:              string | null;
  hasPlayed:          boolean;
  newsStatus:         NewsStatus;
  newsSegment:        NewsSegment | null;
  transitionAudioUri: string | null;

  setStatus:              (s: BriefingStatus) => void;
  setGoogleData:          (d: GoogleData) => void;
  setScript:              (s: BriefingScript) => void;
  updateAudioUri:         (uri: string | null) => void;
  setError:               (e: string) => void;
  setHasPlayed:           (v: boolean) => void;
  setNewsStatus:          (s: NewsStatus) => void;
  setNewsSegment:         (s: NewsSegment) => void;
  setNewsAudioUri:        (uri: string | null) => void;
  setTransitionAudioUri:  (uri: string | null) => void;
  clearNews:              () => void;
  reset:                  () => void;
}

const initial = {
  status:             'idle' as BriefingStatus,
  googleData:         null,
  script:             null,
  error:              null,
  hasPlayed:          false,
  newsStatus:         'idle' as NewsStatus,
  newsSegment:        null,
  transitionAudioUri: null,
};

export const useBriefingStore = create<BriefingStore>((set) => ({
  ...initial,

  setStatus:             (status)     => set({ status }),
  setGoogleData:         (googleData) => set({ googleData }),
  setScript:             (script)     => set({ script, status: 'ready' }),
  updateAudioUri:        (uri)        => set(state => ({ script: state.script ? { ...state.script, audioUri: uri } : state.script })),
  setError:              (error)      => set({ error, status: 'error' }),
  setHasPlayed:          (hasPlayed)  => set({ hasPlayed }),
  setNewsStatus:         (newsStatus)         => set({ newsStatus }),
  setNewsSegment:        (newsSegment)        => set({ newsSegment }),
  setNewsAudioUri:       (uri)                => set(state => ({ newsSegment: state.newsSegment ? { ...state.newsSegment, audioUri: uri } : state.newsSegment })),
  setTransitionAudioUri: (transitionAudioUri) => set({ transitionAudioUri }),
  clearNews:             () => set({ newsSegment: null, transitionAudioUri: null, newsStatus: 'idle' as NewsStatus }),
  reset:                 ()           => set(initial),
}));

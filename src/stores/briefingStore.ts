import { create } from 'zustand';
import type { BriefingScript } from '@services/briefingService';
import type { GoogleData } from '@services/googleDataService';

export type BriefingStatus =
  | 'idle'
  | 'fetching'           // loading Gmail/Calendar
  | 'generating_script'  // Claude writing
  | 'generating_audio'   // TTS rendering
  | 'ready'              // audio ready to play
  | 'error'
  | 'quota_exceeded';    // Gemini API 429 — daily limit reached

interface BriefingStore {
  status:        BriefingStatus;
  googleData:    GoogleData | null;
  script:        BriefingScript | null;
  error:         string | null;
  hasPlayed:     boolean; // true after first play → triggers "お帰り" on next generation

  setStatus:     (s: BriefingStatus) => void;
  setGoogleData: (d: GoogleData) => void;
  setScript:     (s: BriefingScript) => void;
  setError:      (e: string) => void;
  setHasPlayed:  (v: boolean) => void;
  reset:         () => void;
}

const initial = {
  status:     'idle' as BriefingStatus,
  googleData: null,
  script:     null,
  error:      null,
  hasPlayed:  false,
};

export const useBriefingStore = create<BriefingStore>((set) => ({
  ...initial,

  setStatus:     (status)     => set({ status }),
  setGoogleData: (googleData) => set({ googleData }),
  setScript:     (script)     => set({ script, status: 'ready' }),
  setError:      (error)      => set({ error, status: 'error' }),
  setHasPlayed:  (hasPlayed)  => set({ hasPlayed }),
  reset:         ()           => set(initial),
}));

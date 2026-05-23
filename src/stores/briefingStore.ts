import { create } from 'zustand';
import type { BriefingScript } from '@services/briefingService';
import type { GoogleData } from '@services/googleDataService';

export type BriefingStatus =
  | 'idle'
  | 'fetching'           // loading Gmail/Calendar
  | 'generating_script'  // Claude writing
  | 'generating_audio'   // ElevenLabs rendering
  | 'ready'              // audio ready to play
  | 'error';

interface BriefingStore {
  status:     BriefingStatus;
  googleData: GoogleData | null;
  script:     BriefingScript | null;
  error:      string | null;

  setStatus:     (s: BriefingStatus) => void;
  setGoogleData: (d: GoogleData) => void;
  setScript:     (s: BriefingScript) => void;
  setError:      (e: string) => void;
  reset:         () => void;
}

const initial = {
  status:     'idle' as BriefingStatus,
  googleData: null,
  script:     null,
  error:      null,
};

export const useBriefingStore = create<BriefingStore>((set) => ({
  ...initial,

  setStatus:     (status)     => set({ status }),
  setGoogleData: (googleData) => set({ googleData }),
  setScript:     (script)     => set({ script, status: 'ready' }),
  setError:      (error)      => set({ error, status: 'error' }),
  reset:         ()           => set(initial),
}));

import { create } from 'zustand';
import { UserPreferences } from '@models/index';
import { DEFAULT_HOST_IDS } from '@services/voiceService';
import { detectDeviceLang } from '@/i18n';

interface UserPreferencesStore {
  preferences:    UserPreferences;
  selectedHostIds: string[];
  setPreferences:  (prefs: Partial<UserPreferences>) => void;
  setSelectedHostIds: (ids: string[]) => void;
  reset:           () => void;
}

const defaultPreferences: UserPreferences = {
  briefingTime:         '07:00',
  language:             detectDeviceLang(),
  voiceStyle:           'calm',
  notificationsEnabled: true,
  topicsOfInterest:     ['ai_tech', 'business', 'market'],
};

export const useUserPreferencesStore = create<UserPreferencesStore>((set) => ({
  preferences:     defaultPreferences,
  selectedHostIds: DEFAULT_HOST_IDS,

  setPreferences: (prefs) =>
    set((state) => ({
      preferences: { ...state.preferences, ...prefs },
    })),

  setSelectedHostIds: (ids) => set({ selectedHostIds: ids }),

  reset: () => set({ preferences: defaultPreferences, selectedHostIds: DEFAULT_HOST_IDS }),
}));

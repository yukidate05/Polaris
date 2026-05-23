import { create } from 'zustand';
import { UserPreferences } from '@models/index';

interface UserPreferencesStore {
  preferences: UserPreferences;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
  reset: () => void;
}

const defaultPreferences: UserPreferences = {
  briefingTime:         '07:00',
  language:             'ja',
  voiceStyle:           'calm',
  notificationsEnabled: true,
  topicsOfInterest:     ['ai_tech', 'business', 'market'],
};

export const useUserPreferencesStore = create<UserPreferencesStore>((set) => ({
  preferences: defaultPreferences,

  setPreferences: (prefs) =>
    set((state) => ({
      preferences: { ...state.preferences, ...prefs },
    })),

  reset: () => set({ preferences: defaultPreferences }),
}));

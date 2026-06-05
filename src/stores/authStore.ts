import { create } from 'zustand';
import { User } from 'firebase/auth';
import { UserProfile } from '@models/index';

interface AuthState {
  user:                 User | null;
  profile:              UserProfile | null;
  googleAccessToken:    string | null;
  googleTokenResolved:  boolean;
  isLoading:            boolean;
  isInitialized:        boolean;
  error:                string | null;

  setUser:                  (user: User | null) => void;
  setProfile:               (profile: UserProfile | null) => void;
  setGoogleAccessToken:     (token: string | null) => void;
  setGoogleTokenResolved:   (resolved: boolean) => void;
  setLoading:               (loading: boolean) => void;
  setInitialized:           () => void;
  setError:                 (error: string | null) => void;
  reset:                    () => void;
}

const initialState = {
  user:                null,
  profile:             null,
  googleAccessToken:   null,
  googleTokenResolved: false,
  isLoading:           false,
  isInitialized:       false,
  error:               null,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,

  setUser:                (user) => set({ user }),
  setProfile:             (profile) => set({ profile }),
  setGoogleAccessToken:   (googleAccessToken) => set({ googleAccessToken }),
  setGoogleTokenResolved: (googleTokenResolved) => set({ googleTokenResolved }),
  setLoading:             (isLoading) => set({ isLoading }),
  setInitialized:         () => set({ isInitialized: true }),
  setError:               (error) => set({ error }),
  reset:                  () => set(initialState),
}));

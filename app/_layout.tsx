import '../global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authService } from '@services/authService';
import { userService } from '@services/userService';
import { useAuthStore } from '@stores/authStore';
import { initRevenueCat } from '@lib/revenuecat';
import { initPostHog, analytics } from '@lib/analytics';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export default function RootLayout() {
  const { setUser, setProfile, setGoogleAccessToken, setGoogleTokenResolved, setInitialized } = useAuthStore();

  useEffect(() => {
    // Initialize analytics
    initPostHog();
    analytics.appOpen();

    const unsubscribe = authService.onAuthStateChange(async (user) => {
      setUser(user);
      setInitialized();

      if (user) {
        initRevenueCat(user.uid);
        initPostHog(user.uid);
        // Ensure Firestore profile exists and load it
        userService.upsertProfile(user).then(setProfile).catch(() => null);
        // Restore Google access token for Gmail/Calendar API calls.
        // Always resolve the flag so home screen knows it's safe to generate.
        authService.getAccessToken()
          .then((t) => { if (t) setGoogleAccessToken(t); })
          .catch(() => null)
          .finally(() => setGoogleTokenResolved(true));
      } else {
        setProfile(null);
        setGoogleAccessToken(null);
        setGoogleTokenResolved(true);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

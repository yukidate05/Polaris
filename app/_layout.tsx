import '../global.css';
import 'expo-dev-client';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authService } from '@services/authService';
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
  const { setUser, setInitialized } = useAuthStore();

  useEffect(() => {
    // Initialize analytics
    initPostHog();
    analytics.appOpen();

    const unsubscribe = authService.onAuthStateChange((user) => {
      setUser(user);
      setInitialized();

      if (user) {
        // Initialize RevenueCat and PostHog with user ID after login
        initRevenueCat(user.uid);
        initPostHog(user.uid);
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

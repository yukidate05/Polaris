import Constants from 'expo-constants';

// posthog-react-native requires a native binary — not available in Expo Go
const isNativeBuild = Constants.appOwnership !== 'expo';

let posthog: import('posthog-react-native').default | null = null;

export function initPostHog(userId?: string) {
  if (!isNativeBuild) return;

  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  const host   = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';
  if (!apiKey) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PostHog = require('posthog-react-native').default;
  posthog = new PostHog(apiKey, { host });

  if (userId) {
    posthog?.identify(userId);
  }
}

export function identifyUser(userId: string, properties?: Record<string, string | number | boolean>) {
  posthog?.identify(userId, properties);
}

export const analytics = {
  appOpen:              () => posthog?.capture('app_open'),
  onboardingCompleted:  () => posthog?.capture('onboarding_completed'),
  loginCompleted:       (method: 'google' | 'apple') =>
    posthog?.capture('login_completed', { method }),
  briefingPlayed:       (episodeId: string) =>
    posthog?.capture('briefing_played', { episode_id: episodeId }),
  briefingCompleted:    (episodeId: string, listenedSec: number) =>
    posthog?.capture('briefing_completed', { episode_id: episodeId, listened_sec: listenedSec }),
  sourceConnected:      (provider: string) =>
    posthog?.capture('source_connected', { provider }),
  sourceDisconnected:   (provider: string) =>
    posthog?.capture('source_disconnected', { provider }),
  episodeSkipped:       (episodeId: string, positionSec: number) =>
    posthog?.capture('episode_skipped', { episode_id: episodeId, position_sec: positionSec }),
  upgradeViewed:        () => posthog?.capture('upgrade_viewed'),
  upgradePurchased:     (plan: string) =>
    posthog?.capture('upgrade_purchased', { plan }),
};

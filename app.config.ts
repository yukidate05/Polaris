import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Polaris',
  slug: 'polaris',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#DCEBE8',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.polaris.app',
    googleServicesFile: './GoogleService-Info.plist',
    infoPlist: {
      NSMicrophoneUsageDescription: 'Polaris uses the microphone for voice questions during audio briefings.',
    },
  },
  android: {
    package: 'com.yukid.polaris',
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#DCEBE8',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'expo-audio',
    [
      '@react-native-google-signin/google-signin',
      {
        // Reversed iOS OAuth client ID — required for the sign-in redirect scheme
        iosUrlScheme: 'com.googleusercontent.apps.439207010999-r4ghca0ihkd8i8t6m647ko50a91lpbpn',
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#DCEBE8',
        image: './assets/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
  extra: {
    firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    revenuecatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    revenuecatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    eas: {
      projectId: '888facd7-d52f-43ff-8c03-16f389c0e7cf',
    },
  },
  scheme: 'polaris',
});

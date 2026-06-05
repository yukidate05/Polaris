import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth, inMemoryPersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
};

// Metro(React Native)環境では firebase/auth が RNバンドルに解決され
// getReactNativePersistence が存在する
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rnAuth = require('firebase/auth') as any;
const persistence = typeof rnAuth.getReactNativePersistence === 'function'
  ? rnAuth.getReactNativePersistence(AsyncStorage)
  : inMemoryPersistence;

const isNew = getApps().length === 0;
const app   = isNew ? initializeApp(firebaseConfig) : getApp();

export const auth = isNew
  ? initializeAuth(app, { persistence })
  : getAuth(app);

export const db = getFirestore(app);

export default app;

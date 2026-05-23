import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  inMemoryPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
};

const isNew = getApps().length === 0;
const app   = isNew ? initializeApp(firebaseConfig) : getApp();

// Firebase v12 removed getReactNativePersistence from the JS SDK.
// Using inMemoryPersistence for MVP; Google/Apple Sign-In credential caching
// handles re-auth transparently in practice. Add AsyncStorage persistence post-MVP.
export const auth = isNew
  ? initializeAuth(app, { persistence: inMemoryPersistence })
  : getAuth(app);

export const db = getFirestore(app);

export default app;

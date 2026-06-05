import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import { auth } from '@lib/firebase';

const isExpoGo = Constants.appOwnership === 'expo';

function getGoogleSignin() {
  if (isExpoGo) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-google-signin/google-signin');
  const GoogleSignin = mod.GoogleSignin as typeof import('@react-native-google-signin/google-signin').GoogleSignin;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
      ?? '439207010999-9qccl34rpcsald4sdbn7d495ike1agno.apps.googleusercontent.com',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
      ?? '439207010999-r4ghca0ihkd8i8t6m647ko50a91lpbpn.apps.googleusercontent.com',
    offlineAccess: true,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  });
  return GoogleSignin;
}

let _googleSignin: ReturnType<typeof getGoogleSignin> | undefined;
function googleSignin() {
  if (_googleSignin === undefined) _googleSignin = getGoogleSignin();
  return _googleSignin;
}

export const authService = {
  async signInWithGoogle(): Promise<{ user: User; accessToken: string | null }> {
    const gs = googleSignin();
    if (!gs) throw new Error('Google Sign-In is not available in Expo Go.');
    await gs.hasPlayServices();
    const { data } = await gs.signIn();
    if (!data?.idToken) throw new Error('Google sign-in failed: no ID token');
    const credential = GoogleAuthProvider.credential(data.idToken);
    const result = await signInWithCredential(auth, credential);

    // Also grab the access token for Gmail/Calendar API calls
    let accessToken: string | null = null;
    try {
      const tokens = await gs.getTokens();
      accessToken = tokens.accessToken ?? null;
    } catch {
      // access token optional — APIs will just be unavailable
    }

    return { user: result.user, accessToken };
  },

  // Refresh / retrieve current Google access token.
  // getTokens() throws SIGN_IN_REQUIRED when the native session isn't active
  // (even though Firebase Auth is restored from AsyncStorage). Fall back to
  // signInSilently() which re-establishes the native session without UI.
  async getAccessToken(): Promise<string | null> {
    const gs = googleSignin();
    if (!gs) return null;
    try {
      const tokens = await gs.getTokens();
      return tokens.accessToken ?? null;
    } catch {
      try {
        const result = await gs.signInSilently();
        if (!result?.data?.idToken) return null;
        const tokens = await gs.getTokens();
        return tokens.accessToken ?? null;
      } catch {
        return null;
      }
    }
  },

  async signInWithApple(): Promise<User> {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple sign-in failed: no identity token');
    const provider = new OAuthProvider('apple.com');
    const oauthCredential = provider.credential({ idToken: credential.identityToken });
    const result = await signInWithCredential(auth, oauthCredential);
    return result.user;
  },

  async signOut(): Promise<void> {
    await firebaseSignOut(auth);
    try { googleSignin()?.signOut(); } catch { /* ignore */ }
  },

  onAuthStateChange(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  },

  getCurrentUser(): User | null {
    return auth.currentUser;
  },
};

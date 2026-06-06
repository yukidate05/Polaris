import { callFunction } from './functionsService';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@lib/firebase';

const CHATWORK_AUTH_URL  = 'https://www.chatwork.com/packages/oauth2/login.php';
const REDIRECT_URI       = 'https://yukidate05.github.io/Polaris/chatwork-callback';
const CHATWORK_CLIENT_ID = process.env.EXPO_PUBLIC_CHATWORK_CLIENT_ID ?? '';

export interface ChatworkMessage {
  roomName:    string;
  accountName: string;
  body:        string;
  sendTime:    number;
  isMention:   boolean;
}

export const chatworkService = {
  getAuthUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CHATWORK_CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      scope:         'rooms.all:read offline_access',
    });
    return `${CHATWORK_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<{ name: string }> {
    return callFunction<{ name: string }>('chatworkAuth', { code, redirectUri: REDIRECT_URI });
  },

  async isConnected(): Promise<boolean> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return false;
    const snap = await getDoc(doc(db, 'users', uid));
    return !!snap.data()?.chatworkAccessToken;
  },

  async disconnect(): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid), {
      chatworkAccessToken:    deleteField(),
      chatworkRefreshToken:   deleteField(),
      chatworkTokenExpiresAt: deleteField(),
      chatworkName:           deleteField(),
    });
  },

  async getRecentMessages(): Promise<{ messages: ChatworkMessage[]; totalUnread: number }> {
    return callFunction<{ messages: ChatworkMessage[]; totalUnread: number }>('chatworkMessages', {});
  },
};

import { callFunction } from './functionsService';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@lib/firebase';

const TEAMS_AUTH_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const REDIRECT_URI    = 'https://yukidate05.github.io/Polaris/teams-callback';
const TEAMS_CLIENT_ID = process.env.EXPO_PUBLIC_TEAMS_CLIENT_ID ?? '';

export interface TeamsChat {
  chatType:        'oneOnOne' | 'group';
  topic:           string;
  lastMessageFrom: string;
  lastMessageText: string;
  lastMessageAt:   string;
}

export const teamsService = {
  getAuthUrl(): string {
    if (!TEAMS_CLIENT_ID) throw new Error('EXPO_PUBLIC_TEAMS_CLIENT_ID is not set');
    const params = new URLSearchParams({
      client_id:     TEAMS_CLIENT_ID,
      response_type: 'code',
      redirect_uri:  REDIRECT_URI,
      scope:         'Chat.Read offline_access openid profile',
      response_mode: 'query',
    });
    return `${TEAMS_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<{ displayName: string }> {
    return callFunction('teamsAuth', { code, redirectUri: REDIRECT_URI });
  },

  async isConnected(): Promise<boolean> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return false;
    const snap = await getDoc(doc(db, 'users', uid));
    return !!(snap.data()?.teamsAccessToken);
  },

  async disconnect(): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid), {
      teamsAccessToken:    deleteField(),
      teamsRefreshToken:   deleteField(),
      teamsTokenExpiresAt: deleteField(),
      teamsDisplayName:    deleteField(),
    });
  },

  async getRecentChats(): Promise<TeamsChat[]> {
    const data = await callFunction<{ chats: TeamsChat[] }>('teamsMessages', undefined, 'GET');
    return data.chats;
  },
};

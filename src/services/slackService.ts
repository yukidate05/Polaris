import { callFunction } from './functionsService';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@lib/firebase';

const SLACK_AUTH_URL  = 'https://slack.com/oauth/v2/authorize';
const REDIRECT_URI    = 'https://yukidate05.github.io/Polaris/slack-callback';
const SLACK_CLIENT_ID = process.env.EXPO_PUBLIC_SLACK_CLIENT_ID ?? '';
const MAX_WORKSPACES  = 5;

export interface SlackWorkspace {
  teamId:   string;
  teamName: string;
}

export interface SlackChannelMessages {
  workspace:   string;
  channelName: string;
  messages:    string[];
}

export const slackService = {
  getAuthUrl(): string {
    if (!SLACK_CLIENT_ID) throw new Error('EXPO_PUBLIC_SLACK_CLIENT_ID is not set');
    const params = new URLSearchParams({
      client_id:    SLACK_CLIENT_ID,
      user_scope:   'channels:read,channels:history,groups:read,groups:history,im:read,im:history,users:read',
      redirect_uri: REDIRECT_URI,
    });
    return `${SLACK_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<{ teamName: string; workspaceCount: number }> {
    return callFunction('slackAuth', { code, redirectUri: REDIRECT_URI });
  },

  async getWorkspaces(): Promise<SlackWorkspace[]> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return [];
    const snap = await getDoc(doc(db, 'users', uid));
    return (snap.data()?.slackWorkspaces ?? []) as SlackWorkspace[];
  },

  async isConnected(): Promise<boolean> {
    const workspaces = await slackService.getWorkspaces();
    return workspaces.length > 0;
  },

  canAddMore(count: number): boolean {
    return count < MAX_WORKSPACES;
  },

  async disconnectAll(): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid), { slackWorkspaces: deleteField() });
  },

  async disconnectWorkspace(teamId: string): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    const workspaces = await slackService.getWorkspaces();
    const updated = (workspaces as (SlackWorkspace & { accessToken?: string })[])
      .filter(w => w.teamId !== teamId);
    await setDoc(doc(db, 'users', uid), { slackWorkspaces: updated }, { merge: true });
  },

  async getRecentMessages(): Promise<{ channels: SlackChannelMessages[]; totalUnread: number }> {
    return callFunction<{ channels: SlackChannelMessages[]; totalUnread: number }>('slackMessages', undefined, 'GET');
  },
};

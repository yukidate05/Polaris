import { callFunction } from './functionsService';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '@lib/firebase';

const NOTION_AUTH_URL  = 'https://api.notion.com/v1/oauth/authorize';
const REDIRECT_URI     = 'https://yukidate05.github.io/Polaris/notion-callback';

// Notion インテグレーション作成後にセット
const NOTION_CLIENT_ID = process.env.EXPO_PUBLIC_NOTION_CLIENT_ID ?? '';

export interface NotionPage {
  id:           string;
  title:        string;
  url:          string;
  lastEdited:   string;
  lastEditedBy?: string;
}

export const notionService = {
  getAuthUrl(): string {
    if (!NOTION_CLIENT_ID) throw new Error('EXPO_PUBLIC_NOTION_CLIENT_ID is not set');
    const params = new URLSearchParams({
      client_id:     NOTION_CLIENT_ID,
      response_type: 'code',
      owner:         'user',
      redirect_uri:  REDIRECT_URI,
    });
    return `${NOTION_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code: string): Promise<{ workspaceName: string }> {
    return callFunction('notionAuth', { code, redirectUri: REDIRECT_URI });
  },

  async isConnected(): Promise<boolean> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return false;
    const snap = await getDoc(doc(db, 'users', uid));
    return !!(snap.data()?.notionAccessToken);
  },

  async disconnect(): Promise<void> {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, 'users', uid), { notionAccessToken: deleteField() });
  },

  async getPages(): Promise<NotionPage[]> {
    const data = await callFunction<{ results: unknown[] }>('notionPages', undefined, 'GET');
    return (data.results as Array<{
      id: string;
      url: string;
      last_edited_time: string;
      last_edited_by?: { id?: string; name?: string };
      self_edited?: boolean;
      properties?: { title?: { title?: { plain_text: string }[] }[] };
    }>)
      .filter(p => !p.self_edited) // 自分が最終更新者のページは除外
      .map((p) => ({
        id:           p.id,
        url:          p.url,
        lastEdited:   p.last_edited_time,
        lastEditedBy: p.last_edited_by?.name,
        title:        (p.properties?.title as { title?: { plain_text: string }[] } | undefined)?.title?.[0]?.plain_text ?? '無題',
      }));
  },
};

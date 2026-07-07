// Fetches Gmail and Google Calendar data using Google OAuth access token.
// Requires these APIs enabled in Google Cloud Console:
//   - Gmail API (https://console.cloud.google.com/apis/library/gmail.googleapis.com)
//   - Google Calendar API (https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)

const GMAIL_BASE    = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export interface EmailSummary {
  from:     string;
  subject:  string;
  snippet?: string; // 本文冒頭プレビュー（Gmail snippet）
}

export interface CalendarEvent {
  title:     string;
  startTime: string; // "HH:MM" or "終日"
  location?: string;
}

export interface GoogleData {
  unreadCount:    number;
  topEmails:      EmailSummary[];
  todayEvents:    CalendarEvent[];
  tomorrowEvents: CalendarEvent[];
  fetchedAt:      Date;
}

// ── Mock data used in Expo Go (no real token available) ────────────────────────
export const MOCK_GOOGLE_DATA: GoogleData = {
  unreadCount: 12,
  topEmails: [
    { from: '山田太郎', subject: 'Q2レポートのフィードバックについて' },
    { from: 'GitHub', subject: '[polaris] New pull request: feat/auth-improvements' },
    { from: '鈴木花子', subject: '来週のミーティングの件' },
  ],
  todayEvents: [
    { title: 'チームスタンダップ', startTime: '09:00', location: 'Google Meet' },
    { title: 'プロジェクト定例', startTime: '14:00', location: '会議室B' },
    { title: 'プロダクトレビュー', startTime: '17:00' },
  ],
  tomorrowEvents: [
    { title: '1on1 with Manager', startTime: '10:00' },
    { title: 'マーケティング戦略会議', startTime: '15:00', location: '会議室A' },
  ],
  fetchedAt: new Date(),
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function gGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function parseFromName(raw: string): string {
  // "Taro Yamada <taro@example.com>" → "Taro Yamada"
  const match = raw.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const angle = raw.indexOf('<');
  if (angle > 0) return raw.slice(0, angle).trim();
  return raw.trim();
}

// ── Gmail ──────────────────────────────────────────────────────────────────────

interface GmailListResponse {
  messages?: { id: string }[];
  resultSizeEstimate?: number;
}

interface GmailMessageResponse {
  snippet?: string;
  payload?: {
    headers?: { name: string; value: string }[];
  };
}

async function fetchEmails(token: string): Promise<{ unreadCount: number; topEmails: EmailSummary[] }> {
  // 直近24時間 + メインタブのみ（プロモ・迷惑メール除外）
  // 日付境界（after:YYYY/MM/DDや「今日0時」固定）だと、日付が変わる前の夜間メールが
  // その日にも翌日にも一切拾われず恒久的に取りこぼされるため、Unix秒指定のafter:で
  // ローリング24時間窓にする（タイムゾーンの曖昧さも併せて解消される）
  const afterEpochSec = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const q = encodeURIComponent(`after:${afterEpochSec} category:primary`);

  const list = await gGet<GmailListResponse>(
    `${GMAIL_BASE}/messages?maxResults=50&q=${q}&fields=messages(id),resultSizeEstimate`,
    token
  );

  console.log('[gmail] last 24h emails:', list.messages?.length);
  const unreadCount = list.messages?.length ?? 0;
  const messages = list.messages ?? [];

  const topEmails: EmailSummary[] = [];
  // Fetch top 5 message headers in parallel
  const details = await Promise.allSettled(
    messages.slice(0, 5).map((m) =>
      gGet<GmailMessageResponse>(
        // snippet フィールドも取得（本文プレビュー）
        `${GMAIL_BASE}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&fields=snippet,payload(headers)`,
        token
      )
    )
  );

  for (const r of details) {
    if (r.status !== 'fulfilled') continue;
    const headers = r.value.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '件名なし';
    const fromRaw = headers.find((h) => h.name === 'From')?.value ?? '';
    // snippet は HTML エンティティをデコードして最大200字
    const rawSnippet = r.value.snippet ?? '';
    const snippet = rawSnippet
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .slice(0, 200)
      .trim() || undefined;
    topEmails.push({ from: parseFromName(fromRaw), subject, snippet });
  }

  return { unreadCount, topEmails };
}

// ── Calendar ───────────────────────────────────────────────────────────────────

interface CalendarEventItem {
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
}

interface CalendarListResponse {
  items?: CalendarEventItem[];
}

async function fetchCalendar(token: string): Promise<{ todayEvents: CalendarEvent[]; tomorrowEvents: CalendarEvent[] }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const params = new URLSearchParams({
    timeMin:       todayStart.toISOString(),
    timeMax:       tomorrowEnd.toISOString(),
    singleEvents:  'true',
    orderBy:       'startTime',
    maxResults:    '20',
  });

  const data = await gGet<CalendarListResponse>(
    `${CALENDAR_BASE}/calendars/primary/events?${params}`,
    token
  );

  const todayEvents: CalendarEvent[] = [];
  const tomorrowEvents: CalendarEvent[] = [];

  for (const item of data.items ?? []) {
    const rawStart = item.start?.dateTime ?? item.start?.date ?? '';
    const startDate = new Date(rawStart);
    const isToday = startDate >= todayStart && startDate < todayEnd;

    const startTime = item.start?.dateTime
      ? startDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '終日';

    const ev: CalendarEvent = {
      title:    item.summary ?? '無題',
      startTime,
      location: item.location,
    };

    if (isToday) todayEvents.push(ev);
    else tomorrowEvents.push(ev);
  }

  return { todayEvents, tomorrowEvents };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const googleDataService = {
  async fetchAll(accessToken: string): Promise<GoogleData> {
    const [emailResult, calendarResult] = await Promise.allSettled([
      fetchEmails(accessToken),
      fetchCalendar(accessToken),
    ]);

    const emails   = emailResult.status   === 'fulfilled' ? emailResult.value   : { unreadCount: 0, topEmails: [] };
    const calendar = calendarResult.status === 'fulfilled' ? calendarResult.value : { todayEvents: [], tomorrowEvents: [] };

    return {
      ...emails,
      ...calendar,
      fetchedAt: new Date(),
    };
  },
};

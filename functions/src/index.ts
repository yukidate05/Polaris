import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
export const db = getFirestore();

// ── Secrets ──────────────────────────────────────────────────────────────────
const GEMINI_KEY        = defineSecret('GEMINI_API_KEY');
const NOTION_CLIENT_ID  = defineSecret('NOTION_CLIENT_ID');
const NOTION_CLIENT_SECRET = defineSecret('NOTION_CLIENT_SECRET');
const SLACK_CLIENT_ID     = defineSecret('SLACK_CLIENT_ID');
const SLACK_CLIENT_SECRET = defineSecret('SLACK_CLIENT_SECRET');
const TEAMS_CLIENT_ID     = defineSecret('TEAMS_CLIENT_ID');
const TEAMS_CLIENT_SECRET = defineSecret('TEAMS_CLIENT_SECRET');
const CHATWORK_CLIENT_ID     = defineSecret('CHATWORK_CLIENT_ID');
const CHATWORK_CLIENT_SECRET = defineSecret('CHATWORK_CLIENT_SECRET');

// ── Auth helper ───────────────────────────────────────────────────────────────
import { getAuth } from 'firebase-admin/auth';

async function verifyUser(req: Parameters<Parameters<typeof onRequest>[0]>[0]): Promise<string | null> {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

// ── Subscription check (server-authoritative) ─────────────────────────────────
const TRIAL_DAYS         = 5;
const FREE_COOLDOWN_DAYS = 3;

async function checkSubscription(uid: string): Promise<{ allowed: boolean; message: string }> {
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.data() ?? {};

  if (data.plan === 'pro') return { allowed: true, message: 'pro' };

  const firstOpenedAt: Date = data.firstOpenedAt?.toDate?.() ?? new Date();
  const trialEnd = new Date(firstOpenedAt.getTime() + TRIAL_DAYS * 86_400_000);
  if (new Date() < trialEnd) return { allowed: true, message: 'trial' };

  const lastFreeUseAt: Date | null = data.lastFreeUseAt?.toDate?.() ?? null;
  if (!lastFreeUseAt) return { allowed: true, message: 'free_first' };

  const lastDay = new Date(lastFreeUseAt);
  lastDay.setHours(0, 0, 0, 0);
  const nextFreeDay = new Date(lastDay);
  nextFreeDay.setDate(nextFreeDay.getDate() + FREE_COOLDOWN_DAYS);
  if (new Date() < nextFreeDay) return { allowed: false, message: 'cooldown_active' };

  return { allowed: true, message: 'free' };
}

// ── Rate limit check (per-user, per-endpoint) ─────────────────────────────────
// Returns true if the call is allowed; updates the timestamp as a side effect.
async function checkRateLimit(uid: string, field: string, windowMs: number): Promise<boolean> {
  const ref  = db.collection('users').doc(uid);
  const snap = await ref.get();
  const last: number = snap.data()?.[field]?.toMillis?.() ?? 0;
  if (Date.now() - last < windowMs) return false;
  ref.update({ [field]: FieldValue.serverTimestamp() }).catch(() => {});
  return true;
}

// ── Gemini proxy ──────────────────────────────────────────────────────────────
export const gemini = onRequest(
  { secrets: [GEMINI_KEY], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { prompt, systemPrompt, useSearch } = req.body as {
      prompt: string;
      systemPrompt: string;
      useSearch?: boolean;
    };

    if (!prompt || !systemPrompt) { res.status(400).send('Missing prompt or systemPrompt'); return; }

    // Input length validation
    if (prompt.length > 30_000)       { res.status(400).send('prompt too long'); return; }
    if (systemPrompt.length > 10_000) { res.status(400).send('systemPrompt too long'); return; }

    // Server-side subscription check
    const access = await checkSubscription(uid);
    if (!access.allowed) { res.status(429).send(access.message); return; }

    const model = 'gemini-2.5-flash';
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY.value()}`;

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: useSearch ? {} : { responseMimeType: 'application/json' },
    };

    if (useSearch) {
      body.tools = [{ googleSearch: {} }];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).send(err);
      return;
    }

    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.json({ text });
  }
);

// ── Gemini TTS proxy (multiSpeaker dialogue + preview) ───────────────────────
function buildWavHeader(pcmLength: number): Buffer {
  const sampleRate    = 24000;
  const bitsPerSample = 16;
  const channels      = 1;
  const byteRate      = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign    = channels * (bitsPerSample / 8);
  const buf           = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + pcmLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(pcmLength, 40);
  return buf;
}

export const geminiTts = onRequest(
  { secrets: [GEMINI_KEY], cors: true, region: 'asia-northeast1', timeoutSeconds: 300, memory: '1GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { transcript, speakerConfigs } = req.body as {
      transcript:     string;
      speakerConfigs: { speaker: string; voice: string }[];
    };
    if (!transcript || !speakerConfigs?.length) {
      res.status(400).send('Missing transcript or speakerConfigs');
      return;
    }

    // Input length validation
    if (transcript.length > 15_000) { res.status(400).send('transcript too long'); return; }

    // Subscription check + rate limit (2 min window — 1 briefing audio per session)
    const access = await checkSubscription(uid);
    if (!access.allowed) { res.status(429).send(access.message); return; }

    const rateLimitOk = await checkRateLimit(uid, 'geminiTtsLastCallAt', 2 * 60_000);
    if (!rateLimitOk) { res.status(429).send('rate_limited'); return; }

    const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_KEY.value()}`;

    const response = await fetch(GEMINI_TTS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: transcript }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: speakerConfigs.map(sc => ({
                speaker:     sc.speaker,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: sc.voice } },
              })),
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).send(err);
      return;
    }

    const data = await response.json() as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const pcmBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? '';
    if (!pcmBase64) { res.status(500).send('No audio data in Gemini TTS response'); return; }

    const pcm    = Buffer.from(pcmBase64, 'base64');
    const header = buildWavHeader(pcm.length);
    const wav    = Buffer.concat([header, pcm]);

    res.json({ audioBase64: wav.toString('base64'), mimeType: 'audio/wav' });
  }
);

// ── Google TTS proxy (single voice + dialogue) ────────────────────────────────
const GOOGLE_TTS_SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_VOICES = {
  A: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B', ssmlGender: 'FEMALE' },
  B: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-C', ssmlGender: 'MALE'   },
} as const;

async function googleSynthesize(text: string, speaker: 'A' | 'B', apiKey: string): Promise<Buffer> {
  const resp = await fetch(`${GOOGLE_TTS_SYNTH_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input:       { text },
      voice:       GOOGLE_VOICES[speaker],
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0.0 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`gcloud-tts:${resp.status} ${body.slice(0, 100)}`);
  }
  const { audioContent } = await resp.json() as { audioContent: string };
  return Buffer.from(audioContent, 'base64');
}

export const googleTts = onRequest(
  { secrets: [GEMINI_KEY], cors: true, region: 'asia-northeast1', timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { text, dialogue } = req.body as {
      text?:     string;
      dialogue?: { speaker: 'A' | 'B'; text: string }[];
    };

    if (!text && !dialogue?.length) {
      res.status(400).send('Missing text or dialogue');
      return;
    }

    // Input length validation
    if (text && text.length > 2_000) { res.status(400).send('text too long'); return; }
    if (dialogue) {
      const tooLong = dialogue.some(t => t.text.length > 200);
      if (tooLong) { res.status(400).send('dialogue turn too long'); return; }
      if (dialogue.length > 200) { res.status(400).send('too many dialogue turns'); return; }
    }

    const apiKey = GEMINI_KEY.value();

    if (text) {
      const mp3 = await googleSynthesize(text, 'A', apiKey);
      res.json({ audioBase64: mp3.toString('base64'), mimeType: 'audio/mp3' });
      return;
    }

    // Dialogue: process in batches of 5
    const BATCH    = 5;
    const segments: Buffer[] = [];
    for (let i = 0; i < dialogue!.length; i += BATCH) {
      const batch   = dialogue!.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(t => googleSynthesize(t.text, t.speaker, apiKey)));
      segments.push(...results);
    }
    res.json({ audioBase64: Buffer.concat(segments).toString('base64'), mimeType: 'audio/mp3' });
  }
);

// ── Notion OAuth token exchange ───────────────────────────────────────────────
export const notionAuth = onRequest(
  { secrets: [NOTION_CLIENT_ID, NOTION_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { code, redirectUri } = req.body as { code: string; redirectUri: string };
    if (!code || !redirectUri) { res.status(400).send('Missing code or redirectUri'); return; }

    const credentials = Buffer.from(
      `${NOTION_CLIENT_ID.value()}:${NOTION_CLIENT_SECRET.value()}`
    ).toString('base64');

    const response = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).send(err);
      return;
    }

    const data = await response.json() as {
      access_token: string;
      workspace_id: string;
      workspace_name: string;
      workspace_icon: string | null;
    };

    // Firestoreにアクセストークンを保存
    await db.collection('users').doc(uid).set({
      notionAccessToken: data.access_token,
      notionWorkspaceId: data.workspace_id,
      notionWorkspaceName: data.workspace_name,
    }, { merge: true });

    res.json({ success: true, workspaceName: data.workspace_name });
  }
);

// ── Slack OAuth token exchange ────────────────────────────────────────────────
export const slackAuth = onRequest(
  { secrets: [SLACK_CLIENT_ID, SLACK_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { code, redirectUri } = req.body as { code: string; redirectUri: string };
    if (!code || !redirectUri) { res.status(400).send('Missing code or redirectUri'); return; }

    const credentials = Buffer.from(
      `${SLACK_CLIENT_ID.value()}:${SLACK_CLIENT_SECRET.value()}`
    ).toString('base64');

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ code, redirect_uri: redirectUri }).toString(),
    });

    const data = await response.json() as {
      ok: boolean;
      error?: string;
      authed_user?: { access_token: string };
      team?: { id: string; name: string };
    };

    if (!data.ok) {
      res.status(400).send(data.error ?? 'slack_oauth_failed');
      return;
    }

    const userToken = data.authed_user?.access_token;
    const teamId    = data.team?.id ?? '';
    const teamName  = data.team?.name ?? 'Slack';

    if (!userToken) { res.status(400).send('No user token returned'); return; }

    const userSnap   = await db.collection('users').doc(uid).get();
    const existing   = (userSnap.data()?.slackWorkspaces ?? []) as { teamId: string; teamName: string; accessToken: string }[];
    const alreadyIdx = existing.findIndex(w => w.teamId === teamId);

    let updated: { teamId: string; teamName: string; accessToken: string }[];
    if (alreadyIdx >= 0) {
      // 既存ワークスペースのトークンを更新
      updated = existing.map((w, i) => i === alreadyIdx ? { teamId, teamName, accessToken: userToken } : w);
    } else if (existing.length >= 5) {
      res.status(400).send('workspace_limit_reached');
      return;
    } else {
      updated = [...existing, { teamId, teamName, accessToken: userToken }];
    }

    await db.collection('users').doc(uid).set({ slackWorkspaces: updated }, { merge: true });
    res.json({ success: true, teamName, workspaceCount: updated.length });
  }
);

// ── Slack recent messages ─────────────────────────────────────────────────────
export const slackMessages = onRequest(
  { cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const snap       = await db.collection('users').doc(uid).get();
    const workspaces = (snap.data()?.slackWorkspaces ?? []) as { teamId: string; teamName: string; accessToken: string }[];
    if (!workspaces.length) { res.status(404).send('Slack not connected'); return; }

    const oldest = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000).toString();

    async function fetchWorkspaceChannels(ws: { teamName: string; accessToken: string }) {
      const channelsRes  = await fetch(
        'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=10',
        { headers: { 'Authorization': `Bearer ${ws.accessToken}` } }
      );
      const channelsData = await channelsRes.json() as {
        ok: boolean;
        channels?: { id: string; name: string; is_member: boolean }[];
      };
      if (!channelsData.ok || !channelsData.channels?.length) return [];

      const joined = channelsData.channels.filter(c => c.is_member).slice(0, 3);
      const results = await Promise.all(
        joined.map(async (ch) => {
          const histRes  = await fetch(
            `https://slack.com/api/conversations.history?channel=${ch.id}&oldest=${oldest}&limit=15`,
            { headers: { 'Authorization': `Bearer ${ws.accessToken}` } }
          );
          const histData = await histRes.json() as { ok: boolean; messages?: { text: string }[] };
          const messages = (histData.messages ?? [])
            .map(m => m.text)
            .filter(t => t && !t.startsWith('<') && t.length > 5)
            .slice(0, 8);
          return { workspace: ws.teamName, channelName: ch.name, messages };
        })
      );
      return results.filter(r => r.messages.length > 0);
    }

    const allResults = (await Promise.all(workspaces.map(fetchWorkspaceChannels))).flat();
    res.json({ channels: allResults });
  }
);

// ── Microsoft Teams OAuth token exchange ──────────────────────────────────────
export const teamsAuth = onRequest(
  { secrets: [TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { code, redirectUri } = req.body as { code: string; redirectUri: string };
    if (!code || !redirectUri) { res.status(400).send('Missing code or redirectUri'); return; }

    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     TEAMS_CLIENT_ID.value(),
        client_secret: TEAMS_CLIENT_SECRET.value(),
        code,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        scope:         'Chat.Read offline_access openid profile',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      res.status(tokenRes.status).send(err);
      return;
    }

    const tokenData = await tokenRes.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
    };

    // ユーザープロフィール取得
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as { displayName?: string };

    const expiresAt = Date.now() + tokenData.expires_in * 1000;

    await db.collection('users').doc(uid).set({
      teamsAccessToken:    tokenData.access_token,
      teamsRefreshToken:   tokenData.refresh_token,
      teamsTokenExpiresAt: expiresAt,
      teamsDisplayName:    profile.displayName ?? 'Microsoft Teams',
    }, { merge: true });

    res.json({ success: true, displayName: profile.displayName ?? 'Microsoft Teams' });
  }
);

// ── Microsoft Teams recent chats ──────────────────────────────────────────────
export const teamsMessages = onRequest(
  { secrets: [TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data();
    if (!data?.teamsAccessToken) { res.status(404).send('Teams not connected'); return; }

    let accessToken   = data.teamsAccessToken as string;
    const expiresAt   = data.teamsTokenExpiresAt as number;
    const refreshToken = data.teamsRefreshToken as string;

    // 5分前倒しでトークンリフレッシュ
    if (Date.now() >= expiresAt - 5 * 60 * 1000) {
      const refreshRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     TEAMS_CLIENT_ID.value(),
          client_secret: TEAMS_CLIENT_SECRET.value(),
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
          scope:         'Chat.Read offline_access openid profile',
        }).toString(),
      });

      if (!refreshRes.ok) {
        // リフレッシュ失敗 → 再認証が必要
        await db.collection('users').doc(uid).update({
          teamsAccessToken:  FieldValue.delete(),
          teamsRefreshToken: FieldValue.delete(),
        });
        res.status(401).send('teams_token_expired');
        return;
      }

      const newTokens = await refreshRes.json() as {
        access_token:  string;
        refresh_token: string;
        expires_in:    number;
      };

      accessToken = newTokens.access_token;
      await db.collection('users').doc(uid).update({
        teamsAccessToken:    newTokens.access_token,
        teamsRefreshToken:   newTokens.refresh_token,
        teamsTokenExpiresAt: Date.now() + newTokens.expires_in * 1000,
      });
    }

    // 最新チャット一覧を取得（lastMessagePreviewを展開）
    const chatsRes = await fetch(
      'https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview&$top=15',
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!chatsRes.ok) {
      res.status(chatsRes.status).send(await chatsRes.text());
      return;
    }

    const chatsData = await chatsRes.json() as {
      value: Array<{
        chatType: string;
        topic:    string | null;
        lastMessagePreview?: {
          body?: { content?: string };
          from?: { user?: { displayName?: string } };
          createdDateTime?: string;
        };
      }>;
    };

    const chats = (chatsData.value ?? [])
      .filter(c => c.lastMessagePreview?.body?.content && c.chatType !== 'meeting')
      .map(c => ({
        chatType:        (c.chatType === 'oneOnOne' ? 'oneOnOne' : 'group') as 'oneOnOne' | 'group',
        topic:           c.topic ?? `DM (${c.lastMessagePreview?.from?.user?.displayName ?? '?'})`,
        lastMessageFrom: c.lastMessagePreview?.from?.user?.displayName ?? '不明',
        lastMessageText: stripHtml(c.lastMessagePreview?.body?.content ?? '').slice(0, 200),
        lastMessageAt:   c.lastMessagePreview?.createdDateTime ?? '',
      }))
      .filter(c => c.lastMessageText.length > 0)
      .slice(0, 10);

    res.json({ chats });
  }
);

// ── Chatwork OAuth token exchange ─────────────────────────────────────────────
export const chatworkAuth = onRequest(
  { secrets: [CHATWORK_CLIENT_ID, CHATWORK_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { code, redirectUri } = req.body as { code: string; redirectUri: string };
    if (!code || !redirectUri) { res.status(400).send('Missing code or redirectUri'); return; }

    const credentials = Buffer.from(
      `${CHATWORK_CLIENT_ID.value()}:${CHATWORK_CLIENT_SECRET.value()}`
    ).toString('base64');

    const tokenRes = await fetch('https://oauth.chatwork.com/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      res.status(tokenRes.status).send(err);
      return;
    }

    const tokenData = await tokenRes.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
    };

    // ユーザー情報取得
    const meRes = await fetch('https://api.chatwork.com/v2/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json() as { name?: string };

    const expiresAt = Date.now() + tokenData.expires_in * 1000;

    await db.collection('users').doc(uid).set({
      chatworkAccessToken:    tokenData.access_token,
      chatworkRefreshToken:   tokenData.refresh_token,
      chatworkTokenExpiresAt: expiresAt,
      chatworkName:           me.name ?? 'Chatwork',
    }, { merge: true });

    res.json({ success: true, name: me.name ?? 'Chatwork' });
  }
);

// ── Chatwork recent messages ───────────────────────────────────────────────────
export const chatworkMessages = onRequest(
  { secrets: [CHATWORK_CLIENT_ID, CHATWORK_CLIENT_SECRET], cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data();
    if (!data?.chatworkAccessToken) { res.status(404).send('Chatwork not connected'); return; }

    let accessToken    = data.chatworkAccessToken as string;
    const expiresAt    = data.chatworkTokenExpiresAt as number;
    const refreshToken = data.chatworkRefreshToken as string;

    // 5分前倒しでトークンリフレッシュ
    if (Date.now() >= expiresAt - 5 * 60 * 1000) {
      const credentials = Buffer.from(
        `${CHATWORK_CLIENT_ID.value()}:${CHATWORK_CLIENT_SECRET.value()}`
      ).toString('base64');

      const refreshRes = await fetch('https://oauth.chatwork.com/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!refreshRes.ok) {
        await db.collection('users').doc(uid).update({
          chatworkAccessToken:  FieldValue.delete(),
          chatworkRefreshToken: FieldValue.delete(),
        });
        res.status(401).send('chatwork_token_expired');
        return;
      }

      const newTokens = await refreshRes.json() as {
        access_token:  string;
        refresh_token: string;
        expires_in:    number;
      };

      accessToken = newTokens.access_token;
      await db.collection('users').doc(uid).update({
        chatworkAccessToken:    newTokens.access_token,
        chatworkRefreshToken:   newTokens.refresh_token,
        chatworkTokenExpiresAt: Date.now() + newTokens.expires_in * 1000,
      });
    }

    // ルーム一覧取得（最終更新順）
    const roomsRes = await fetch('https://api.chatwork.com/v2/rooms', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!roomsRes.ok) {
      res.status(roomsRes.status).send(await roomsRes.text());
      return;
    }

    const rooms = await roomsRes.json() as Array<{
      room_id:          number;
      name:             string;
      last_update_time: number;
    }>;

    // 最近更新された上位3ルームのメッセージを取得
    const topRooms = rooms
      .sort((a, b) => b.last_update_time - a.last_update_time)
      .slice(0, 3);

    const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

    const allMessages: Array<{ roomName: string; accountName: string; body: string; sendTime: number }> = [];

    for (const room of topRooms) {
      const msgsRes = await fetch(
        `https://api.chatwork.com/v2/rooms/${room.room_id}/messages?force=0`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!msgsRes.ok) continue;

      const msgs = await msgsRes.json() as Array<{
        account:   { name: string };
        body:      string;
        send_time: number;
      }>;

      const recent = msgs
        .filter(m => m.send_time >= since && m.body && !m.body.startsWith('[To:'))
        .slice(-5)
        .map(m => ({
          roomName:    room.name,
          accountName: m.account.name,
          body:        m.body.replace(/\[.*?\]/g, '').trim().slice(0, 200),
          sendTime:    m.send_time,
        }))
        .filter(m => m.body.length > 3);

      allMessages.push(...recent);
    }

    // 時系列降順で最大15件
    allMessages.sort((a, b) => b.sendTime - a.sendTime);
    res.json({ messages: allMessages.slice(0, 15) });
  }
);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Notion pages fetch ────────────────────────────────────────────────────────
export const notionPages = onRequest(
  { cors: true, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const snap = await db.collection('users').doc(uid).get();
    const token = snap.data()?.notionAccessToken as string | undefined;
    if (!token) { res.status(404).send('Notion not connected'); return; }

    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 20,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).send(err);
      return;
    }

    const data = await response.json();
    res.json(data);
  }
);

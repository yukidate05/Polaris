import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { randomUUID } from 'crypto';
import { db, GEMINI_KEY, checkSubscription, buildWavHeader, googleSynthesize } from './shared';

export { db };
export { briefingWorker } from './briefingWorker';

// ── Secrets ──────────────────────────────────────────────────────────────────
const NOTION_CLIENT_ID  = defineSecret('NOTION_CLIENT_ID');
const NOTION_CLIENT_SECRET = defineSecret('NOTION_CLIENT_SECRET');
const SLACK_CLIENT_ID     = defineSecret('SLACK_CLIENT_ID');
const SLACK_CLIENT_SECRET = defineSecret('SLACK_CLIENT_SECRET');
const TEAMS_CLIENT_ID     = defineSecret('TEAMS_CLIENT_ID');
const TEAMS_CLIENT_SECRET = defineSecret('TEAMS_CLIENT_SECRET');
const CHATWORK_CLIENT_ID       = defineSecret('CHATWORK_CLIENT_ID');
const CHATWORK_CLIENT_SECRET   = defineSecret('CHATWORK_CLIENT_SECRET');
const REVENUECAT_WEBHOOK_SECRET = defineSecret('REVENUECAT_WEBHOOK_SECRET');

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
  { secrets: [GEMINI_KEY], cors: true, region: 'asia-northeast1', timeoutSeconds: 180 },
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

    // Input length validation (Gemini 2.5 Flash supports 1M token context)
    if (prompt.length > 200_000)      { res.status(400).send('prompt too long'); return; }
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

    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; promptFeedback?: unknown };
    const parts = data.candidates?.[0]?.content?.parts ?? [];

    // Gemini 2.5 Flash: thought=true のパーツは思考トークン、thought=false/undefined が実際のレスポンス
    // thought フラグがない場合やすべて thought=true の場合は、"chapters" キーを含むパーツを優先
    const responsePartWithJson = parts.find(p => !p.thought && p.text?.includes('"chapters"'));
    const responsePartAny      = parts.find(p => !p.thought && p.text);
    const text = responsePartWithJson?.text ?? responsePartAny?.text ?? parts[0]?.text ?? '';

    // Always log response shape for diagnostics
    const thoughtParts = parts.filter(p => p.thought).length;
    console.log(`[gemini] parts=${parts.length} thought=${thoughtParts} textLen=${text.length} hasChapters=${text.includes('"chapters"')} preview=${text.slice(0, 80).replace(/\n/g, ' ')}`);
    if (!text || text.length < 100) {
      console.error('[gemini] suspicious response - parts:', JSON.stringify(parts).slice(0, 500), 'promptFeedback:', JSON.stringify(data.promptFeedback));
    }
    res.json({ text });
  }
);

// ── Gemini TTS proxy (multiSpeaker dialogue + preview) ───────────────────────
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

    const rateLimitOk = await checkRateLimit(uid, 'geminiTtsLastCallAt', 30_000);
    if (!rateLimitOk) { res.status(429).send('rate_limited'); return; }

    // All validation passed — start streaming 200 OK immediately.
    // iOS NSURLSession has a 60s inactivity timeout (timeoutIntervalForRequest).
    // Gemini TTS takes 160-200s, so we send periodic space bytes to reset that timer.
    // JSON.parse() ignores leading whitespace, so the client parses the final JSON correctly.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const heartbeat = setInterval(() => { try { res.write(' '); } catch {} }, 15_000);

    const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_KEY.value()}`;

    try {
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
        clearInterval(heartbeat);
        // Status already committed as 200 — encode error in body so client can detect and fall back
        res.end(`[geminiTts] ${response.status}: ${err}`);
        return;
      }

      const data = await response.json() as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
      };
      const pcmBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? '';
      if (!pcmBase64) {
        clearInterval(heartbeat);
        res.end('[geminiTts] No audio data in Gemini TTS response');
        return;
      }

      const pcm    = Buffer.from(pcmBase64, 'base64');
      const header = buildWavHeader(pcm.length);
      const wav    = Buffer.concat([header, pcm]);

      const BUCKET_NAME = 'polaris-app-yukid.firebasestorage.app';
      const bucket   = getStorage().bucket(BUCKET_NAME);
      const uuid     = randomUUID();
      const fileName = `audio/${uid}/brief.wav`;
      const file     = bucket.file(fileName);
      try {
        await file.save(wav, {
          resumable: false,
          metadata: {
            contentType: 'audio/wav',
            metadata: { firebaseStorageDownloadTokens: uuid },
          },
        });
      } catch (storageErr) {
        console.error('[geminiTts] Storage upload failed:', storageErr);
        clearInterval(heartbeat);
        res.end(`[geminiTts] Storage upload failed: ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`);
        return;
      }
      const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET_NAME)}/o/${encodeURIComponent(fileName)}?alt=media&token=${uuid}`;
      // Write result to Firestore so client can poll if HTTP connection dropped
      db.collection('users').doc(uid).set(
        { ttsAudioUrl: audioUrl, ttsUpdatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      ).catch(e => console.error('[geminiTts] Firestore write failed:', e));
      clearInterval(heartbeat);
      res.end(JSON.stringify({ audioUrl, mimeType: 'audio/wav' }));
    } catch (err) {
      clearInterval(heartbeat);
      res.end(`[geminiTts] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// ── Google TTS proxy (single voice + dialogue) ────────────────────────────────
export const googleTts = onRequest(
  { secrets: [GEMINI_KEY], cors: true, region: 'asia-northeast1', timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const uid = await verifyUser(req);
    if (!uid) { res.status(401).send('Unauthorized'); return; }

    const { text, dialogue, language } = req.body as {
      text?:     string;
      dialogue?: { speaker: 'A' | 'B'; text: string }[];
      language?: string;
    };
    const lang = language ?? 'ja';

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
      const mp3 = await googleSynthesize(text, 'A', apiKey, lang);
      res.json({ audioBase64: mp3.toString('base64'), mimeType: 'audio/mp3' });
      return;
    }

    // Dialogue: process in batches of 5
    const BATCH    = 5;
    const segments: Buffer[] = [];
    for (let i = 0; i < dialogue!.length; i += BATCH) {
      const batch   = dialogue!.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(t => googleSynthesize(t.text, t.speaker, apiKey, lang)));
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
      owner?: { type?: string; user?: { id?: string; name?: string } };
    };

    // notionMyNameが取得できない場合、/users/me でbot情報から補完を試みる
    let notionMyName: string | null = data.owner?.user?.name ?? null;
    const notionOwnerId: string | null = data.owner?.user?.id ?? null;
    if (!notionMyName && notionOwnerId) {
      try {
        const meRes = await fetch(`https://api.notion.com/v1/users/${notionOwnerId}`, {
          headers: { 'Authorization': `Bearer ${data.access_token}`, 'Notion-Version': '2022-06-28' },
        });
        if (meRes.ok) {
          const me = await meRes.json() as { name?: string };
          notionMyName = me.name ?? null;
        }
      } catch { /* non-critical */ }
    }

    // Firestoreにアクセストークンを保存
    await db.collection('users').doc(uid).set({
      notionAccessToken: data.access_token,
      notionWorkspaceId: data.workspace_id,
      notionWorkspaceName: data.workspace_name,
      notionMyName,
      notionOwnerId,
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

    const oldest = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000).toString(); // 7日間

    async function fetchWorkspaceChannels(ws: { teamName: string; accessToken: string }) {
      type ConvChannel = { id: string; name: string; is_member?: boolean; is_im?: boolean; user?: string; unread_count?: number };
      type ConvListRes = { ok: boolean; error?: string; channels?: ConvChannel[] };

      // private_channel,mpim も試みる。スコープ不足なら public_channel,im にフォールバック
      let channelsData: ConvListRes = { ok: false };
      for (const types of ['public_channel,private_channel,mpim,im', 'public_channel,im']) {
        const r = await fetch(
          `https://slack.com/api/conversations.list?types=${types}&exclude_archived=true&limit=200`,
          { headers: { 'Authorization': `Bearer ${ws.accessToken}` } }
        );
        channelsData = await r.json() as ConvListRes;
        if (channelsData.ok) break;
        console.warn('[slack] conversations.list failed:', channelsData.error, '→ retrying with', types);
      }

      if (!channelsData.ok || !channelsData.channels?.length) {
        console.error('[slack] conversations.list ultimately failed:', channelsData.error);
        return { channels: [], totalUnread: 0 };
      }

      // 参加済みチャンネル（上位5件）+ 開いているDM（上位5件）
      // private_channel/mpim はリスト自体がメンバーのものだけなので is_member チェック不要
      const allConvs = channelsData.channels as ConvChannel[];
      const joinedChannels = allConvs.filter(c => !c.is_im && c.is_member !== false).slice(0, 5);
      const openDMs        = allConvs.filter(c => c.is_im).slice(0, 5);
      const targets        = [...joinedChannels, ...openDMs];

      // ユーザーID→名前のキャッシュ
      const userNameCache: Record<string, string> = {};
      async function resolveUser(userId: string): Promise<string> {
        if (userNameCache[userId]) return userNameCache[userId];
        try {
          const r = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
            headers: { 'Authorization': `Bearer ${ws.accessToken}` },
          });
          const d = await r.json() as { ok: boolean; user?: { real_name?: string; name?: string } };
          // ok:false = missing scope など。生IDは渡さず "メンバー" に置換
          const name = d.ok ? (d.user?.real_name || d.user?.name || 'メンバー') : 'メンバー';
          userNameCache[userId] = name;
          return name;
        } catch {
          return 'メンバー';
        }
      }

      // conversations.list の unread_count を使う（実際のSlack未読数）
      const totalUnread = targets.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

      const results: { workspace: string; channelName: string; messages: string[] }[] = [];

      // 未読があるチャンネルのみ履歴を取得（既読後にプレビューが消えるように）
      for (const conv of targets.filter(c => (c.unread_count ?? 0) > 0)) {
        const histRes  = await fetch(
          `https://slack.com/api/conversations.history?channel=${conv.id}&oldest=${oldest}&limit=30`,
          { headers: { 'Authorization': `Bearer ${ws.accessToken}` } }
        );
        const histData = await histRes.json() as { ok: boolean; messages?: { text: string; subtype?: string; user?: string; username?: string }[] };
        if (!histData.ok) continue;

        const rawMessages = (histData.messages ?? [])
          .filter(m => {
            if (!m.text || m.text.length <= 5) return false;
            if (conv.is_im) return !m.subtype || m.subtype === 'me_message' || m.subtype === 'bot_message';
            return !m.subtype && !m.text.startsWith('<');
          })
          .slice(0, 30)
          .reverse(); // 古い順（会話の流れ）

        // ユーザーID解決（並行）
        const userIds = [...new Set(rawMessages.map(m => m.user).filter(Boolean) as string[])];
        await Promise.all(userIds.map(id => resolveUser(id)));

        const messages = rawMessages.map(m => {
          const sender = m.username || (m.user ? userNameCache[m.user] || m.user : null);
          const text   = m.text.slice(0, 800);
          return sender ? `${sender}: ${text}` : text;
        });

        if (messages.length > 0) {
          const channelName = conv.is_im
            ? `DM${conv.user ? `(${conv.user})` : ''}`
            : (conv.name ?? 'unknown');
          results.push({ workspace: ws.teamName, channelName, messages });
        }
      }

      return { channels: results, totalUnread };
    }

    const allResults  = await Promise.all(workspaces.map(fetchWorkspaceChannels));
    const allChannels = allResults.flatMap(r => r.channels);
    const totalUnread = allResults.reduce((sum, r) => sum + r.totalUnread, 0);
    res.json({ channels: allChannels, totalUnread });
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
    console.log('[teamsMessages] expiresAt:', expiresAt, 'now:', Date.now(), 'needsRefresh:', Date.now() >= expiresAt - 5 * 60 * 1000);
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
        const refreshErr = await refreshRes.text();
        console.error('[teamsMessages] token refresh failed:', refreshRes.status, refreshErr);
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
      console.log('[teamsMessages] token refreshed, new expires_in:', newTokens.expires_in);
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
      const chatsErr = await chatsRes.text();
      console.error('[teamsMessages] chats API error:', chatsRes.status, chatsErr);
      // 401 のみトークン無効 → 削除して再接続を促す
      // 403 は権限不足（個人アカウント等）→ トークンは残して空配列を返す
      if (chatsRes.status === 401) {
        await db.collection('users').doc(uid).update({
          teamsAccessToken:  FieldValue.delete(),
          teamsRefreshToken: FieldValue.delete(),
        });
        res.status(401).send('teams_token_invalid');
        return;
      }
      if (chatsRes.status === 403) {
        res.json({ chats: [] });
        return;
      }
      res.status(chatsRes.status).send(chatsErr);
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
        const refreshErr = await refreshRes.text();
        console.error('[chatworkMessages] token refresh failed:', refreshRes.status, refreshErr);
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
      const errBody = await roomsRes.text();
      console.error('[chatworkMessages] rooms API error:', roomsRes.status, errBody);
      res.status(roomsRes.status).send(errBody);
      return;
    }

    const rooms = await roomsRes.json() as Array<{
      room_id:          number;
      name:             string;
      last_update_time: number;
      unread_num:       number;
    }>;

    // 全ルームの未読数合計（/rooms は既読にしない）
    const totalUnread = rooms.reduce((sum, r) => sum + (r.unread_num ?? 0), 0);

    // 未読ルームを優先（上位5件）、なければ最近更新された上位3ルーム
    const unreadRooms   = rooms.filter(r => r.unread_num > 0).slice(0, 5);
    const fallbackRooms = rooms.sort((a, b) => b.last_update_time - a.last_update_time).slice(0, 3);
    const topRooms      = unreadRooms.length > 0 ? unreadRooms : fallbackRooms;

    const since48h = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);

    const allMessages: Array<{ roomName: string; accountName: string; body: string; sendTime: number; isMention: boolean }> = [];

    for (const room of topRooms) {
      const msgsRes = await fetch(
        `https://api.chatwork.com/v2/rooms/${room.room_id}/messages?force=1`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!msgsRes.ok || msgsRes.status === 204) continue;

      const msgs = await msgsRes.json() as Array<{
        account:   { name: string };
        body:      string;
        send_time: number;
      }>;

      const since    = since48h;
      const maxMsgs  = 5; // ルームあたり最大5件（合計20件上限）

      const recent = msgs
        .filter(m => m.send_time >= since && m.body && m.body.trim().length > 3)
        .slice(-maxMsgs)
        .map(m => {
          const mentionMatch = m.body.match(/\[To:(\d+)\s+([^\]]+)\]/);
          const isMention = !!mentionMatch;
          const cleanBody = m.body
            .replace(/\[To:\d+\s+([^\]]+)\]/g, '@$1')
            .replace(/\[info\][\s\S]*?\[\/info\]/g, '')
            .replace(/\[.*?\]/g, '')
            .trim()
            .slice(0, 800); // 300 → 800字に拡大
          if (cleanBody.length < 3) return null;
          return {
            roomName:    room.name,
            accountName: m.account.name,
            body:        cleanBody,
            sendTime:    m.send_time,
            isMention,
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      allMessages.push(...recent);
    }

    // 時系列昇順（会話の流れが分かるように古い→新しい順）
    allMessages.sort((a, b) => a.sendTime - b.sendTime);
    res.json({ messages: allMessages.slice(0, 20), totalUnread });
  }
);

// ── RevenueCat webhook ────────────────────────────────────────────────────────
export const revenuecatWebhook = onRequest(
  { secrets: [REVENUECAT_WEBHOOK_SECRET], cors: false, region: 'asia-northeast1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== REVENUECAT_WEBHOOK_SECRET.value()) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { event } = req.body as {
      event?: { type: string; app_user_id: string };
    };

    if (!event?.app_user_id) { res.status(400).send('Missing event.app_user_id'); return; }

    const uid = event.app_user_id;
    const ref = db.collection('users').doc(uid);

    const ACTIVATE = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'TRANSFER', 'SUBSCRIBER_ALIAS'];
    const EXPIRE   = ['EXPIRATION', 'BILLING_ISSUE'];

    if (ACTIVATE.includes(event.type)) {
      await ref.set({ plan: 'pro' }, { merge: true });
      console.log(`[rcWebhook] ${event.type} → plan=pro uid=${uid}`);
    } else if (EXPIRE.includes(event.type)) {
      await ref.update({ plan: FieldValue.delete() });
      console.log(`[rcWebhook] ${event.type} → plan removed uid=${uid}`);
    } else {
      console.log(`[rcWebhook] ignored event=${event.type} uid=${uid}`);
    }

    res.status(200).send('OK');
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
    let notionOwnerId = snap.data()?.notionOwnerId as string | undefined;
    if (!token) { res.status(404).send('Notion not connected'); return; }

    // notionOwnerId未保存の既存ユーザー向け移行: Notion APIから取得して保存
    if (!notionOwnerId) {
      try {
        const meRes = await fetch('https://api.notion.com/v1/users/me', {
          headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
        });
        if (meRes.ok) {
          const me = await meRes.json() as { id?: string; name?: string };
          if (me.id) {
            notionOwnerId = me.id;
            const save: Record<string, string> = { notionOwnerId: me.id };
            if (me.name) save.notionMyName = me.name;
            db.collection('users').doc(uid).update(save).catch(() => {});
          }
        }
      } catch { /* non-critical */ }
    }

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

    const data = await response.json() as { results: Record<string, unknown>[]; next_cursor?: string };

    // Notion search returns last_edited_by with only user ID; resolve names via /users endpoint
    const editorIds = new Set<string>();
    for (const page of data.results) {
      const userId = (page.last_edited_by as { id?: string } | undefined)?.id;
      if (userId) editorIds.add(userId);
    }

    const editorNames: Record<string, string> = {};
    await Promise.all([...editorIds].slice(0, 10).map(async (userId) => {
      try {
        const userRes = await fetch(`https://api.notion.com/v1/users/${userId}`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
        });
        if (userRes.ok) {
          const u = await userRes.json() as { name?: string };
          if (u.name) editorNames[userId] = u.name;
        }
      } catch { /* non-critical */ }
    }));

    // Enrich pages with resolved editor names; flag self-edits so client can filter
    const enriched = {
      ...data,
      results: data.results.map((p) => {
        const by = p.last_edited_by as { id?: string; name?: string } | undefined;
        if (!by?.id) return p;
        const resolvedName = editorNames[by.id] ?? by.id;
        const isSelfEdit = notionOwnerId ? by.id === notionOwnerId : false;
        return { ...p, last_edited_by: { ...by, name: resolvedName }, self_edited: isSelfEdit };
      }),
    };
    res.json(enriched);
  }
);

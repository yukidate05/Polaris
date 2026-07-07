// Server-side briefing generation orchestrator.
//
// The client submits a job by writing users/{uid}/briefingJobs/current with
// status 'queued' and a payload (pre-built script prompt + host/news params),
// then observes the same document via onSnapshot. All slow work (Gemini script
// generation, news two-phase generation, TTS) runs here, so an Android process
// kill on the client no longer restarts generation or double-bills the APIs.
//
// State machine (each stage is one trigger invocation, well under the 540s cap):
//   queued           → stage A: script gen + news text gen      → tts_pending
//   tts_pending      → stage B: briefing TTS + push notification → news_tts_pending | completed
//   news_tts_pending → stage C: news TTS                         → completed
//
// Every transition is claimed via a compare-and-set transaction so duplicate
// event deliveries and stale worker instances (job overwritten mid-flight)
// cannot double-run or corrupt a newer job.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, DocumentReference } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  db, GEMINI_KEY, checkSubscription, callGeminiApi, parseChapters, splitTurns,
  extractJsonFromText, synthesizeGeminiTtsWav, synthesizeGoogleDialogueMp3,
  uploadUserAudio, type ChapterDraft, type DialogueTurn,
} from './shared';

// ── Job types ─────────────────────────────────────────────────────────────────

interface JobPayload {
  scriptPrompt:       string;
  scriptSystemPrompt: string;
  language:           string;                      // app lang code ('ja', 'en', ...)
  userName:           string;
  interests:          string[];
  topEmails:          { from: string; subject: string }[];
  hostNames:          { A: string; B: string };    // e.g. { A: 'Aria', B: 'Crest' }
  hostVoices:         { A: string; B: string };    // e.g. { A: 'Aoede', B: 'Charon' }
  hostStyles:         { A: string; B: string };
  hostDescriptions:   { A: string; B: string };
  isPro:              boolean;
}

interface JobDoc {
  jobId:   string;
  status:  string;
  payload: JobPayload;
  script?: { chapters: ChapterDraft[]; dialogue: DialogueTurn[]; estimatedSeconds: number };
  news?:   { chapters: ChapterDraft[]; dialogue: DialogueTurn[]; estimatedSeconds: number; targetMinutes: number };
}

// ── News prompt building (ported from client claudeService, length-tuned) ─────

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', en: 'English', zh: 'Chinese', ko: 'Korean',
  es: 'Spanish',  it: 'Italian', fr: 'French',  de: 'German',  pt: 'Portuguese',
};

function lineLengthInstruction(lang: string): string {
  if (['Japanese', 'Chinese', 'Korean'].includes(lang)) return '80–120 characters';
  return '15–25 words';
}

// Real Gemini output runs well short of the instructed line length, and the
// actual TTS audio runs shorter still than the char/5sec text estimate.
// Measured 2026-07-07 on production (ja): 40 raw lines → 367s of real audio
// (~9.2s/line, i.e. real audio ≈ 0.6× the text estimate). These constants are
// derived from that measurement so a 5-min target yields ≥5 min of real audio.
function avgLineChars(lang: string): number {
  return ['Japanese', 'Chinese', 'Korean'].includes(lang) ? 45 : 60;
}

function distributeCounts(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const rem  = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
}

const NEWS_DEEPDIVE_TEMPLATES: { id: string; title: string; iconName: string; lines: (theme: string, userName: string, lineLen: string) => string[] }[] = [
  {
    id: 'news_background', title: 'Background', iconName: 'globe-outline',
    lines: (theme, userName, lineLen) => [
      `Introduce today's deep-dive theme — ${theme} — and why it's the top story today, with a concrete company name or number (${lineLen})`,
      `Explain the background: how this came about, what led here (${lineLen})`,
      `Share a key fact or figure from today's research that grounds the story (${lineLen})`,
      `Explain who the key players/companies involved are and what's at stake for them (${lineLen})`,
      `Explain why this specifically matters for ${userName}'s work/interests (${lineLen})`,
      `Note an interesting or surprising detail most people miss about this story (${lineLen})`,
      `Add another concrete data point or expert reaction (${lineLen})`,
      `Compare this to a related past event or trend for context (${lineLen})`,
      `Explain a related detail the user probably hasn't heard yet (${lineLen})`,
      `Add one more piece of background that deepens the picture (${lineLen})`,
      `Describe how different stakeholders (users, competitors, regulators) first reacted (${lineLen})`,
      `Give a timeline recap: the key dates/milestones that led to today (${lineLen})`,
      `Share what the people or company at the center have said publicly about it (${lineLen})`,
    ],
  },
  {
    id: 'news_deepdive', title: 'Deep Dive', iconName: 'search-outline',
    lines: (theme, _userName, lineLen) => [
      `Dig into a second angle or contrasting viewpoint on ${theme} (${lineLen})`,
      `Discuss risks, controversies, or open questions around this story (${lineLen})`,
      `Explain how this connects to broader industry/tech trends (${lineLen})`,
      `Bring in a related story or precedent that adds depth (${lineLen})`,
      `Explain the international/macro angle if relevant (${lineLen})`,
      `Discuss what critics or skeptics say about it (${lineLen})`,
      `Share another concrete number, stat, or timeline detail (${lineLen})`,
      `Note what remains uncertain or is still developing (${lineLen})`,
      `Bring up a comparison to a competitor or similar case elsewhere (${lineLen})`,
      `Add one more layer of analysis or a follow-up question worth asking (${lineLen})`,
      `Explore the economics: who gains, who pays, and how the money flows (${lineLen})`,
      `Discuss the technology or mechanism underneath, in accessible terms (${lineLen})`,
      `Weigh the best-case and worst-case scenarios experts are debating (${lineLen})`,
    ],
  },
  {
    id: 'news_impact', title: 'Impact & Outlook', iconName: 'bulb-outline',
    lines: (theme, userName, lineLen) => [
      `Explain the concrete impact of this story on ${userName}'s work or interests this week (${lineLen})`,
      `Give one specific action or thing ${userName} should watch for (${lineLen})`,
      `Describe the longer-term outlook — where this story goes next (${lineLen})`,
      `Explain a key term or concept ${userName} should know related to ${theme} (${lineLen})`,
      `Wrap up what to keep in mind this week given this news (${lineLen})`,
      `Add a forward-looking prediction or thing to watch next week (${lineLen})`,
      `Suggest a follow-up question ${userName} might want to explore further (${lineLen})`,
      `Describe how this might change day-to-day tools or workflows in ${userName}'s field (${lineLen})`,
      `Note one signal or milestone that would confirm where this is heading (${lineLen})`,
      `An encouraging, thought-provoking close tying back to today's theme, for ${userName} (${lineLen})`,
    ],
  },
];
const NEWS_DEEPDIVE_MAX_LINES = NEWS_DEEPDIVE_TEMPLATES.reduce((s, t) => s + t.lines('', '', '').length, 0);

function buildNewsCastExample(params: {
  theme: string; otherTopics: string[]; userName: string; lineLen: string; deepDiveLines: number;
}): { chapters: { id: string; title: string; iconName: string; dialogue: { speaker: 'A' | 'B'; text: string }[] }[] } {
  let speakerIdx = 0;
  const nextSpeaker = (): 'A' | 'B' => (speakerIdx++ % 2 === 0 ? 'A' : 'B');

  const perChapterCounts = distributeCounts(
    Math.min(NEWS_DEEPDIVE_MAX_LINES, params.deepDiveLines),
    NEWS_DEEPDIVE_TEMPLATES.length,
  );

  const chapters = NEWS_DEEPDIVE_TEMPLATES.map((tpl, i) => ({
    id: tpl.id, title: tpl.title, iconName: tpl.iconName,
    dialogue: tpl.lines(params.theme, params.userName, params.lineLen)
      .slice(0, perChapterCounts[i])
      .map((text) => ({ speaker: nextSpeaker(), text })),
  }));

  if (params.otherTopics.length > 0) {
    const [t1, t2] = params.otherTopics;
    const dialogue: { speaker: 'A' | 'B'; text: string }[] = [
      { speaker: nextSpeaker(), text: `Briefly mention this other real story in one short line: ${t1} (10–15 words, no deep analysis)` },
      { speaker: nextSpeaker(), text: `One short line on why it's worth knowing (10–15 words)` },
    ];
    if (t2) {
      dialogue.push(
        { speaker: nextSpeaker(), text: `Briefly mention this other real story in one short line: ${t2} (10–15 words)` },
        { speaker: nextSpeaker(), text: `A short closing line wrapping up today's news segment (10–15 words)` },
      );
    } else {
      dialogue.push({ speaker: nextSpeaker(), text: `A short closing line wrapping up today's news segment (10–15 words)` });
    }
    chapters.push({ id: 'news_roundup', title: 'Also Today', iconName: 'newspaper-outline', dialogue });
  }

  return { chapters };
}

interface NewsThemeSelection {
  theme:       string;
  rationale:   string;
  keyFacts:    string[];
  otherTopics: string[];
}

async function selectNewsTheme(
  payload: JobPayload,
  effectiveInterests: string[],
  memoryCtx: { inferredRole?: string; recentTopics?: string[] } | null,
  apiKey: string,
): Promise<NewsThemeSelection> {
  const lang = LANG_NAMES[payload.language] ?? 'Japanese';
  const interestText = effectiveInterests.join(', ') || 'technology, business, society';
  const personalizationBlock = memoryCtx || payload.topEmails.length ? `
[${payload.userName}'s profile]
${memoryCtx?.inferredRole ? `Inferred role/occupation: ${memoryCtx.inferredRole}` : ''}
${memoryCtx?.recentTopics?.length ? `Recent topics of interest: ${memoryCtx.recentTopics.slice(0, 6).join(', ')}` : ''}
${payload.topEmails.length ? `Recent email trends (clues to industry/interests):\n${payload.topEmails.slice(0, 3).map(e => `- ${e.from}: ${e.subject}`).join('\n')}` : ''}` : '';

  const prompt = `Using Google Search, find today's real, current news most relevant to ${payload.userName}.

[User's interests] ${interestText}
${personalizationBlock}

Pick the SINGLE most significant or directly relevant story today for a deep-dive news segment — not a broad summary, one strong theme worth several minutes of discussion.

Return JSON only:
{
  "theme": "one-sentence description of the chosen theme/story, in ${lang}",
  "rationale": "why this is the best pick for ${payload.userName} today, in ${lang}",
  "keyFacts": ["concrete fact/number/quote 1, in ${lang}", "fact 2", "fact 3", "fact 4"],
  "otherTopics": ["a second real story headline worth a brief mention, in ${lang}", "a third one"]
}
All facts must come from real Google Search results — no fabrication. Plain text only, no markdown.`;

  const sysPrompt = `You are a news editor selecting today's top story for a personalized podcast. Respond in ${lang} for all text fields. Output JSON only.`;
  const text = await callGeminiApi(prompt, sysPrompt, true, apiKey);
  const jsonStr = extractJsonFromText(text);
  try {
    const parsed = jsonStr ? JSON.parse(jsonStr) as Record<string, unknown> : {};
    return {
      theme:       typeof parsed.theme === 'string'     ? parsed.theme     : interestText,
      rationale:   typeof parsed.rationale === 'string' ? parsed.rationale : '',
      keyFacts:    Array.isArray(parsed.keyFacts)    ? (parsed.keyFacts as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)    : [],
      otherTopics: Array.isArray(parsed.otherTopics) ? (parsed.otherTopics as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 3) : [],
    };
  } catch {
    console.warn('[worker] selectNewsTheme parse failed, falling back to interests');
    return { theme: interestText, rationale: '', keyFacts: [], otherTopics: [] };
  }
}

async function generateNewsCast(
  payload: JobPayload,
  effectiveInterests: string[],
  memoryCtx: { inferredRole?: string; recentTopics?: string[] } | null,
  theme: NewsThemeSelection,
  targetMinutes: number,
  apiKey: string,
): Promise<ChapterDraft[]> {
  const lang2   = LANG_NAMES[payload.language] ?? 'Japanese';
  const lineLen = lineLengthInstruction(lang2);
  const interestText = effectiveInterests.join(', ') || 'technology, business, society';

  const today = new Date();
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dateStr = `${dayNames[today.getDay()]}, ${today.getMonth() + 1}/${today.getDate()}`;

  const personalizationBlock = memoryCtx || payload.topEmails.length ? `
[${payload.userName}'s profile — factor this into commentary]
${memoryCtx?.inferredRole ? `Inferred role/occupation: ${memoryCtx.inferredRole}` : ''}
${memoryCtx?.recentTopics?.length ? `Recent topics of interest: ${memoryCtx.recentTopics.slice(0, 6).join(', ')}` : ''}
${payload.topEmails.length ? `Recent email trends (clues to industry/interests):\n${payload.topEmails.slice(0, 3).map(e => `- ${e.from}: ${e.subject}`).join('\n')}` : ''}` : '';

  const totalChars    = targetMinutes * 60 * 5;
  const roundupLines  = theme.otherTopics.length > 0 ? 4 : 0;
  const deepDiveLines = Math.min(
    NEWS_DEEPDIVE_MAX_LINES,
    Math.max(12, Math.round(totalChars / avgLineChars(lang2)) - roundupLines),
  );
  const example = buildNewsCastExample({
    theme: theme.theme, otherTopics: theme.otherTopics,
    userName: payload.userName, lineLen, deepDiveLines,
  });

  const prompt = `Generate today's deep-dive news segment for ${payload.userName}, as a dialogue between two co-hosts.
Use only real, current information from Google Search. Fabricated or outdated news is forbidden.

Co-host setup:
- ${payload.hostNames.A} (A): ${payload.hostDescriptions.A} ${payload.hostStyles.A}
- ${payload.hostNames.B} (B): ${payload.hostDescriptions.B} ${payload.hostStyles.B}

[Today's date] ${dateStr}
[User's interests] ${interestText}
${personalizationBlock}

[Today's chosen deep-dive theme] ${theme.theme}
[Why this theme] ${theme.rationale}
[Key facts already found — build on these, and search for more depth/data/angles]
${theme.keyFacts.length ? theme.keyFacts.map(f => `- ${f}`).join('\n') : '- (search for the latest facts on this theme)'}

Go deep on this ONE theme across the "Background", "Deep Dive", and "Impact & Outlook" chapters below (~${deepDiveLines} lines total) — do not spread thin across unrelated topics.${roundupLines > 0 ? ' Then briefly touch on 1-2 other real stories in the short "Also Today" wrap-up.' : ''}

Return JSON only, with all "title" and "text" values written in ${lang2} (the English text below is instructional guidance for what to say, not literal output):
${JSON.stringify(example, null, 2)}

Constraints:
- Every deep-dive line must be a full ${lineLen} — write complete, substantive multi-clause sentences, not short fragments. Lines noticeably shorter than this range are not acceptable. "Also Today" lines are the only exception (shorter, 10–15 words, a quick mention only)
- Use only real, current information from Google Search — no fabricated or outdated news
- Spoken, conversational language only — no symbols or bullet points
- ${payload.hostNames.A}'s tone: ${payload.hostStyles.A} / ${payload.hostNames.B}'s tone: ${payload.hostStyles.B}`;

  const sysPrompt = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang2}. All dialogue, chapter titles, and content must be in ${lang2} — including the "title" and "text" fields, which are written in English in the instructions above only as guidance for what to write, not as literal output. Output JSON only.`;
  const text = await callGeminiApi(prompt, sysPrompt, true, apiKey);
  return parseChapters(text);
}

// ── Push notification (briefing audio ready) ──────────────────────────────────

const PUSH_TEXT: Record<string, { title: string; body: string }> = {
  ja: { title: 'ブリーフィング完成',  body: '本日のDaily Briefが準備できました。今すぐ再生しましょう。' },
  en: { title: 'Briefing ready',      body: "Today's Daily Brief is ready. Tap to listen now." },
  zh: { title: '简报已完成',           body: '今日简报已准备就绪，立即收听吧。' },
  ko: { title: '브리핑 완성',          body: '오늘의 브리핑이 준비되었습니다. 지금 바로 들어보세요.' },
  es: { title: 'Resumen listo',       body: 'Tu Daily Brief de hoy está listo. Escúchalo ahora.' },
  it: { title: 'Briefing pronto',     body: 'Il tuo Daily Brief di oggi è pronto. Ascoltalo ora.' },
  fr: { title: 'Briefing prêt',       body: 'Votre Daily Brief du jour est prêt. Écoutez-le maintenant.' },
  de: { title: 'Briefing fertig',     body: 'Dein Daily Brief für heute ist bereit. Jetzt anhören.' },
  pt: { title: 'Briefing pronto',     body: 'Seu Daily Brief de hoje está pronto. Ouça agora.' },
};

async function sendBriefingReadyPush(uid: string, language: string): Promise<void> {
  try {
    const snap  = await db.collection('users').doc(uid).get();
    const token = snap.data()?.fcmToken as string | undefined;
    if (!token) { console.log('[worker] no fcmToken, skipping push'); return; }
    const text = PUSH_TEXT[language] ?? PUSH_TEXT.en;
    await getMessaging().send({
      token,
      notification: { title: text.title, body: text.body },
      android: { notification: { channelId: 'briefing' }, priority: 'high' },
    });
    console.log('[worker] push sent');
  } catch (e) {
    // Push failure must never fail the job (token may be stale/unregistered)
    console.warn('[worker] push failed:', e instanceof Error ? e.message : e);
  }
}

// ── Guarded write: only touch the doc if it still belongs to this job ─────────

async function guardedUpdate(
  ref: DocumentReference,
  jobId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.jobId !== jobId) return false;
    tx.update(ref, { ...data, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

// ── Stages ────────────────────────────────────────────────────────────────────

const todayDate = () => new Date().toISOString().slice(0, 10);

async function stageA(uid: string, ref: DocumentReference, job: JobDoc): Promise<void> {
  const { payload, jobId } = job;
  const apiKey = GEMINI_KEY.value();

  // Server-authoritative gate (client also checks, but the client can't be trusted)
  const access = await checkSubscription(uid);
  if (!access.allowed) {
    await guardedUpdate(ref, jobId, { status: 'error', error: 'quota_exceeded' });
    return;
  }

  // 1. Briefing script
  const text        = await callGeminiApi(payload.scriptPrompt, payload.scriptSystemPrompt, false, apiKey);
  const rawChapters = parseChapters(text);
  const fullText    = rawChapters.map(c => c.text).join('　');
  const estimatedSeconds = Math.ceil(fullText.length / 5);
  const dialogue    = splitTurns(rawChapters.flatMap(c => c.dialogue ?? []));

  // Write the script immediately so the client can display/play it (device TTS)
  // while news generation continues below.
  const ok = await guardedUpdate(ref, jobId, {
    script: { chapters: rawChapters, dialogue, estimatedSeconds },
  });
  if (!ok) { console.log('[worker] job superseded during script gen, aborting'); return; }

  // Equivalent of the client-side recordGeneration() — must happen server-side
  // now, or a process-killed client would never record the free-plan use.
  db.collection('users').doc(uid).set({ lastFreeUseAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(e => console.warn('[worker] recordGeneration failed:', e));

  // 2. News text (Pro only) — same-day cache first
  if (payload.isPro) {
    const targetMinutes = Math.max(5, Math.round((600 - estimatedSeconds) / 60));
    let newsChapters: ChapterDraft[] | null = null;
    let newsTheme = '';

    try {
      const cacheRef  = db.doc(`users/${uid}/cache/dailyNews`);
      const cacheSnap = await cacheRef.get();
      const cached    = cacheSnap.data();
      if (cached && cached.date === todayDate() && cached.language === payload.language
          && (cached.targetMinutes ?? 0) >= targetMinutes) {
        newsChapters = cached.chapters as ChapterDraft[];
        newsTheme    = (cached.theme as string) ?? '';
        console.log('[worker] using cached news');
      } else {
        const memSnap   = await db.doc(`users/${uid}/memory/context`).get();
        const memoryCtx = (memSnap.data() ?? null) as { inferredRole?: string; recentTopics?: string[]; inferredInterests?: string[] } | null;
        const effectiveInterests = memoryCtx?.inferredInterests?.length
          ? memoryCtx.inferredInterests
          : payload.interests;

        const theme = await selectNewsTheme(payload, effectiveInterests, memoryCtx, apiKey);
        newsTheme    = theme.theme;
        newsChapters = await generateNewsCast(payload, effectiveInterests, memoryCtx, theme, targetMinutes, apiKey);

        cacheRef.set({
          date: todayDate(), language: payload.language, chapters: newsChapters,
          theme: newsTheme, targetMinutes, cachedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    } catch (e) {
      // News failure must not kill the briefing — proceed without a news segment
      console.error('[worker] news generation failed:', e instanceof Error ? e.message : e);
    }

    if (newsChapters) {
      const newsFullText = newsChapters.map(c => c.text).join('　');
      const newsDialogue = splitTurns(newsChapters.flatMap(c => c.dialogue ?? []));
      const updated = await guardedUpdate(ref, jobId, {
        news: {
          chapters:         newsChapters,
          dialogue:         newsDialogue,
          estimatedSeconds: Math.ceil(newsFullText.length / 5),
          targetMinutes,
        },
        newsTheme,
      });
      if (!updated) return;
    }
  }

  await guardedUpdate(ref, jobId, { status: 'tts_pending' });
}

async function synthesizeToStorage(
  uid: string,
  baseName: string,
  dialogue: DialogueTurn[],
  hostNames: { A: string; B: string },
  hostVoices: { A: string; B: string },
  language: string,
): Promise<{ url: string; engine: 'gemini' | 'google'; durationSec: number | null }> {
  const apiKey = GEMINI_KEY.value();
  const transcript = dialogue.map(t => `${hostNames[t.speaker]}: ${t.text}`).join('\n');
  try {
    const { wav, durationSec } = await synthesizeGeminiTtsWav(
      transcript,
      [
        { speaker: hostNames.A, voice: hostVoices.A },
        { speaker: hostNames.B, voice: hostVoices.B },
      ],
      apiKey,
    );
    const url = await uploadUserAudio(uid, `${baseName}.wav`, wav, 'audio/wav');
    return { url, engine: 'gemini', durationSec };
  } catch (e) {
    console.warn(`[worker] Gemini TTS failed for ${baseName}, falling back to Google TTS:`, e instanceof Error ? e.message : e);
    const mp3 = await synthesizeGoogleDialogueMp3(dialogue, apiKey, language);
    const url = await uploadUserAudio(uid, `${baseName}.mp3`, mp3, 'audio/mp3');
    return { url, engine: 'google', durationSec: null };
  }
}

async function stageB(uid: string, ref: DocumentReference, job: JobDoc): Promise<void> {
  const { payload, jobId } = job;
  if (!job.script?.dialogue?.length) {
    await guardedUpdate(ref, jobId, { status: 'error', error: 'stage_b_no_script' });
    return;
  }

  const { url, engine, durationSec } = await synthesizeToStorage(
    uid, 'brief', job.script.dialogue, payload.hostNames, payload.hostVoices, payload.language,
  );
  console.log(`[worker] briefing audio ready: engine=${engine} durationSec=${durationSec}`);

  const hasNews = !!job.news?.dialogue?.length;
  const ok = await guardedUpdate(ref, jobId, {
    audioUrl: url, audioEngine: engine, audioDurationSec: durationSec,
    status: hasNews ? 'news_tts_pending' : 'completed',
  });
  if (!ok) return;

  // Notify now — the briefing is playable with proper voices from this moment.
  await sendBriefingReadyPush(uid, payload.language);
}

async function stageC(uid: string, ref: DocumentReference, job: JobDoc): Promise<void> {
  const { payload, jobId } = job;
  if (!job.news?.dialogue?.length) {
    await guardedUpdate(ref, jobId, { status: 'completed' });
    return;
  }

  try {
    const { url, engine, durationSec } = await synthesizeToStorage(
      uid, 'news', job.news.dialogue, payload.hostNames, payload.hostVoices, payload.language,
    );
    console.log(`[worker] news audio ready: engine=${engine} durationSec=${durationSec}`);
    await guardedUpdate(ref, jobId, {
      newsAudioUrl: url, newsAudioEngine: engine, newsAudioDurationSec: durationSec,
      status: 'completed',
    });
  } catch (e) {
    // News TTS failure: briefing itself is already delivered — complete with a flag
    console.error('[worker] news TTS failed:', e instanceof Error ? e.message : e);
    await guardedUpdate(ref, jobId, { status: 'completed', newsError: 'news_tts_failed' });
  }
}

// ── Trigger ───────────────────────────────────────────────────────────────────

const CLAIM: Record<string, string> = {
  queued:           'stage_a',
  tts_pending:      'stage_b',
  news_tts_pending: 'stage_c',
};

export const briefingWorker = onDocumentWritten(
  {
    document:       'users/{uid}/briefingJobs/current',
    region:         'asia-northeast1',
    secrets:        [GEMINI_KEY],
    timeoutSeconds: 540,
    memory:         '1GiB',
  },
  async (event) => {
    const after = event.data?.after?.data() as JobDoc | undefined;
    if (!after) return;
    const status = after.status;
    if (!(status in CLAIM)) return;
    const before = event.data?.before?.data() as JobDoc | undefined;
    // Re-trigger only on actual transitions (same-status writes are result patches),
    // except a brand-new 'queued' job overwriting an old one stuck in 'queued'.
    if (before?.status === status && before?.jobId === after.jobId) return;

    const uid = event.params.uid;
    const ref = db.doc(`users/${uid}/briefingJobs/current`);

    // Compare-and-set claim so duplicate deliveries can't double-run a stage
    const claimed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (d?.status !== status || d?.jobId !== after.jobId) return false;
      tx.update(ref, { status: CLAIM[status], updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) { console.log(`[worker] claim failed for ${status}, skipping`); return; }

    console.log(`[worker] uid=${uid} jobId=${after.jobId} claiming ${status} → ${CLAIM[status]}`);
    try {
      if      (status === 'queued')      await stageA(uid, ref, after);
      else if (status === 'tts_pending') await stageB(uid, ref, after);
      else                               await stageC(uid, ref, after);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[worker] stage for ${status} failed:`, msg);
      await guardedUpdate(ref, after.jobId, { status: 'error', error: msg.slice(0, 500) })
        .catch(() => {});
    }
  },
);

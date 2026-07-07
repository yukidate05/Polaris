import { callFunction } from './functionsService';

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', en: 'English', zh: 'Chinese', ko: 'Korean',
  es: 'Spanish',  it: 'Italian', fr: 'French',  de: 'German',  pt: 'Portuguese',
};

export interface DialogueTurn {
  speaker: 'A' | 'B';
  text:    string;
}

export interface ChapterDraft {
  id:       string;
  title:    string;
  iconName: string;
  text:     string;         // concatenated for display
  dialogue: DialogueTurn[]; // for audio generation
}

export interface ClaudeBriefingResult {
  chapters: ChapterDraft[];
  fullText: string;
}

export interface NewsThemeSelection {
  theme:       string;
  rationale:   string;
  keyFacts:    string[];
  otherTopics: string[];
}

function podcastName(hour: number): string {
  if (hour >= 5  && hour < 12) return 'Morning Briefing';
  if (hour >= 12 && hour < 17) return 'Daily Briefing';
  if (hour >= 17 && hour < 21) return 'Evening Briefing';
  return 'Night Briefing';
}

// Instructional (English) description of the current moment for the model to riff on
// in the target output language — not literal text to output verbatim.
function timeContext(hour: number): string {
  if (hour >= 5  && hour < 9)  return `It's ${hour}:00. The user is likely just waking up or on their morning commute.`;
  if (hour >= 9  && hour < 12) return `It's ${hour}:00. The user is likely already at work.`;
  if (hour >= 12 && hour < 14) return `It's lunchtime.`;
  if (hour >= 14 && hour < 17) return `It's ${hour}:00. The user is likely working through the afternoon.`;
  if (hour >= 17 && hour < 21) return `It's ${hour}:00. The user's workday is likely wrapping up.`;
  return `It's late, ${hour}:00. The user has probably had a long day.`;
}

// Character count applies naturally only to CJK languages; other languages use a word count instead.
function lineLengthInstruction(lang: string): string {
  if (['Japanese', 'Chinese', 'Korean'].includes(lang)) return '80–120 characters';
  return '15–25 words';
}

// Chars-per-line used to size the deep-dive (matches the char/5sec pace used
// elsewhere to estimate spoken duration from text length). Calibrated below the
// instructed 80-120 char range: real Gemini output for CJK lines measured ~60
// chars/line on average even with that constraint stated explicitly, so we ask
// for more lines than a naive 80-120 midpoint would imply, to actually hit
// targetMinutes (verified 2026-07-06 against the live API — see SPEC.md).
function avgLineChars(lang: string): number {
  return ['Japanese', 'Chinese', 'Korean'].includes(lang) ? 65 : 80;
}

function distributeCounts(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const rem  = total % buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < rem ? 1 : 0));
}

// Instruction banks for the deep-dive chapters — sliced down to however many lines
// the target duration calls for, so length actually scales with targetMinutes.
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

async function callGemini(prompt: string, systemPrompt: string, useSearch = false): Promise<string> {
  const { text } = await callFunction<{ text: string }>('gemini', { prompt, systemPrompt, useSearch }, 'POST', 150_000);
  return text;
}


function extractJsonFromText(text: string): string | null {
  // 1. テキスト全体がそのままJSONの場合（クリーンなレスポンス）
  try { JSON.parse(text); return text; } catch {}

  // 2. Gemini 2.5 Flash の thinking モードで思考トークンが混入する場合:
  //    実際のJSONは末尾にある。末尾から逆走して最後の完全なJSONオブジェクトを抽出。
  let depth = 0, end = -1, start = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') { if (end === -1) end = i; depth++; }
    else if (c === '{') { depth--; if (depth === 0) { start = i; break; } }
  }
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);

  return null;
}

function parseChapters(text: string): ChapterDraft[] {
  const jsonStr = extractJsonFromText(text);
  if (!jsonStr) {
    console.warn('[parseChapters] no JSON found. textLen:', text.length, 'preview:', text.slice(0, 200));
    throw new Error('gemini_parse');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[parseChapters] JSON.parse failed. jsonLen:', jsonStr.length, 'preview:', jsonStr.slice(0, 200));
    throw new Error('gemini_parse_json');
  }

  const chapters = (parsed.chapters ?? (parsed as any).briefing?.chapters ?? (parsed as any).script?.chapters) as unknown[];
  if (!Array.isArray(chapters)) {
    console.warn('[parseChapters] chapters missing. keys:', Object.keys(parsed), 'preview:', jsonStr.slice(0, 200));
    throw new Error('gemini_parse_no_chapters');
  }
  return chapters.map((c: any) => ({
    ...c,
    text: ((c.dialogue ?? []) as DialogueTurn[]).map((t) => t.text).join('　'),
  }));
}

// All instructions below are written in English regardless of the target output
// language — the model translates/renders them into ${lang} per the system prompt.
// They describe WHAT the opening line should convey, not literal text to copy.
function buildReturningNote(
  userName: string,
  hour: number,
  dateStr: string,
  session: import('./sessionService').SessionData | null,
): string {
  const tc = timeContext(hour);
  const pn = podcastName(hour);

  if (!session || !session.lastOpenedAt || session.lastOpenedAt.getTime() === 0) {
    return `The opening line: Aria greets the user with something like "${tc} Today is ${dateStr} — welcome to ${userName}'s ${pn}!"`;
  }

  const minsAgo  = Math.round((Date.now() - session.lastOpenedAt.getTime()) / 60000);
  const hoursAgo = Math.round(minsAgo / 60);
  const pct      = Math.round(session.completionRate * 100);
  const chapter  = session.lastChapterTitle || 'the opening';

  if (minsAgo < 5) {
    return `${userName} opened the app again just minutes ago, having listened up to "${chapter}" (${pct}%).
Opening line: Aria naturally reacts to ${userName} being back so soon, references being partway through "${chapter}", and offers to continue from there.`;
  }

  if (minsAgo < 90) {
    return `${userName} last opened the app ${minsAgo} minutes ago, having listened up to "${chapter}" (${pct}%).
Opening line: Aria notes it's been ${minsAgo} minutes, references "${chapter}", mentions the current moment (${tc}), and offers to continue plus touch on anything relevant to this time of day.`;
  }

  if (hoursAgo < 6) {
    return `${userName} also opened the app ${hoursAgo} hours ago today, having listened up to "${chapter}" (${pct}% played).
Opening line: Aria welcomes ${userName} back, references "${chapter}", notes the time of day (${tc}), and offers to review the rest of today together.`;
  }

  if (hoursAgo < 20) {
    return `${userName} already listened to a briefing earlier today and has returned.
Opening line: Aria welcomes ${userName} back, acknowledges their day, references "${chapter}", notes the current moment (${tc}), and moves toward a wrap-up for the day.`;
  }

  // Next day or later — fresh greeting
  return `The opening line: Aria greets the user with something like "${tc} Today is ${dateStr} — welcome to ${userName}'s ${pn}!"`;
}

export const claudeService = {
  async generateBriefing(params: {
    userName:       string;
    unreadCount:    number;
    topEmails:      { from: string; subject: string; snippet?: string }[];
    todayEvents:    { title: string; startTime: string; location?: string }[];
    tomorrowEvents: { title: string; startTime: string; location?: string }[];
    interests:      string[];
    currentHour:    number;
    isReturning:    boolean;
    userContext?:   import('./memoryService').UserContext | null;
    sessionData?:   import('./sessionService').SessionData | null;
    hostIds?:       string[];
    language?:      string;
    notionPages?:         import('./notionService').NotionPage[];
    slackMessages?:       import('./slackService').SlackChannelMessages[];
    slackTotalUnread?:    number;
    teamsChats?:          import('./teamsService').TeamsChat[];
    chatworkMessages?:    import('./chatworkService').ChatworkMessage[];
    chatworkTotalUnread?: number;
    chatworkMyName?:      string;
    notionMyName?:        string;
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);
    const lang     = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const lineLen  = lineLengthInstruction(lang);

    const today    = new Date();
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dateStr  = `${dayNames[today.getDay()]}, ${today.getMonth() + 1}/${today.getDate()}`;

    const emailLines    = params.topEmails.slice(0, 5)
      .map(e => `- ${e.from}: ${e.subject}${e.snippet ? `\n  Body: ${e.snippet}` : ''}`).join('\n') || 'None';
    const eventLines    = params.todayEvents
      .map(e => {
        const h = parseInt(e.startTime.split(':')[0]);
        const done = !isNaN(h) && h < params.currentHour;
        return `- ${e.startTime} ${e.title}${e.location ? ' (' + e.location + ')' : ''}${done ? ' [already finished]' : ''}`;
      }).join('\n') || 'None';
    const tomorrowLines = params.tomorrowEvents.slice(0, 3)
      .map(e => `- ${e.startTime} ${e.title}`).join('\n') || 'None';
    const interestText  = params.interests.join(', ') || 'Not set';
    const tc            = timeContext(params.currentHour);

    const returningNote = buildReturningNote(
      params.userName, params.currentHour, dateStr, params.sessionData ?? null
    );
    const isReturningToday = returningNote.includes('welcomes ') && returningNote.includes(' back');

    const hasSlack    = params.slackMessages    !== undefined;
    const hasChatwork = params.chatworkMessages !== undefined;
    const hasNotion   = params.notionPages      !== undefined;
    const hasExternalTools = hasSlack || hasChatwork || hasNotion;

    const ctx = params.userContext;
    const contextBlock = ctx ? `
━━━━━━━━━━━━━━━━━━━━━━━━
[${params.userName}'s memory — accumulated from past briefings]
━━━━━━━━━━━━━━━━━━━━━━━━
Inferred role/occupation: ${ctx.inferredRole || 'unknown'}
${ctx.frequentContacts.length > 0 ? `Frequent contacts:\n${ctx.frequentContacts.slice(0, 5).map(c => `- ${c.name} (related: ${c.recentTopics.slice(0, 3).join(', ')})`).join('\n')}` : ''}
${ctx.recentTopics.length > 0 ? `Recent topics: ${ctx.recentTopics.slice(0, 8).join(', ')}` : ''}
${ctx.pendingFollowups.length > 0 ? `Pending follow-ups:\n${ctx.pendingFollowups.slice(0, 3).map(f => `- Follow up with ${f.contact} on "${f.topic}" (since ${f.since})`).join('\n')}` : ''}
${ctx.topicStatuses && ctx.topicStatuses.length > 0 ? `\n[Recent status of projects/topics — accumulated from Slack/Chatwork/Notion]\n${ctx.topicStatuses.slice(0, 8).map(s => `- ${s.topic}: ${s.status} (${s.source}, ${s.lastUpdated})`).join('\n')}` : ''}

How to use this:
- If a person or topic in ${hasExternalTools ? "today's Slack/Chatwork/Notion data" : "today's email/schedule"} appears in memory, use that memory as background context
- Example: "According to memory, this has been an ongoing matter with X since last week, currently at state Y"
- Only mention a person from memory if they actually appear in today's data
` : '';

    const prompt = `You are ${params.userName}'s excellent AI secretary. Based on the data below, generate a personal podcast briefing script as a dialogue between two co-hosts.

Co-host setup:
- ${hostA.name} (A): ${hostA.description} ${hostA.style}
- ${hostB.name} (B): ${hostB.description} ${hostB.style}

${returningNote}
${contextBlock}
━━━━━━━━━━━━━━━━━━━━━━━━
[Today's data]
━━━━━━━━━━━━━━━━━━━━━━━━
Date: ${dateStr}
Current time: ${params.currentHour}:00
Unread emails: ${params.unreadCount}
Key emails (prioritize urgent/important ones):
${emailLines}

Today's schedule:
${eventLines}
Note: treat [already finished] items as a recap only — do not say they still need preparation or action.

Upcoming schedule (tomorrow onward):
${tomorrowLines}

User's interests: ${interestText}
${params.notionPages !== undefined ? `
━━ Notion (recently updated pages) ━━
${params.notionMyName ? `IMPORTANT: ${params.userName}'s own Notion account name is "${params.notionMyName}". Pages showing "${params.notionMyName}" as the editor were updated by ${params.userName} themself — do not report these as a third party's action.\n` : ''}${params.notionPages.length > 0
  ? params.notionPages.slice(0, 8).map(p => `- ${p.title}${p.lastEditedBy ? ` (edited by: ${p.lastEditedBy})` : ''}`).join('\n')
  : '(connected, no updates)'}
` : ''}${params.slackMessages !== undefined ? `
━━ Slack (past 7 days, ${params.slackTotalUnread ?? params.slackMessages.reduce((s, ch) => s + ch.messages.length, 0)} messages) ━━
Note: senders labeled "Member:" are real Slack members — always summarize their content in the briefing.
${params.slackMessages.length > 0
  ? params.slackMessages.map(ch => {
      const isDM = ch.channelName.startsWith('DM');
      const label = isDM ? `[${ch.workspace} DM]` : `[${ch.workspace}/#${ch.channelName}]`;
      return `${label}\n${ch.messages.slice(0, 15).map(m => `  ${m}`).join('\n')}`;
    }).join('\n')
  : '(connected, no new messages in this period)'}
` : ''}${params.teamsChats !== undefined ? `
━━ Microsoft Teams ━━
${params.teamsChats.length > 0
  ? params.teamsChats.map(c => `[${c.topic}] ${c.lastMessageFrom}: ${c.lastMessageText}`).join('\n')
  : '(connected, no new messages)'}
` : ''}${params.chatworkMessages !== undefined ? `
━━ Chatwork (${params.chatworkTotalUnread ?? params.chatworkMessages.length} unread) ━━
${params.chatworkMyName ? `IMPORTANT: ${params.userName}'s own Chatwork account name is "${params.chatworkMyName}". Messages sent by "${params.chatworkMyName}" are ${params.userName}'s own words — do not report these as a third party's action.` : ''}
${params.chatworkMessages.length > 0
  ? params.chatworkMessages.map(m => `[${m.roomName}]${m.isMention ? ' [mentioned]' : ''} ${m.accountName}: ${m.body}`).join('\n')
  : '(connected, no new messages in this period)'}
` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━
[Briefing quality requirements]
━━━━━━━━━━━━━━━━━━━━━━━━
You must analyze the ${hasExternalTools ? 'Slack/Chatwork/Notion/' : ''}email data along these 4 axes and weave the analysis into the script:

1. Background/context — what is this about, and what's the history so far?
2. Current state — what's happening now: in progress, resolved, or a problem?
3. Issues/risks (if any) — what's the concern, and what happens if it's ignored?
4. Action verdict for ${params.userName} — be specific: does this need action right now, a reply, a quick glance, or is it not urgent?

Especially important rules:
- Never end on "you have a message from X" alone — always convey the content, background, and whether action is needed
${hasChatwork ? '- Report Chatwork [mentioned] items first; if none, explicitly say a quick glance is enough\n' : ''}${hasSlack ? '- For Slack DMs, explain who it\'s from and what it\'s about, and judge whether a reply is needed\n' : ''}${hasNotion ? '- For Notion, state who updated what, which project it belongs to, and how it may matter going forward\n' : ''}- ${hasExternalTools ? 'If external tool data is connected, it must be mentioned in top_of_mind or next_steps' : 'Focus on email/schedule — convey the most important item of the day in top_of_mind or next_steps'}

━━━━━━━━━━━━━━━━━━━━━━━━
[Generate a 4-chapter structure]
━━━━━━━━━━━━━━━━━━━━━━━━

Return JSON only, with all "title" and "text" values written in ${lang}:
{
  "chapters": [
    {
      "id": "top_of_mind",
      "title": "Top Priority",
      "iconName": "flame-outline",
      "dialogue": [
        {"speaker": "A", "text": "${isReturningToday ? 'Welcome-back greeting, then ' : 'Greeting, then '}today's single most important item in one line (urgent email${hasSlack ? ', Slack DM' : ''}${hasChatwork ? ', Chatwork mention' : ''} — subject and background) (${lineLen})"},
        {"speaker": "B", "text": "Current state, issue, and risk of that item; a verdict on whether ${params.userName} should act now or it can wait (${lineLen})"},
        {"speaker": "A", "text": "The specific action ${params.userName} should take — use a verb like 'reply to X' or 'check Y' (${lineLen})"},
        {"speaker": "B", "text": "Add a secondary priority if relevant; wrap up with the first move to make today (${lineLen})"}
      ]
    },
    {
      "id": "schedule",
      "title": "Today's Schedule",
      "iconName": "calendar-outline",
      "dialogue": [
        {"speaker": "B", "text": "Walk through the remaining schedule in order (touch on finished items only briefly, e.g. 'you had X this morning') (${lineLen})"},
        {"speaker": "A", "text": "Prep, things to watch for, or things to do ahead of the next major event (${lineLen})"},
        {"speaker": "B", "text": "Flow of the afternoon/evening and a comment on how packed today's schedule is (${lineLen})"},
        {"speaker": "A", "text": "Suggestion for how to use any gaps or free time in the schedule (${lineLen})"}
      ]
    },
    {
      "id": "looking_ahead",
      "title": "Looking Ahead",
      "iconName": "telescope-outline",
      "dialogue": [
        {"speaker": "A", "text": "Important events from tomorrow onward${hasNotion ? ', plus who updated what in Notion and the current state of that project' : ' and the key moments/things to watch this week'} (${lineLen})"},
        {"speaker": "B", "text": "Something that needs handling now to avoid trouble later — background and reasoning for any needed follow-up (${lineLen})"},
        {"speaker": "A", "text": "Concrete prep, outreach, or checks to finish today (${lineLen})"},
        {"speaker": "B", "text": "A look at the week ahead — busiest day, potential risk, or thing to watch (${lineLen})"}
      ]
    },
    {
      "id": "next_steps",
      "title": "Recommended Actions",
      "iconName": "checkmark-done-outline",
      "dialogue": [
        {"speaker": "A", "text": "The concrete first move ${params.userName} should make today (which tool/email/meeting, and what to do) (${lineLen})"},
        {"speaker": "B", "text": "Second and third actions and why they're prioritized; also note what can wait (${lineLen})"},
        {"speaker": "A", "text": "${hasExternalTools ? 'Factoring in Slack/Chatwork/Notion, ' : ''}a summary of what should be replied to, checked, or closed out today (${lineLen})"},
        {"speaker": "B", "text": "An encouraging, positive closing note for ${params.userName} (${lineLen})"}
      ]
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━
[Strictly forbidden phrasing]
━━━━━━━━━━━━━━━━━━━━━━━━
Never tell ${params.userName} to go check something themselves — that offloads the work back onto them. Forbidden patterns:
- "Take a look at...", "Go through...", "Keep an eye on...", "Make sure to check..."
- "This needs review", "We should check this soon"
- "There's been active discussion", "There are some messages"
- "You should check Slack/Chatwork/Notion"
- Ending a line about an external tool with just "...there are messages" and nothing more

REQUIRED: when referencing external tool data, the AI must interpret and summarize the content itself:
✗ Bad: "There's a conversation in Chatwork's Headlight room worth a quick look"
✓ Good: "In Chatwork's Headlight room, Yokoyama thanked Sato — the project is on track and no reply is needed"

Any line referencing Slack/Chatwork/Notion data must include all of:
1. Who it's from/to
2. The key point of the content (what it's about, what the situation is) — summarized by the AI
3. An action verdict for ${params.userName}: clearly state "reply needed", "X needed by end of day", or "no action needed"

━━━━━━━━━━━━━━━━━━━━━━━━
Constraints:
- Every line must be ${lineLen} — no exceptions
- Each chapter is a 4-line dialogue
- Spoken, conversational language only — no symbols, bullet points, or list markers
- Naturally weave in direct address to ${params.userName}
- ${hostA.name}'s tone: ${hostA.style} / ${hostB.name}'s tone: ${hostB.style}`;

    const sysPrompt = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang}. All dialogue, chapter titles, and content must be in ${lang} — including the "title" and "text" fields, which are written in English in the instructions above only as guidance for what to write, not as literal output. Output JSON only.`;
    const text     = await callGemini(prompt, sysPrompt);
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },

  // Phase 1: search today's real news and pick ONE theme worth a deep dive, plus
  // a couple of runner-up headlines for a brief closing mention.
  async selectNewsTheme(params: {
    userName:     string;
    interests:    string[];
    language?:    string;
    userContext?: import('./memoryService').UserContext | null;
    topEmails?:   { from: string; subject: string }[];
  }): Promise<NewsThemeSelection> {
    const lang = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const interestText = params.interests.join(', ') || 'technology, business, society';
    const ctx = params.userContext;
    const personalizationBlock = ctx || params.topEmails?.length ? `
[${params.userName}'s profile]
${ctx?.inferredRole ? `Inferred role/occupation: ${ctx.inferredRole}` : ''}
${ctx?.recentTopics?.length ? `Recent topics of interest: ${ctx.recentTopics.slice(0, 6).join(', ')}` : ''}
${params.topEmails?.length ? `Recent email trends (clues to industry/interests):\n${params.topEmails.slice(0, 3).map(e => `- ${e.from}: ${e.subject}`).join('\n')}` : ''}` : '';

    const prompt = `Using Google Search, find today's real, current news most relevant to ${params.userName}.

[User's interests] ${interestText}
${personalizationBlock}

Pick the SINGLE most significant or directly relevant story today for a deep-dive news segment — not a broad summary, one strong theme worth several minutes of discussion.

Return JSON only:
{
  "theme": "one-sentence description of the chosen theme/story, in ${lang}",
  "rationale": "why this is the best pick for ${params.userName} today, in ${lang}",
  "keyFacts": ["concrete fact/number/quote 1, in ${lang}", "fact 2", "fact 3", "fact 4"],
  "otherTopics": ["a second real story headline worth a brief mention, in ${lang}", "a third one"]
}
All facts must come from real Google Search results — no fabrication. Plain text only, no markdown.`;

    const sysPrompt = `You are a news editor selecting today's top story for a personalized podcast. Respond in ${lang} for all text fields. Output JSON only.`;
    const text = await callGemini(prompt, sysPrompt, true);
    const jsonStr = extractJsonFromText(text);
    try {
      const parsed = jsonStr ? JSON.parse(jsonStr) : {};
      return {
        theme:       typeof parsed.theme === 'string'     ? parsed.theme     : interestText,
        rationale:   typeof parsed.rationale === 'string' ? parsed.rationale : '',
        keyFacts:    Array.isArray(parsed.keyFacts)    ? parsed.keyFacts.filter((s: unknown) => typeof s === 'string').slice(0, 5)    : [],
        otherTopics: Array.isArray(parsed.otherTopics) ? parsed.otherTopics.filter((s: unknown) => typeof s === 'string').slice(0, 3) : [],
      };
    } catch {
      console.warn('[selectNewsTheme] parse failed, falling back to interests. preview:', text.slice(0, 200));
      return { theme: interestText, rationale: '', keyFacts: [], otherTopics: [] };
    }
  },

  // Phase 2: deep-dive dialogue on the theme selectNewsTheme picked. Line count scales
  // with targetMinutes so the segment's actual length tracks the requested duration.
  async generateNewsCast(params: {
    userName:      string;
    interests:     string[];
    currentHour:   number;
    hostIds?:      string[];
    language?:     string;
    userContext?:  import('./memoryService').UserContext | null;
    topEmails?:    { from: string; subject: string }[];
    targetMinutes?: number;
    theme:         NewsThemeSelection;
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);
    const lang2   = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const lineLen = lineLengthInstruction(lang2);

    const interestText = params.interests.join(', ') || 'technology, business, society';
    const today = new Date();
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dateStr = `${dayNames[today.getDay()]}, ${today.getMonth() + 1}/${today.getDate()}`;

    // Build personalization context from user memory
    const ctx = params.userContext;
    const personalizationBlock = ctx || params.topEmails?.length ? `
[${params.userName}'s profile — factor this into commentary]
${ctx?.inferredRole ? `Inferred role/occupation: ${ctx.inferredRole}` : ''}
${ctx?.recentTopics?.length ? `Recent topics of interest: ${ctx.recentTopics.slice(0, 6).join(', ')}` : ''}
${params.topEmails?.length ? `Recent email trends (clues to industry/interests):\n${params.topEmails.slice(0, 3).map(e => `- ${e.from}: ${e.subject}`).join('\n')}` : ''}` : '';

    const targetMinutes  = params.targetMinutes ?? 5;
    const totalChars      = targetMinutes * 60 * 5; // matches the char/5sec pace used to estimate playback duration
    const roundupLines     = params.theme.otherTopics.length > 0 ? 4 : 0;
    const deepDiveLines    = Math.min(
      NEWS_DEEPDIVE_MAX_LINES,
      Math.max(9, Math.round(totalChars / avgLineChars(lang2)) - roundupLines),
    );
    const example = buildNewsCastExample({
      theme: params.theme.theme, otherTopics: params.theme.otherTopics,
      userName: params.userName, lineLen, deepDiveLines,
    });

    const prompt = `Generate today's deep-dive news segment for ${params.userName}, as a dialogue between two co-hosts.
Use only real, current information from Google Search. Fabricated or outdated news is forbidden.

Co-host setup:
- ${hostA.name} (A): ${hostA.description} ${hostA.style}
- ${hostB.name} (B): ${hostB.description} ${hostB.style}

[Today's date] ${dateStr}
[User's interests] ${interestText}
${personalizationBlock}

[Today's chosen deep-dive theme] ${params.theme.theme}
[Why this theme] ${params.theme.rationale}
[Key facts already found — build on these, and search for more depth/data/angles]
${params.theme.keyFacts.length ? params.theme.keyFacts.map(f => `- ${f}`).join('\n') : '- (search for the latest facts on this theme)'}

Go deep on this ONE theme across the "Background", "Deep Dive", and "Impact & Outlook" chapters below (~${deepDiveLines} lines total) — do not spread thin across unrelated topics.${roundupLines > 0 ? ' Then briefly touch on 1-2 other real stories in the short "Also Today" wrap-up.' : ''}

Return JSON only, with all "title" and "text" values written in ${lang2} (the English text below is instructional guidance for what to say, not literal output):
${JSON.stringify(example, null, 2)}

Constraints:
- Every deep-dive line must be a full ${lineLen} — write complete, substantive multi-clause sentences, not short fragments. Lines noticeably shorter than this range are not acceptable. "Also Today" lines are the only exception (shorter, 10–15 words, a quick mention only)
- Use only real, current information from Google Search — no fabricated or outdated news
- Spoken, conversational language only — no symbols or bullet points
- ${hostA.name}'s tone: ${hostA.style} / ${hostB.name}'s tone: ${hostB.style}`;

    const sysPrompt2 = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang2}. All dialogue, chapter titles, and content must be in ${lang2} — including the "title" and "text" fields, which are written in English in the instructions above only as guidance for what to write, not as literal output. Output JSON only.`;
    const text     = await callGemini(prompt, sysPrompt2, true);
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },

  async generateDeepcast(topic: string): Promise<ClaudeBriefingResult> {
    const prompt = `「${topic}」について、5分のポッドキャスト解説を2人のMCの対話形式で日本語生成してください。

MCs: Aria（A：明るい女性MC） / Crest（B：知的な男性MC）

JSONのみを返してください:
{
  "chapters": [
    {"id":"intro",   "title":"はじめに",  "iconName":"information-circle-outline",
     "dialogue":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."},{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]},
    {"id":"main1",  "title":"概要",      "iconName":"layers-outline",
     "dialogue":[{"speaker":"B","text":"..."},{"speaker":"A","text":"..."},{"speaker":"B","text":"..."},{"speaker":"A","text":"..."}]},
    {"id":"main2",  "title":"詳細",      "iconName":"document-text-outline",
     "dialogue":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."},{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]},
    {"id":"closing","title":"まとめ",    "iconName":"checkmark-circle-outline",
     "dialogue":[{"speaker":"B","text":"..."},{"speaker":"A","text":"..."}]}
  ]
}

制約: 各chapterは4往復、全体で約1500字（5分）、話し言葉のみ、記号禁止`;

    const text     = await callGemini(prompt, 'You are an AI that generates engaging podcast dialogue scripts in Japanese. Output JSON only.');
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },
};

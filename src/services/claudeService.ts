const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-opus-4-7';

export interface ChapterDraft {
  id:       string;
  title:    string;
  iconName: string;
  text:     string;
}

export interface ClaudeBriefingResult {
  chapters: ChapterDraft[];
  fullText: string;
}

export const claudeService = {
  async generateBriefing(params: {
    userName:      string;
    unreadCount:   number;
    topEmails:     { from: string; subject: string }[];
    todayEvents:   { title: string; startTime: string; location?: string }[];
    tomorrowEvents:{ title: string; startTime: string; location?: string }[];
    interests:     string[];
  }): Promise<ClaudeBriefingResult> {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('no_key');

    const today    = new Date();
    const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
    const dateStr  = `${today.getMonth() + 1}月${today.getDate()}日（${dayNames[today.getDay()]}）`;

    const emailLines   = params.topEmails.slice(0, 5)
      .map(e => `・${e.from}: ${e.subject}`).join('\n') || 'なし';
    const eventLines   = params.todayEvents
      .map(e => `・${e.startTime} ${e.title}${e.location ? '（' + e.location + '）' : ''}`).join('\n') || 'なし';
    const tomorrowLines = params.tomorrowEvents.slice(0, 3)
      .map(e => `・${e.startTime} ${e.title}`).join('\n') || 'なし';
    const interestText = params.interests.join('、') || '未設定';

    const prompt = `${params.userName}さんの朝のブリーフィングを日本語で生成してください。

今日: ${dateStr}
未読メール: ${params.unreadCount}件
主なメール:
${emailLines}

今日の予定:
${eventLines}

明日の予定:
${tomorrowLines}

興味: ${interestText}

必ずJSONのみを返してください（マークダウン不可）:
{
  "chapters": [
    {
      "id": "opening",
      "title": "おはよう",
      "iconName": "sunny-outline",
      "text": "挨拶・日付・一言（100〜150字）"
    },
    {
      "id": "email",
      "title": "メール",
      "iconName": "mail-outline",
      "text": "重要メールを自然な話し言葉で紹介（150〜200字）"
    },
    {
      "id": "schedule",
      "title": "予定",
      "iconName": "calendar-outline",
      "text": "今日の予定をすべて流れよく紹介（150〜200字）"
    },
    {
      "id": "insights",
      "title": "インサイト",
      "iconName": "bulb-outline",
      "text": "明日の予定や興味トピックへの短い洞察（100〜150字）"
    }
  ]
}

制約: 話し言葉、記号・箇条書き禁止、${params.userName}さんへの直接語りかけ`;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: '日本語の自然な音声ブリーフィングを生成するAIです。必ずJSONのみ返してください。',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`claude:${resp.status}`);

    const data  = await resp.json();
    const text  = data.content[0].text as string;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('claude_parse');

    const parsed   = JSON.parse(match[0]);
    const chapters = parsed.chapters as ChapterDraft[];
    const fullText = chapters.map((c) => c.text).join('　');

    return { chapters, fullText };
  },

  async generateDeepcast(topic: string): Promise<ClaudeBriefingResult> {
    const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('no_key');

    const prompt = `「${topic}」について、3〜5分のポッドキャスト形式の解説を日本語で生成してください。

必ずJSONのみを返してください:
{
  "chapters": [
    { "id": "intro", "title": "はじめに", "iconName": "information-circle-outline", "text": "..." },
    { "id": "main1", "title": "概要", "iconName": "layers-outline", "text": "..." },
    { "id": "main2", "title": "詳細", "iconName": "document-text-outline", "text": "..." },
    { "id": "closing", "title": "まとめ", "iconName": "checkmark-circle-outline", "text": "..." }
  ]
}

制約: 各chapterのtextは自然な話し言葉、記号・箇条書き禁止、合計700〜1000字`;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: '魅力的な日本語ポッドキャストスクリプトを生成するAIです。必ずJSONのみ返してください。',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`claude:${resp.status}`);

    const data  = await resp.json();
    const text  = data.content[0].text as string;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('claude_parse');

    const parsed   = JSON.parse(match[0]);
    const chapters = parsed.chapters as ChapterDraft[];
    const fullText = chapters.map((c) => c.text).join('　');

    return { chapters, fullText };
  },
};

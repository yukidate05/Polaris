const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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

function timeContext(hour: number): string {
  if (hour >= 5  && hour < 9)  return `今は${hour}時。もう起きてる？電車の中かな`;
  if (hour >= 9  && hour < 12) return `今は${hour}時。もう会社かな？`;
  if (hour >= 12 && hour < 14) return `ランチタイムだね`;
  if (hour >= 14 && hour < 17) return `今は${hour}時。午後も頑張ってるね`;
  if (hour >= 17 && hour < 21) return `今は${hour}時。今日も一日お疲れ様`;
  return `夜遅くまでお疲れ様。今は${hour}時`;
}

async function callGemini(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) throw new Error('no_key');

  const resp = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000 },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`gemini:${resp.status} ${body.slice(0, 100)}`);
  }

  const data = await resp.json();
  return data.candidates[0].content.parts[0].text as string;
}

function parseChapters(text: string): ChapterDraft[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('gemini_parse');

  const parsed = JSON.parse(match[0]);
  return (parsed.chapters as Array<{
    id: string; title: string; iconName: string; dialogue: DialogueTurn[];
  }>).map((c) => ({
    ...c,
    text: c.dialogue.map((t) => t.text).join('　'),
  }));
}

export const claudeService = {
  async generateBriefing(params: {
    userName:       string;
    unreadCount:    number;
    topEmails:      { from: string; subject: string }[];
    todayEvents:    { title: string; startTime: string; location?: string }[];
    tomorrowEvents: { title: string; startTime: string; location?: string }[];
    interests:      string[];
    currentHour:    number;
    isReturning:    boolean;
  }): Promise<ClaudeBriefingResult> {
    const today    = new Date();
    const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
    const dateStr  = `${today.getMonth() + 1}月${today.getDate()}日（${dayNames[today.getDay()]}）`;

    const emailLines    = params.topEmails.slice(0, 5)
      .map(e => `・${e.from}: ${e.subject}`).join('\n') || 'なし';
    const eventLines    = params.todayEvents
      .map(e => `・${e.startTime} ${e.title}${e.location ? '（' + e.location + '）' : ''}`).join('\n') || 'なし';
    const tomorrowLines = params.tomorrowEvents.slice(0, 3)
      .map(e => `・${e.startTime} ${e.title}`).join('\n') || 'なし';
    const interestText  = params.interests.join('、') || '未設定';
    const tc            = timeContext(params.currentHour);

    const returningNote = params.isReturning
      ? `${params.userName}さんは本日すでにブリーフィングを聴いており、また戻ってきました。openingの最初のセリフはAriaが「お帰り、${params.userName}！また来てくれたね」から始めてください。`
      : `openingの最初のセリフはAriaが「${tc}。今日は${dateStr}、${params.userName}のモーニングポッドキャストへようこそ！」から始めてください。`;

    const prompt = `${params.userName}さんのためのポッドキャストブリーフィングを、2人のMCの対話形式で日本語生成してください。

MCの設定:
- Aria（A）：明るく親しみやすい女性MC。テンポよく話す
- Kai（B）：落ち着いて知的な男性MC。Ariaの発言を深める

${returningNote}

今日: ${dateStr}
未読メール: ${params.unreadCount}件
主なメール:
${emailLines}

今日の予定:
${eventLines}

明日の予定:
${tomorrowLines}

興味: ${interestText}

JSONのみを返してください:
{
  "chapters": [
    {
      "id": "opening",
      "title": "おはよう",
      "iconName": "sunny-outline",
      "dialogue": [
        {"speaker": "A", "text": "Ariaのセリフ（60〜100字）"},
        {"speaker": "B", "text": "Kaiのセリフ（60〜100字）"},
        {"speaker": "A", "text": "..."},
        {"speaker": "B", "text": "..."}
      ]
    },
    {
      "id": "email",
      "title": "メール",
      "iconName": "mail-outline",
      "dialogue": [
        {"speaker": "A", "text": "メール紹介（60〜100字）"},
        {"speaker": "B", "text": "コメント（60〜100字）"},
        {"speaker": "A", "text": "..."},
        {"speaker": "B", "text": "..."}
      ]
    },
    {
      "id": "schedule",
      "title": "予定",
      "iconName": "calendar-outline",
      "dialogue": [
        {"speaker": "B", "text": "今日の予定紹介（60〜100字）"},
        {"speaker": "A", "text": "コメント（60〜100字）"},
        {"speaker": "B", "text": "..."},
        {"speaker": "A", "text": "..."}
      ]
    },
    {
      "id": "insights",
      "title": "インサイト",
      "iconName": "bulb-outline",
      "dialogue": [
        {"speaker": "A", "text": "明日の予定や興味への洞察（60〜100字）"},
        {"speaker": "B", "text": "深掘り（60〜100字）"},
        {"speaker": "A", "text": "..."},
        {"speaker": "B", "text": "..."}
      ]
    },
    {
      "id": "closing",
      "title": "締め",
      "iconName": "checkmark-circle-outline",
      "dialogue": [
        {"speaker": "B", "text": "今日の締め（60〜100字）"},
        {"speaker": "A", "text": "励ましの言葉（60〜100字）"}
      ]
    }
  ]
}

制約:
- 各chapterは4〜5往復の対話（計約300字）
- 全体で約1500字（5分間）
- 話し言葉のみ。記号・箇条書き禁止
- ${params.userName}さんへの直接語りかけを自然に混ぜる
- Ariaは「〜だよ」「〜だね」、Kaiは「〜ですね」「〜でしょう」の語尾`;

    const text     = await callGemini(prompt, '魅力的な日本語ポッドキャストの対話台本を生成するAIです。JSONのみ返してください。');
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },

  async generateDeepcast(topic: string): Promise<ClaudeBriefingResult> {
    const prompt = `「${topic}」について、5分のポッドキャスト解説を2人のMCの対話形式で日本語生成してください。

MCs: Aria（A：明るい女性MC） / Kai（B：知的な男性MC）

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

    const text     = await callGemini(prompt, '魅力的な日本語ポッドキャストの対話台本を生成するAIです。JSONのみ返してください。');
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },
};

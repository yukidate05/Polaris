import { callFunction } from './functionsService';

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', en: 'English', zh: 'Chinese', ko: 'Korean',
  es: 'Spanish',  fr: 'French',  de: 'German',  pt: 'Portuguese',
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

function podcastName(hour: number): string {
  if (hour >= 5  && hour < 12) return 'モーニングブリーフィング';
  if (hour >= 12 && hour < 17) return 'デイリーブリーフィング';
  if (hour >= 17 && hour < 21) return 'イブニングブリーフィング';
  return 'ナイトブリーフィング';
}

function timeContext(hour: number): string {
  if (hour >= 5  && hour < 9)  return `今は${hour}時。もう起きてる？電車の中かな`;
  if (hour >= 9  && hour < 12) return `今は${hour}時。もう会社かな？`;
  if (hour >= 12 && hour < 14) return `ランチタイムだね`;
  if (hour >= 14 && hour < 17) return `今は${hour}時。午後も頑張ってるね`;
  if (hour >= 17 && hour < 21) return `今は${hour}時。今日も一日お疲れ様`;
  return `夜遅くまでお疲れ様。今は${hour}時`;
}

async function callGemini(prompt: string, systemPrompt: string, useSearch = false): Promise<string> {
  const { text } = await callFunction<{ text: string }>('gemini', { prompt, systemPrompt, useSearch });
  return text;
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

function buildReturningNote(
  userName: string,
  hour: number,
  dateStr: string,
  session: import('./sessionService').SessionData | null,
): string {
  const tc = timeContext(hour);
  const pn = podcastName(hour);

  if (!session || !session.lastOpenedAt || session.lastOpenedAt.getTime() === 0) {
    return `openingの最初のセリフはAriaが「${tc}。今日は${dateStr}、${userName}の${pn}へようこそ！」から始めてください。`;
  }

  const minsAgo  = Math.round((Date.now() - session.lastOpenedAt.getTime()) / 60000);
  const hoursAgo = Math.round(minsAgo / 60);
  const pct      = Math.round(session.completionRate * 100);
  const chapter  = session.lastChapterTitle || 'オープニング';

  if (minsAgo < 5) {
    // すぐ戻ってきた（アプリ再起動など）
    return `${userName}さんは数分前にもアプリを開いており、「${chapter}」(${pct}%)まで聴いていました。
openingはAriaが「あれ、${userName}！すぐ戻ってきてくれたね。さっきは${chapter}の途中だったけど、続きから始めようか？」から自然に始めてください。`;
  }

  if (minsAgo < 90) {
    // 同日・数十分後に戻ってきた
    return `${userName}さんは${minsAgo}分前にも開いており、「${chapter}」(${pct}%)まで聴いていました。
openingはAriaが「${minsAgo}分ぶりだね、${userName}！さっきは${chapter}の話をしてたね。今は${tc.split('。')[0]}だから、続きとあわせて今の時間帯の話もしようか」から始めてください。`;
  }

  if (hoursAgo < 6) {
    // 同日・数時間後
    const timePart = hour >= 12 && hour < 17 ? 'お昼すぎ' : hour >= 17 ? '夕方' : '朝';
    return `${userName}さんは本日${hoursAgo}時間前にも開いており、「${chapter}」まで聴いていました（${pct}%再生済み）。
openingはAriaが「お帰り、${userName}！さっきは${chapter}の話までしてたね。もう${timePart}だね、お昼は食べた？この時間帯に合わせて今日の残りを一緒に確認しよう」から始めてください。`;
  }

  if (hoursAgo < 20) {
    // 同日だが夜など時間が経った
    return `${userName}さんは本日すでにブリーフィングを聴いており、また戻ってきました。
openingはAriaが「お帰り、${userName}！今日も一日お疲れ様。さっきは${chapter}まで話してたね。今は${tc.split('。')[0]}だから、締めくくりの話をしようか」から始めてください。`;
  }

  // 翌日以降（新鮮な挨拶）
  return `openingの最初のセリフはAriaが「${tc}。今日は${dateStr}、${userName}の${pn}へようこそ！」から始めてください。`;
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
    userContext?:   import('./memoryService').UserContext | null;
    sessionData?:   import('./sessionService').SessionData | null;
    hostIds?:       string[];
    language?:      string;
    notionPages?:   import('./notionService').NotionPage[];
    slackMessages?: import('./slackService').SlackChannelMessages[];
    teamsChats?:       import('./teamsService').TeamsChat[];
    chatworkMessages?: import('./chatworkService').ChatworkMessage[];
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);

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

    const returningNote = buildReturningNote(
      params.userName, params.currentHour, dateStr, params.sessionData ?? null
    );

    const ctx = params.userContext;
    const contextBlock = ctx ? `
【${params.userName}さんについての記憶（過去のブリーフィングから蓄積）】
推定の役割・職種: ${ctx.inferredRole || '不明'}
${ctx.frequentContacts.length > 0 ? `よく連絡を取る人:\n${ctx.frequentContacts.slice(0, 5).map(c => `・${c.name}（最近のトピック: ${c.recentTopics.slice(0,3).join('、')}）`).join('\n')}` : ''}
${ctx.recentTopics.length > 0 ? `最近のトピック: ${ctx.recentTopics.slice(0, 8).join('、')}` : ''}
${ctx.pendingFollowups.length > 0 ? `フォローアップ候補:\n${ctx.pendingFollowups.slice(0, 3).map(f => `・${f.contact}への「${f.topic}」（${f.since}以降）`).join('\n')}` : ''}

この記憶を自然にブリーフィングへ織り込んでください。全部使う必要はなく、今日の内容と関連するものだけ言及してください。
` : '';

    const prompt = `${params.userName}さんのためのパーソナルポッドキャストブリーフィングを、2人のMCの対話形式で日本語生成してください。

MCの設定:
- ${hostA.name}（A）：${hostA.description}。${hostA.style}
- ${hostB.name}（B）：${hostB.description}。${hostB.style}

${returningNote}
${contextBlock}
【今日のデータ】
日付: ${dateStr}
未読メール: ${params.unreadCount}件
主なメール（緊急・重要なものを優先）:
${emailLines}

今日の予定:
${eventLines}

明日以降の予定:
${tomorrowLines}

ユーザーの興味・関心: ${interestText}
${params.notionPages?.length ? `
Notionタスク・ページ（最近更新されたもの）:
${params.notionPages.slice(0, 5).map(p => `・${p.title}`).join('\n')}
` : ''}${params.slackMessages?.length ? `
Slackの最新メッセージ（過去24時間）:
${params.slackMessages.map(ch => `[#${ch.channelName}]\n${ch.messages.slice(0, 5).map(m => `・${m}`).join('\n')}`).join('\n')}
` : ''}${params.teamsChats?.length ? `
Microsoft Teamsの最新チャット:
${params.teamsChats.map(c => `[${c.topic}] ${c.lastMessageFrom}: ${c.lastMessageText}`).join('\n')}
` : ''}${params.chatworkMessages?.length ? `
Chatworkの最新メッセージ:
${params.chatworkMessages.map(m => `[${m.roomName}] ${m.accountName}: ${m.body}`).join('\n')}
` : ''}
【4つのセクション構成で生成してください】
1. Top of Mind（本日の最優先事項）: 緊急・重要メールや今日絶対対応すべきタスク
2. Today's Schedule（今日のスケジュール）: カレンダーから抽出した会議・予定の一覧
3. Looking Ahead（今後の展望）: 明日以降で対応が必要な事項・フォローアップ候補
4. Suggested Next Steps（推奨アクション）: 今日・今週「次にやるべき一手」の具体的な提案

JSONのみを返してください:
{
  "chapters": [
    {
      "id": "top_of_mind",
      "title": "最優先事項",
      "iconName": "flame-outline",
      "dialogue": [
        {"speaker": "A", "text": "${returningNote.includes('お帰り') ? 'お帰りの挨拶＋今日の最優先メール・タスクの紹介（80〜120字）' : '挨拶＋今日の最優先メール・タスクの紹介（80〜120字）'}"},
        {"speaker": "B", "text": "重要度・緊急度のコメント（80〜120字）"},
        {"speaker": "A", "text": "対応のポイント（80〜120字）"},
        {"speaker": "B", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "schedule",
      "title": "今日のスケジュール",
      "iconName": "calendar-outline",
      "dialogue": [
        {"speaker": "B", "text": "今日の予定一覧を時系列で紹介（80〜120字）"},
        {"speaker": "A", "text": "注目の予定へのコメント（80〜120字）"},
        {"speaker": "B", "text": "準備・注意点（80〜120字）"},
        {"speaker": "A", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "looking_ahead",
      "title": "今後の展望",
      "iconName": "telescope-outline",
      "dialogue": [
        {"speaker": "A", "text": "明日以降の重要な予定・期限（80〜120字）"},
        {"speaker": "B", "text": "フォローアップが必要な案件（80〜120字）"},
        {"speaker": "A", "text": "今のうちに準備すべきこと（80〜120字）"},
        {"speaker": "B", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "next_steps",
      "title": "推奨アクション",
      "iconName": "checkmark-done-outline",
      "dialogue": [
        {"speaker": "A", "text": "今日やるべき具体的な一手を提案（80〜120字）"},
        {"speaker": "B", "text": "優先順位・理由の補足（80〜120字）"},
        {"speaker": "A", "text": "締めのメッセージ（80〜120字）"},
        {"speaker": "B", "text": "励ましの言葉で締め（80〜120字）"}
      ]
    }
  ]
}

制約:
- 各セリフは必ず80字以上120字以下（厳守）
- 各chapterは4セリフの対話（計約400字）
- 全体で約1600字（約5〜6分）
- 話し言葉のみ。記号・箇条書き禁止
- ${params.userName}さんへの直接語りかけを自然に混ぜる
- ${hostA.name}は${hostA.style}、${hostB.name}は${hostB.style}`;

    const lang = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const sysPrompt = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang}. All dialogue, chapter titles, and content must be in ${lang}. Output JSON only.`;
    const text     = await callGemini(prompt, sysPrompt);
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },

  async generateNewsCast(params: {
    userName:    string;
    interests:   string[];
    currentHour: number;
    hostIds?:    string[];
    language?:   string;
    sparseData?: boolean;
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);

    const interestText = params.interests.join('、') || 'テクノロジー、ビジネス、社会';
    const today = new Date();
    const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
    const dateStr = `${today.getMonth() + 1}月${today.getDate()}日（${dayNames[today.getDay()]}）`;

    const sparse = params.sparseData ?? false;
    const sectionCount = sparse ? 6 : 4;
    const charTarget = sparse ? '約2800字（約9分）' : '約1600字（約5〜6分）';

    const sparseExtraSections = sparse ? `
5. Deep Dive（深掘り分析）: トップニュースまたは${interestText}に関する詳細な背景・影響・今後の見通し分析
6. Global Perspective（グローバル視点）: 国際的な動向と${params.userName}さんの仕事・生活への関連性` : '';

    const sparseExtraChapters = sparse ? `,
    {
      "id": "news_deepdive",
      "title": "深掘り分析",
      "iconName": "search-outline",
      "dialogue": [
        {"speaker": "A", "text": "今日の最重要トピックの詳細解説（80〜120字）"},
        {"speaker": "B", "text": "背景・歴史的文脈のコメント（80〜120字）"},
        {"speaker": "A", "text": "今後の展望と影響（80〜120字）"},
        {"speaker": "B", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "news_global",
      "title": "グローバル動向",
      "iconName": "earth-outline",
      "dialogue": [
        {"speaker": "B", "text": "国際的な視点からのニュース紹介（80〜120字）"},
        {"speaker": "A", "text": "日本・アジアへの影響（80〜120字）"},
        {"speaker": "B", "text": "80〜120字のセリフ"},
        {"speaker": "A", "text": "80〜120字のセリフ"}
      ]
    }` : '';

    const prompt = `${params.userName}さん向けの今日のニュースキャストを、2人のMCの対話形式で日本語生成してください。
Google検索で取得した最新情報を使い、実際のニュースのみ紹介してください。架空・古い情報は禁止です。

MCの設定:
- ${hostA.name}（A）：${hostA.description}。${hostA.style}
- ${hostB.name}（B）：${hostB.description}。${hostB.style}

【今日の日付】${dateStr}
【ユーザーの興味・関心】${interestText}
${sparse ? '【注意】今日のメール・予定が少ないため、ニュース・分析を充実させて合計10分のブリーフィングになるよう内容を豊富にしてください。' : ''}

【${sectionCount}つのセクション構成】
1. Top News（今日のトップニュース）: 国内外で最も注目すべきニュース
2. Industry（業界・ビジネス動向）: ${interestText}に関連した最新トレンド
3. Technology（テクノロジー）: AI・テック分野の最新動向
4. Wrap-up（締めくくり）: 今日の総括と${params.userName}さんへのメッセージ${sparseExtraSections}

JSONのみ返してください:
{
  "chapters": [
    {
      "id": "news_top",
      "title": "トップニュース",
      "iconName": "globe-outline",
      "dialogue": [
        {"speaker": "A", "text": "今日のトップニュース紹介（80〜120字）"},
        {"speaker": "B", "text": "背景・影響のコメント（80〜120字）"},
        {"speaker": "A", "text": "80〜120字のセリフ"},
        {"speaker": "B", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "news_industry",
      "title": "業界動向",
      "iconName": "trending-up-outline",
      "dialogue": [
        {"speaker": "B", "text": "業界・ビジネスニュース紹介（80〜120字）"},
        {"speaker": "A", "text": "影響・注目ポイント（80〜120字）"},
        {"speaker": "B", "text": "80〜120字のセリフ"},
        {"speaker": "A", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "news_tech",
      "title": "テクノロジー",
      "iconName": "hardware-chip-outline",
      "dialogue": [
        {"speaker": "A", "text": "テック・AIニュース紹介（80〜120字）"},
        {"speaker": "B", "text": "解説・コメント（80〜120字）"},
        {"speaker": "A", "text": "80〜120字のセリフ"},
        {"speaker": "B", "text": "80〜120字のセリフ"}
      ]
    },
    {
      "id": "news_wrapup",
      "title": "今日のまとめ",
      "iconName": "checkmark-circle-outline",
      "dialogue": [
        {"speaker": "B", "text": "今日のニュース総括（80〜120字）"},
        {"speaker": "A", "text": "${params.userName}さんへのメッセージ（80〜120字）"},
        {"speaker": "B", "text": "締めの言葉（80〜120字）"},
        {"speaker": "A", "text": "80〜120字のセリフ"}
      ]
    }${sparseExtraChapters}
  ]
}

制約:
- 各セリフは必ず80字以上120字以下（厳守）
- Google検索の最新情報のみ使用。架空ニュース・古い情報禁止
- 話し言葉のみ。記号・箇条書き禁止
- ${hostA.name}は${hostA.style}、${hostB.name}は${hostB.style}
- 全体で${charTarget}を目標にしてください`;

    const lang2 = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const sysPrompt2 = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang2}. All dialogue, chapter titles, and content must be in ${lang2}. Output JSON only.`;
    const text     = await callGemini(prompt, sysPrompt2, true);
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

    const text     = await callGemini(prompt, 'You are an AI that generates engaging podcast dialogue scripts in Japanese. Output JSON only.');
    const chapters = parseChapters(text);
    const fullText = chapters.map((c) => c.text).join('　');
    return { chapters, fullText };
  },
};

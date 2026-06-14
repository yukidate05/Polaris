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
  if (!match) {
    console.warn('[parseChapters] no JSON found. preview:', text.slice(0, 200));
    throw new Error('gemini_parse');
  }

  const parsed = JSON.parse(match[0]);
  const chapters = parsed.chapters ?? parsed.briefing?.chapters ?? parsed.script?.chapters;
  if (!Array.isArray(chapters)) {
    console.warn('[parseChapters] chapters missing. keys:', Object.keys(parsed), 'preview:', text.slice(0, 200));
    throw new Error('gemini_parse_no_chapters');
  }
  return chapters.map((c: { id: string; title: string; iconName: string; dialogue?: DialogueTurn[] }) => ({
    ...c,
    text: (c.dialogue ?? []).map((t) => t.text).join('　'),
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
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);

    const today    = new Date();
    const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
    const dateStr  = `${today.getMonth() + 1}月${today.getDate()}日（${dayNames[today.getDay()]}）`;

    const emailLines    = params.topEmails.slice(0, 5)
      .map(e => `・${e.from}: ${e.subject}${e.snippet ? `\n  本文: ${e.snippet}` : ''}`).join('\n') || 'なし';
    const eventLines    = params.todayEvents
      .map(e => {
        const h = parseInt(e.startTime.split(':')[0]);
        const done = !isNaN(h) && h < params.currentHour;
        return `・${e.startTime} ${e.title}${e.location ? '（' + e.location + '）' : ''}${done ? '【終了済み】' : ''}`;
      }).join('\n') || 'なし';
    const tomorrowLines = params.tomorrowEvents.slice(0, 3)
      .map(e => `・${e.startTime} ${e.title}`).join('\n') || 'なし';
    const interestText  = params.interests.join('、') || '未設定';
    const tc            = timeContext(params.currentHour);

    const returningNote = buildReturningNote(
      params.userName, params.currentHour, dateStr, params.sessionData ?? null
    );

    const hasSlack    = params.slackMessages    !== undefined;
    const hasChatwork = params.chatworkMessages !== undefined;
    const hasNotion   = params.notionPages      !== undefined;
    const hasExternalTools = hasSlack || hasChatwork || hasNotion;

    const ctx = params.userContext;
    const contextBlock = ctx ? `
━━━━━━━━━━━━━━━━━━━━━━━━
【${params.userName}さんの記憶（過去のブリーフィングから蓄積）】
━━━━━━━━━━━━━━━━━━━━━━━━
推定の役割・職種: ${ctx.inferredRole || '不明'}
${ctx.frequentContacts.length > 0 ? `よく連絡を取る人:\n${ctx.frequentContacts.slice(0, 5).map(c => `・${c.name}（関連: ${c.recentTopics.slice(0, 3).join('、')}）`).join('\n')}` : ''}
${ctx.recentTopics.length > 0 ? `最近のトピック: ${ctx.recentTopics.slice(0, 8).join('、')}` : ''}
${ctx.pendingFollowups.length > 0 ? `フォローアップ候補:\n${ctx.pendingFollowups.slice(0, 3).map(f => `・${f.contact}への「${f.topic}」（${f.since}以降）`).join('\n')}` : ''}
${ctx.topicStatuses && ctx.topicStatuses.length > 0 ? `\n【プロジェクト・話題の直近の状態（Slack/Chatwork/Notionから蓄積）】\n${ctx.topicStatuses.slice(0, 8).map(s => `・${s.topic}: ${s.status}（${s.source}・${s.lastUpdated}）`).join('\n')}` : ''}

使い方:
- ${hasExternalTools ? '今日のSlack・Chatwork・Notionのデータ' : '今日のメール・予定'}に登場する人物・トピックが記憶にある場合、その記憶を「背景」として使ってください
- 例：「この件は記憶によると先週から続いているXの案件で、現在Yという状態のようです」
- 記憶にある人物名は、今日のデータに実際に登場している場合のみ言及してください
` : '';

    const prompt = `あなたは${params.userName}さんの優秀なAI秘書です。以下のデータをもとに、パーソナルポッドキャストブリーフィングの台本を2人のMCの対話形式で生成してください。

MCの設定:
- ${hostA.name}（A）：${hostA.description}。${hostA.style}
- ${hostB.name}（B）：${hostB.description}。${hostB.style}

${returningNote}
${contextBlock}
━━━━━━━━━━━━━━━━━━━━━━━━
【今日のデータ】
━━━━━━━━━━━━━━━━━━━━━━━━
日付: ${dateStr}
現在時刻: ${params.currentHour}時
未読メール: ${params.unreadCount}件
主なメール（緊急・重要なものを優先）:
${emailLines}

今日の予定:
${eventLines}
※【終了済み】は振り返りとして扱い「これから準備が必要」「対策が必要」とは言わないこと

明日以降の予定:
${tomorrowLines}

ユーザーの興味・関心: ${interestText}
${params.notionPages !== undefined ? `
━━ Notion（最近更新されたページ） ━━
${params.notionPages.length > 0
  ? params.notionPages.slice(0, 8).map(p => `・${p.title}${p.lastEditedBy ? `（更新者: ${p.lastEditedBy}）` : ''}`).join('\n')
  : '（接続済み・更新なし）'}
` : ''}${params.slackMessages !== undefined ? `
━━ Slack（過去7日間・メッセージ${params.slackTotalUnread ?? params.slackMessages.reduce((s, ch) => s + ch.messages.length, 0)}件） ━━
※「メンバー:」と表示されている送信者はSlackの実在メンバーです。必ず内容を要約してブリーフィングに含めてください。
${params.slackMessages.length > 0
  ? params.slackMessages.map(ch => {
      const isDM = ch.channelName.startsWith('DM');
      const label = isDM ? `[${ch.workspace} DM]` : `[${ch.workspace}/#${ch.channelName}]`;
      return `${label}\n${ch.messages.slice(0, 15).map(m => `  ${m}`).join('\n')}`;
    }).join('\n')
  : '（接続済み・この期間に新着メッセージなし）'}
` : ''}${params.teamsChats !== undefined ? `
━━ Microsoft Teams ━━
${params.teamsChats.length > 0
  ? params.teamsChats.map(c => `[${c.topic}] ${c.lastMessageFrom}: ${c.lastMessageText}`).join('\n')
  : '（接続済み・新着なし）'}
` : ''}${params.chatworkMessages !== undefined ? `
━━ Chatwork（未読${params.chatworkTotalUnread ?? params.chatworkMessages.length}件） ━━
${params.chatworkMessages.length > 0
  ? params.chatworkMessages.map(m => `[${m.roomName}]${m.isMention ? '【メンションあり】' : ''} ${m.accountName}: ${m.body}`).join('\n')
  : '（接続済み・この期間に新着メッセージなし）'}
` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━
【ブリーフィング品質の要件】
━━━━━━━━━━━━━━━━━━━━━━━━
${hasExternalTools ? 'Slack・Chatwork・Notion・' : ''}メールのデータを、以下の4軸で必ず分析して台本に盛り込んでください:

① 背景・文脈
  「これはどういう件についてのやりとりか」「以前からどういう流れがあるか」を整理する

② 現状
  「今どういう状態か」「進行中か・解決済みか・問題が起きているか」を明確にする

③ 問題・リスク（あれば）
  「何が課題になっているか」「放置するとどうなるか」を言語化する

④ ${params.userName}さんへのアクション判断
  「あなたが今すぐ対応すべきか」「返信が必要か」「見ておくだけでいいか」「急ぎではないか」を具体的に判断して伝える

【特に重要なルール】
- 「〇〇からメッセージが来ています」で終わらせない。必ず内容・背景・対応要否まで伝える
${hasChatwork ? '- Chatwork【メンションあり】は最優先で報告。なければ「流れだけ確認しておけばOK」と明示する\n' : ''}${hasSlack ? '- Slack DMは誰からか・何についてかを説明し、返信要否を判断する\n' : ''}${hasNotion ? '- Notionは誰が何を更新したか・そのページが何のプロジェクトか・今後どう影響するかを述べる\n' : ''}- ${hasExternalTools ? '外部ツールのデータが接続・存在する場合、必ずTop of Mindかnext_stepsで言及すること' : 'メール・予定を中心に、今日最も重要な情報をTop of Mindかnext_stepsで伝えること'}

━━━━━━━━━━━━━━━━━━━━━━━━
【4チャプター構成で生成してください】
━━━━━━━━━━━━━━━━━━━━━━━━

JSONのみを返してください:
{
  "chapters": [
    {
      "id": "top_of_mind",
      "title": "最優先事項",
      "iconName": "flame-outline",
      "dialogue": [
        {"speaker": "A", "text": "${returningNote.includes('お帰り') ? 'お帰りの挨拶＋' : '挨拶＋'}今日の最重要事項（緊急メール${hasSlack ? '・Slack DM' : ''}${hasChatwork ? '・Chatworkメンション' : ''}の件名と背景）を一言で（80〜120字）"},
        {"speaker": "B", "text": "その件の現状と問題点・リスク。今すぐ${params.userName}さんが対応すべきか・後回しでいいかの判断を伝える（80〜120字）"},
        {"speaker": "A", "text": "${params.userName}さんが取るべき具体的アクション。「〇〇に返信する」「〇〇を確認する」など動詞で示す（80〜120字）"},
        {"speaker": "B", "text": "次点の優先事項があれば追加。全体を受けて今日の最初の一手をまとめる（80〜120字）"}
      ]
    },
    {
      "id": "schedule",
      "title": "今日のスケジュール",
      "iconName": "calendar-outline",
      "dialogue": [
        {"speaker": "B", "text": "これからの予定を時系列で紹介（終了済みは「朝は〇〇があったね」程度に軽く触れる）（80〜120字）"},
        {"speaker": "A", "text": "次に控えている最重要の予定への準備・注意点・事前にやることがあれば（80〜120字）"},
        {"speaker": "B", "text": "午後〜夕方の予定の流れと、今日全体のスケジュール密度についてのコメント（80〜120字）"},
        {"speaker": "A", "text": "隙間時間にできること・スケジュールの空きをどう使うかの提案（80〜120字）"}
      ]
    },
    {
      "id": "looking_ahead",
      "title": "今後の展望",
      "iconName": "telescope-outline",
      "dialogue": [
        {"speaker": "A", "text": "明日以降の重要な予定${hasNotion ? 'と、Notionで誰が何を更新したか・そのプロジェクトの現状' : 'と今週の山場・注意すべき点'}（80〜120字）"},
        {"speaker": "B", "text": "今対応しておかないと後で困る事項・フォローアップが必要な案件の背景と理由（80〜120字）"},
        {"speaker": "A", "text": "今日のうちに済ませておくべき準備・連絡・確認事項を具体的に（80〜120字）"},
        {"speaker": "B", "text": "今週全体を俯瞰した時の山場・リスクになりそうな日・注意点（80〜120字）"}
      ]
    },
    {
      "id": "next_steps",
      "title": "推奨アクション",
      "iconName": "checkmark-done-outline",
      "dialogue": [
        {"speaker": "A", "text": "今日${params.userName}さんが最初に着手すべき一手を具体的に（ツール・メール・会議のどれか、何をするか）（80〜120字）"},
        {"speaker": "B", "text": "2番目・3番目のアクションと優先する理由。後回しにしていい事も明示する（80〜120字）"},
        {"speaker": "A", "text": "${hasExternalTools ? 'Slack・Chatwork・Notionを踏まえ、' : ''}今日中に返信・確認・クローズすべき事項のまとめ（80〜120字）"},
        {"speaker": "B", "text": "${params.userName}さんへの励ましと今日のポジティブな締めくくり（80〜120字）"}
      ]
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━
【絶対に使用禁止の表現】
━━━━━━━━━━━━━━━━━━━━━━━━
以下は「行動を${params.userName}さんに丸投げしている」ため完全禁止:
- 「ざっと見て」「目を通して」「流れを把握しておいて」「チェックしておいて」
- 「確認が必要です」「確認しておきましょう」「早めに確認が必要でしょう」
- 「活発なやり取りがあります」「やりとりがありますね」
- 「Slack/Chatwork/Notionをチェックしてみてください」
- 「〜があります」で外部ツールへの言及を終わらせる表現
- 「把握しておくのが良い」「見ておくと良い」「確認しておくと良い」

【必須ルール】外部ツールのデータに触れるときはAIが内容を解釈して伝える:
× 禁止:「ChatworkのHeadlightの会話をざっと見て把握しておくのが良い」
○ 正解:「ChatworkのHeadlightで横山さんから佐藤さんへの感謝メッセージがありました。プロジェクトは順調で返信不要です」

Slack・Chatwork・Notionのデータに言及するセリフは以下をすべて含めること:
1. 送信者名（誰から誰へ）
2. 内容の要点（何について・どういう状況か）— AIが代わりに要約する
3. ${params.userName}さんへのアクション判定:「返信必要」「今日中にXXXが必要」「対応不要」のいずれかを明言する

━━━━━━━━━━━━━━━━━━━━━━━━
制約:
- 各セリフは必ず80字以上120字以下（厳守）
- 各chapterは4セリフの対話（計約400字）
- 全体で約1600字（約5〜6分）
- 話し言葉のみ。記号・箇条書き・「・」禁止
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
    userContext?: import('./memoryService').UserContext | null;
    topEmails?:  { from: string; subject: string }[];
  }): Promise<ClaudeBriefingResult> {
    const { getSelectedHosts, DEFAULT_HOST_IDS } = await import('./voiceService');
    const [hostA, hostB] = getSelectedHosts(params.hostIds ?? DEFAULT_HOST_IDS);

    const interestText = params.interests.join('、') || 'テクノロジー、ビジネス、社会';
    const today = new Date();
    const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
    const dateStr = `${today.getMonth() + 1}月${today.getDate()}日（${dayNames[today.getDay()]}）`;

    // ユーザーコンテキストからパーソナライズ情報を構築
    const ctx = params.userContext;
    const personalizationBlock = ctx || params.topEmails?.length ? `
【${params.userName}さんのプロフィール（ニュース選定・解説に反映してください）】
${ctx?.inferredRole ? `推定の役割・職種: ${ctx.inferredRole}` : ''}
${ctx?.recentTopics?.length ? `最近関心のあるトピック: ${ctx.recentTopics.slice(0, 6).join('、')}` : ''}
${params.topEmails?.length ? `最近のメール傾向（業界・興味の手がかり）:\n${params.topEmails.slice(0, 3).map(e => `・${e.from}: ${e.subject}`).join('\n')}` : ''}
→ これらをもとに、${params.userName}さんの仕事・関心に直結するニュースを優先して選んでください。` : '';

    const prompt = `${params.userName}さんの興味・記憶をもとにした今日のニュースキャストを、2人のMCの対話形式で生成してください。
Google検索で取得した最新情報を使い、実際のニュースのみ紹介してください。架空・古い情報は禁止です。

MCの設定:
- ${hostA.name}（A）：${hostA.description}。${hostA.style}
- ${hostB.name}（B）：${hostB.description}。${hostB.style}

【今日の日付】${dateStr}
【ユーザーの興味・関心】${interestText}
${personalizationBlock}

【3つのセクション構成（全体で約5分・約1500字）】
1. 注目ニュース: ${params.userName}さんの関心・記憶・業界に最も直結するニュース1〜2本を深く掘り下げる
2. 業界・テクノロジー: ${interestText}に関連した最新動向とAI・テックの影響
3. 今週の視点: 今週${params.userName}さんが意識すべきトレンドと具体的なアクションヒント

JSONのみ返してください:
{
  "chapters": [
    {
      "id": "news_spotlight",
      "title": "注目ニュース",
      "iconName": "globe-outline",
      "dialogue": [
        {"speaker": "A", "text": "${params.userName}さんの関心に直結する今日の最注目ニュースを紹介（具体的な企業名・数字を含む）（80〜120字）"},
        {"speaker": "B", "text": "そのニュースの背景と業界への影響・重要性を解説（80〜120字）"},
        {"speaker": "A", "text": "${params.userName}さんの仕事・関心への具体的な影響と注目ポイント（80〜120字）"},
        {"speaker": "B", "text": "関連する2本目のニュースまたは同トピックの深掘り（80〜120字）"},
        {"speaker": "A", "text": "このニュースを受けて${params.userName}さんが今週意識すべきことをまとめ（80〜120字）"}
      ]
    },
    {
      "id": "news_industry",
      "title": "業界・テクノロジー",
      "iconName": "trending-up-outline",
      "dialogue": [
        {"speaker": "B", "text": "${interestText}に関連した最新の業界・ビジネス動向を紹介（具体的な事例・数字付き）（80〜120字）"},
        {"speaker": "A", "text": "AI・テクノロジー分野の最新ニュースと${params.userName}さんへの実務的影響（80〜120字）"},
        {"speaker": "B", "text": "業界トレンドの今後の展望と注意すべきリスク（80〜120字）"},
        {"speaker": "A", "text": "国際・マクロ動向が${params.userName}さんの業界・仕事に与える影響（80〜120字）"},
        {"speaker": "B", "text": "今週特にウォッチすべき企業・市場・動向のまとめ（80〜120字）"}
      ]
    },
    {
      "id": "news_insight",
      "title": "今週の視点",
      "iconName": "bulb-outline",
      "dialogue": [
        {"speaker": "A", "text": "今日のニュースを踏まえ${params.userName}さんの業界で今週最も重要な1つのテーマを提示（80〜120字）"},
        {"speaker": "B", "text": "そのテーマに対して${params.userName}さんが今週取れる具体的なアクション（80〜120字）"},
        {"speaker": "A", "text": "今週押さえておくべきキーワード・トレンドワードと背景説明（80〜120字）"},
        {"speaker": "B", "text": "来週以降に向けた展望と${params.userName}さんへの準備アドバイス（80〜120字）"},
        {"speaker": "A", "text": "${params.userName}さんへの励ましと今日・今週のポジティブな締めくくり（80〜120字）"}
      ]
    }
  ]
}

制約:
- 各セリフは必ず80字以上120字以下（厳守）
- 各chapterは5セリフの対話（全体で約1500字・約5分）
- Google検索の最新情報のみ使用。架空ニュース・古い情報禁止
- 話し言葉のみ。記号・箇条書き禁止
- ${hostA.name}は${hostA.style}、${hostB.name}は${hostB.style}
- ${params.userName}さんの記憶・興味に直結するニュースを最優先で選ぶこと
- ${params.userName}さんの役割・関心に直接関係するニュースを優先選択すること
- 全体で約5400字（約10分）を目標にしてください`;

    const lang2 = LANG_NAMES[params.language ?? 'ja'] ?? 'Japanese';
    const sysPrompt2 = `You are an AI that generates engaging podcast dialogue scripts. Respond ENTIRELY in ${lang2}. All dialogue, chapter titles, and content must be in ${lang2}. Output JSON only.`;
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

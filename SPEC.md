# Polaris — 仕様書

最終更新: 2026-07-06（versionCode 37を内部テストへアップロード済み。ニュースパート2段階生成（テーマ選定→深堀り）実装・実API検証済み + ニュース遷移画面の表示修正）

## プロジェクト概要

AIポッドキャスト型モーニングブリーフィングアプリ。
Gmail・カレンダー・（Pro向けに）Slack/Notion/Chatwork/Teamsを取得し、Geminiがデュアルボイスの台本を生成、TTSで音声化して毎朝ポッドキャスト形式で届ける。

---

## リポジトリ

| ブランチ | 用途 | URL |
|---|---|---|
| `master` | アプリ本体（Expo/React Native） | https://github.com/yukidate05/Polaris/tree/master |
| `main` | GitHub Pages（OAuthコールバック・プライバシーポリシー等HTML、`docs/`配下） | https://github.com/yukidate05/Polaris/tree/main |

**コミット先は必ず `master` ブランチ。** `main`はGitHub Pages専用のためアプリコードをpushしないこと。
ローカルでは`docs/`が`main`ブランチの別クローンとして存在する（`.gitignore`で除外済み。ネストしたgitリポジトリなのでmasterのインデックスに混入させない）。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| フレームワーク | Expo SDK 54 / React Native 0.81.5 |
| ルーター | expo-router 6.0 |
| 状態管理 | Zustand |
| 認証 | Firebase Auth + Google Sign-In（Apple Sign-Inは`expo-apple-authentication`、client ID不要） |
| DB | Firestore（`asia-northeast1` / Tokyo） |
| Functionsランタイム | Node.js 20（**2026-10-30 廃止予定 → Node 22移行が必要**） |
| 課金 | RevenueCat |
| アナリティクス | PostHog |
| Web デプロイ | Firebase Hosting（`https://isyd.me`, `polaris-app-yukid.firebaseapp.com`） + Vercel（`https://polaris-omega-three.vercel.app`） |
| Android ビルド | EAS Build（internal distribution、Windowsはローカルビルド不可） |

---

## 環境変数（.env）

```
EXPO_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID          # polaris-app-yukid
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
EXPO_PUBLIC_FIREBASE_APP_ID

EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID         # Google Sign-In (Web)
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID         # Google Sign-In (iOS)

EXPO_PUBLIC_REVENUECAT_IOS_KEY
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY

EXPO_PUBLIC_POSTHOG_API_KEY
EXPO_PUBLIC_POSTHOG_HOST

EXPO_PUBLIC_GEMINI_API_KEY               # 台本生成 + TTS + 記憶抽出で使用
EXPO_PUBLIC_GOOGLE_TTS_API_KEY           # フォールバック用 Google Cloud TTS

EXPO_PUBLIC_APP_ENV
```

`GoogleService-Info.plist`（iOS）と`.env`はgitignore対象。新環境では手動コピーが必要。
`google-services.json`（Android）はgit管理下。

**新マシンでの`.env`復元**: `eas env:pull --environment development` で`.env.local`にEAS側の値を復元可能（Firebase一式・Gemini・Google Sign-In・Google TTS・Notion/Slack/Chatwork Client ID）。
ただし以下はEAS側にも登録がない/読み出し不可のため、各サービスのダッシュボードから別途取得が必要:
- `EXPO_PUBLIC_POSTHOG_API_KEY` / `EXPO_PUBLIC_POSTHOG_HOST`（未設定でも`analytics.ts`が早期returnするためビルド・実行には影響なし）
- `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`本番キー（EAS上は`sensitive`/`secret`可視性でCLI読み出し不可。RevenueCatダッシュボード→API keysで取得）
- `EXPO_PUBLIC_APP_ENV`（コード内では未使用・実質不要）

---

## アーキテクチャ（DDD）

```
┌─────────────────────────────────────────────────────────┐
│  Presentation Layer   app/                              │
│  home.tsx · player.tsx · settings.tsx · *-callback.tsx  │
├─────────────────────────────────────────────────────────┤
│  Application Layer    src/stores/                       │
│  briefingStore · authStore · userPreferencesStore       │
│  （生成フロー制御・状態管理・Firestoreとの橋渡し）       │
├─────────────────────────────────────────────────────────┤
│  Domain Layer         src/services/                     │
│  [Core]    briefingService · claudeService              │
│            memoryService · sessionService               │
│  [TTS]     geminiTtsService · googleTtsService           │
│            speechService                                │
│  [Adapter] notionService · slackService                 │
│            chatworkService · teamsService                │
│            googleDataService                             │
│  [User]    authService · userService                     │
│            subscriptionService · voiceService            │
├─────────────────────────────────────────────────────────┤
│  Infrastructure Layer  src/lib/ · functions/src/         │
│  firebase.ts · revenuecat.ts · analytics.ts              │
│  functionsService.ts (HTTP client)                       │
│  functions/src/index.ts (全バックエンドエンドポイント)    │
└─────────────────────────────────────────────────────────┘
```

### 境界コンテキスト

| コンテキスト | Aggregate Root | 主なDomain Service |
|---|---|---|
| Briefing（コア） | `BriefingScript` | `briefingService.generate()` / `claudeService.generateBriefing()` |
| News（コア） | `NewsSegment`（briefingStore） | `generateNewsSegment()` — Pro向けニュースキャスト |
| Playback | Player state（`player.tsx`） | `geminiTtsService` / `googleTtsService` / `speechService` |
| User | User profile（Firestore `users/{uid}`） | `memoryService`（7日間記憶）/ `sessionService`（進捗記録） |
| Integration（支援） | — | `notionService` / `slackService` / `chatworkService` / `teamsService` |

### 主要パターン
- **Two-Phase Generation**: 台本生成→即再生可能→高品質音声に後から差し替え。ニュースも同じパターンを内包（下記）
- **Repository as In-Memory Store**: Zustand storeは永続化を担わない。各serviceが直接Firestoreに書く
- **Infrastructure Proxy**: クライアントは外部APIキーを一切持たない。全外部呼び出しは`functions/src/index.ts`経由

---

## 多言語対応（i18n）ルール

**UIに表示する文字列を日本語（や他言語）でハードコードしないこと。** 必ず`src/i18n/index.ts`の`useT()`経由で取得する。

- 新しい文言が必要な場合は`T`辞書に9言語（`ja`/`en`/`zh`/`ko`/`es`/`it`/`fr`/`de`/`pt`）分すべて追加する。1言語でも欠けると`T[lang] ?? T.en`のフォールバックで無言のまま英語表示になる（2026-07-04に発覚したItalianロケール丸ごと欠落バグの再発防止）
- 動的な値を含む文言は`{n}`のようなプレースホルダーを使い、`t('key', { n: value })`で埋め込む（`useT()`が`Object.entries(params).reduce(...)`で置換）
- アクセシビリティラベル（`accessibilityLabel`）や`Alert.alert()`の文言も対象。コメントは対象外（ユーザーに見えないため）

**AIプロンプト（`claudeService.ts`等）の指示文も日本語でハードコードしないこと。** システムプロンプトで「`${lang}`で回答して」と指示しても、メインプロンプト本文の指示文自体が日本語だとモデルが日本語に引っ張られたり、対象言語の出力が不自然になる（2026-07-04に`generateBriefing()`で発覚・修正済み。`generateNewsCast()`/`generateDeepcast()`は同じ問題が未修正のまま残っている）。
- 指示文・JSON出力例の中身は英語で書き、実際の出力言語はシステムプロンプトの`${lang}`指示に委ねる
- 文字数指定（「80〜120字」等）はCJK言語専用。`lineLengthInstruction(lang)`のように言語に応じて文字数/単語数を切り替える
- ホストの口調・語尾指示（`voiceService.ts`の`description`/`style`）も「〜だね」「です・ます」等のCJK特有表現を避け、英語で語調を記述する

---

## ブリーフィング生成フロー（`app/(tabs)/home.tsx`）

無料ユーザーはPhase 1/2のみ。**Proユーザーはニュースセグメントが並行生成され、本編の後に自動再生される。**

```
1. status: 'fetching'
   googleDataService.fetchAll(accessToken)  ← Expo Go/トークンなしは MOCK_GOOGLE_DATA
   sessionService.get(uid) で前回の視聴状況取得

2. アクセス制御チェック
   checkIsPro() + subscriptionService.checkAccess(uid)
   非Proかつ3日以内生成済み → PaywallModal表示して中断

3. Phase 1: スクリプト生成（~60〜80秒）status: 'generating_script'
   briefingService.generate(..., skipAudio: true)
     └─ memoryService.getContext(uid)             # ユーザー記憶（7日分）
     └─ fetchExternalToolData()                   # Slack/Notion/Chatwork/Teams（Pro専用）
     └─ claudeService.generateBriefing(...)       # Gemini Function呼び出し・150s timeout
        └─ extractJsonFromText(text)              # thinkingトークン混入対策
        └─ parseChapters(text)                    # JSON → ChapterDraft[]
   setScript(sc) → status: 'ready'（デバイスTTSで即再生可能）
   subscriptionService.recordGeneration(uid)

4a. 【Proのみ・並行開始】ニューステキスト生成（TTSより先に開始）
   targetMinutes = max(5, round((600 - sc.estimatedSeconds) / 60))
   newsTextPromiseRef = generateNewsSegment({ uid, interests, targetMinutes, ... })
     └─ getCachedNews(uid, lang) があれば Function を呼ばずキャッシュ使用
     └─ なければ claudeService.generateNewsCast(...)  # useSearch=true, Google Search grounding

4b. Phase 2: ブリーフィング音声生成（~200秒）status: 'generating_audio'
   geminiTtsService.generateDialogueAudio(dialogue) 失敗時 → googleTtsService にフォールバック
   updateAudioUri(uri) → status: 'ready'

4c. 【Proのみ】ブリーフィングTTS完了後、ニュースTTSを直列生成
   newsText = await newsTextPromiseRef  # 4aで並行生成していたテキストを回収
   setNewsSegment({ chapters, dialogue, estimatedSeconds, interestText, audioUri: null })
   遷移アナウンス音声（言語ごとに事前生成済みの固定音声・下記参照）を即セット → setTransitionAudioUri
   geminiTtsService.generateDialogueAudio(newsText.dialogue)  # 本編再生中に完了する想定
     → setNewsAudioUri(uri) / setNewsStatus('ready' | 'error')

   player.tsx側のPlayPhase: 'briefing' → 'transition'（遷移セリフ再生）→ 'bridge'
   （ホーム画面と同じbgmServiceで最低10秒BGM、ニュース音声が準備でき次第フェードアウト）→ 'news'

5. フォアグラウンド復帰リカバリ（AppStateリスナー）
   generating_audio中の復帰 → Firestore users/{uid}.ttsAudioUrl を確認（15分以内なら適用）
   generating_script中の復帰 → 3分以上経過なら status='idle' にリセット（3分未満は二重課金防止のため何もしない）
```

**ニュースの二段階化（Two-Phase News）のポイント**: ニューステキスト生成（4a）を本編TTS生成（4b）と並行に開始することで、シーケンシャルに実行する場合より総待ち時間を短縮している。ニュースの音声生成（4c）も本編再生中にバックグラウンドで完了させる設計。

---

## 主要サービス

### 台本生成 (`src/services/claudeService.ts`)
- モデル: `gemini-2.5-flash`（`thinkingBudget: 0`）
- 出力: 5章構成 JSON（opening / email / schedule / insights / closing）
- 各セリフ: 80〜120字（厳守）、全体目標 約1800字（5〜6分想定）
- MC: Aria（A・女性）/ Kai または Crest（B・男性）
- `userContext`（記憶）があればプロンプトに注入

**`extractJsonFromText` / `parseChapters`** — Gemini 2.5 Flashがthinkingトークンを実レスポンスと同一partに混入させる問題への対策:
```typescript
// 末尾から逆走して最後の完全なJSONブロックを抽出（thinking内容は先頭にあるためスキップされる）
function extractJsonFromText(text: string): string | null { /* ... */ }

function parseChapters(text: string): ChapterDraft[] {
  const jsonStr = extractJsonFromText(text);
  if (!jsonStr) throw new Error('gemini_parse');
  const parsed = JSON.parse(jsonStr);
  const chapters = parsed.chapters ?? parsed.briefing?.chapters ?? parsed.script?.chapters;
  if (!Array.isArray(chapters)) throw new Error('gemini_parse_no_chapters');
  return chapters.map((c: any) => ({ ...c, text: (c.dialogue ?? []).map((t: any) => t.text).join('　') }));
}
```
失敗すると`templateChapters()`フォールバック（約1分の短縮版）を使う。

Firebase Function `gemini`側でも同様の対策あり（`responsePartWithJson = parts.find(p => !p.thought && p.text?.includes('"chapters"'))`）。

### ニュースキャスト生成 (`generateNewsSegment` / `claudeService.generateNewsCast`, Pro専用)
- 構成: 3セクション × 5ターン（計15ターン）、目標 約1500字・約5分
- `useSearch=true`でGoogle Search grounding
- セクション: news_spotlight（注目ニュース）/ news_industry（業界・テクノロジー）/ news_insight（今週の視点）
- キャッシュ: `getCachedNews(uid, lang)` → Firestore `users/{uid}/cache/dailyNews`（当日・同言語ならFunction呼び出しをスキップ）

### 音声合成
- `geminiTtsService.ts`: `gemini-2.5-flash-preview-tts`、全対話を1回のAPIコールでマルチスピーカー生成
  - Aria → `Aoede`（女性）/ Crest → `Puck`（男性）。PCM 24kHz 16bit mono → WAVヘッダー付加
  - Gemini TTSの音声は多言語対応のためlanguage指定不要
- `googleTtsService.ts`: フォールバック。`language`をFunctionに渡し、`GOOGLE_VOICES_BY_LANG`（`functions/src/index.ts`）で言語ごとに音声を切替（ja以外はStandard系、jaのみ`ja-JP-Neural2-B/C`）
- `transitionVoiceService.ts`: ニュース遷移セリフ専用。9言語ぶんGemini TTS（Aria/Aoede）で事前生成した固定音声を`assets/audio/transition/`にバンドルし、ライブ生成せず再生（2026-07-05〜）

### ホスト設定 (`src/services/voiceService.ts`)
| ホスト | speaker | スタイル |
|---|---|---|
| Aria | A | 明るく・テンポよく・フレンドリー。「〜だね」「〜だよ」 |
| Crest | B | ですます調・丁寧語で力強く。「〜です」「〜ます」「要点をまとめますと」 |

デフォルト: `DEFAULT_HOST_IDS = ['aria', 'crest']`

### Gmail取得 (`googleDataService.ts`)
- フィルター: `after:{unixエポック秒} category:primary`（直近24時間・メインタブのみ）
- topEmails: 最大5件のSubject/From
- **2026-07-05修正**: 当初は`after:YYYY/MM/DD`（文字列・日付境界）で、日付が変わる前の夜間メールが翌日以降も含めて恒久的に取りこぼされる不具合があった。一度「今日0時のUnix秒」に変更したが日付境界問題自体は残るため、最終的に**直近24時間のローリング窓**（`Date.now() - 24h`）に変更し、タイムゾーンの曖昧さと夜間メール取りこぼしの両方を解消

### ユーザー記憶 (`memoryService.ts`)
- Firestore: `users/{uid}/memory/context`
- 蓄積: `inferredRole` / `inferredInterests`（職業的関心分野・業界・趣味、最大8個、recentTopicsより長期・安定的） / `frequentContacts`（最大10人） / `recentTopics`（最大10個） / `pendingFollowups`（最大5個）
- 直近7日分を保持。生成完了後にバックグラウンドで非同期抽出・保存（ノンブロッキング）

### ニュースの興味関心決定 (`briefingService.generateNewsSegment`)
優先順位: ①`userContext.inferredInterests`（メモリから推定・蓄積型） → ②`memoryService.inferColdStartInterests()`（①が無い初回〜数回目のユーザー向け、今日のメール差出人・件名・Slack/Notion/Chatwork内容からその場で軽量Gemini呼び出しで推定） → ③`preferences.topicsOfInterest`（デフォルト`['ai_tech','business','market']`固定・設定UIなし、②も根拠なしの場合の最終フォールバック）
- 生成を重ねるごとに`memoryService.extractAndSave`が①を育てていくため、②はあくまで立ち上がり期間だけの補完（2026-07-05〜）

### ニュースパートの2段階生成（Two-Phase News、2026-07-06〜）
`claudeService.selectNewsTheme()`（Phase1: テーマ選定）→`claudeService.generateNewsCast()`（Phase2: 深堀り生成）の順で呼ぶ。どちらもGoogle Search grounding（`useSearch:true`）付きのGemini呼び出し。
- **Phase1**: ユーザーの関心・記憶・topEmailsをもとに今日の実在ニュースを検索させ、深堀りに値する単一テーマ1つ・選定理由・裏付けとなる具体事実`keyFacts`（最大5件）・触れるだけの他トピック`otherTopics`（最大3件、実際は先頭2件使用）をJSONで返させる（`NewsThemeSelection`型）
- **Phase2**: Phase1の`theme`/`keyFacts`を渡し、「Background → Deep Dive → Impact & Outlook」の3チャプターで単一テーマを深堀り。最後に`otherTopics`があれば「Also Today」チャプターで短く触れて締める
- **旧実装の不具合と対策**: 以前は3セクション×5行固定で、プロンプト内の「~X分」という指示文はテキストとして書かれているだけでJSON例のセリフ数は常に15行固定だったため、`targetMinutes`をいくつ渡しても実際の生成量が変わらず、体感で常に3分程度にしかならない不具合があった。修正後は`targetMinutes`から逆算した目標セリフ数を`NEWS_DEEPDIVE_TEMPLATES`（3チャプターの指示文バンク、各10/10/8行）から動的に切り出し、JSON例自体のセリフ数を変えることで実際の生成量を追従させている
- **実API検証済み（2026-07-06）**: 本番のGemini鍵（`firebase functions:secrets:access GEMINI_API_KEY`）で直接2回検証。①「80〜120文字」という指示文があってもモデルは平均60字/行程度でしか書かず、素朴に`avgLineChars=100`で計算すると7分指定で実測4.0分にしかならなかった → `avgLineChars`をCJK=65/その他=80に補正し、指示文も「短い断片は不可、完全な文で」と強めた結果、7分指定で実測7.4分まで近づいた。②テーマ選定フェーズは実在の時事ニュース（検証時は「アブダビ政府のAIネイティブ政府構想」）を正しく拾えることを確認済み
- テンプレートバンクの枯渇（計28行）が実質的な上限で、目安targetMinutes 8〜9分あたりから頭打ちになる
- `briefingService.generate()`内にあった旧・単一フェーズ版のニュース生成コード（`skipNews`フラグ経由、呼び出し元`home.tsx`が常に`true`で渡すため実質到達不能だった）は削除済み。ニュース生成は`generateNewsSegment()`に一本化

### プレイヤー字幕 (`app/player.tsx`)
- 3スロット表示: 前（opacity 0.6）/ 現在（大・明、フェード130ms out→200ms in）/ 次（opacity 0.6）/ 遠いターン（`FAR_H=72px`固定、`rgba(255,255,255,0.35)`）
- 字幕切替タイミング: `ahead = currentSec + syncOffset`（デフォルト `syncOffset = -1.0s`）、設定UIで-4.0〜+2.0の範囲を0.5s単位で調整可能
- `PlayPhase`: `'briefing' | 'transition' | 'bridge' | 'news'`、`completedNaturallyRef`で自然終了を追跡しcompletionRate=1.0を保証
  - `bridge`: 遷移セリフ再生後、ニュース本編の前に挟むBGMバッファ（`bgmService`流用、最低10秒→ニュース音声準備でき次第フェードアウト）

### BriefingStore (`src/stores/briefingStore.ts`)
```typescript
status: 'idle' | 'fetching' | 'generating_script' | 'generating_audio' | 'ready' | 'error' | 'quota_exceeded'
newsStatus: 'idle' | 'generating' | 'ready' | 'error'

setScript(s)         → script = s, status = 'ready'
updateAudioUri(uri)  → script.audioUri のみパッチ（statusは変えない）
setNewsSegment / setNewsAudioUri / clearNews
```

---

## Firebase Functions（`asia-northeast1`、全11エンドポイント）

| Function | 用途 | Secrets | レート制限 | サブスク確認 |
|---|---|---|---|---|
| gemini | Gemini APIプロキシ（台本生成・記憶抽出） | GEMINI_API_KEY | — | ✓ |
| geminiTts | Gemini multiSpeaker TTS → Storage保存 → URL返却 | GEMINI_API_KEY | 2分/ユーザー | ✓ |
| googleTts | Google Cloud TTSフォールバック（MP3 base64） | GEMINI_API_KEY | — | — |
| notionAuth / notionPages | Notion OAuth・ページ取得 | NOTION_CLIENT_ID/SECRET | — | — |
| slackAuth / slackMessages | Slack OAuth・過去7日メッセージ | SLACK_CLIENT_ID/SECRET | — | — |
| teamsAuth / teamsMessages | Teams OAuth・最新チャット | TEAMS_CLIENT_ID/SECRET | — | — |
| chatworkAuth / chatworkMessages | Chatwork OAuth・過去48h/上限20件 | CHATWORK_CLIENT_ID/SECRET | — | — |

**⚠️ Secretの設定は必ず`printf`（Bash）で行うこと。** PowerShellの`echo`は`\r\n`混入で`bad_client_secret`になる。
`GOOGLE_TTS_API_KEY`は廃止済み（`GEMINI_API_KEY`に統合）。

### geminiTtsの重要実装ポイント
- Cloud Run 32MBレスポンス上限回避のためStorage化（`audio/{uid}/brief.wav`、固定名で毎回上書き）
- ハートビート方式（`res.write(' ')`）はCloud Run GFEバッファリングで機能しない → **Firestoreポーリングが唯一有効な解決策**（クライアントは15秒×20回=5分ポーリング、`ttsUpdatedAt`で判定）
- バケット名は明示指定必須（Gen 2 FunctionsはFIREBASE_CONFIGから自動取得しない）

### 入力長バリデーション
| endpoint | パラメータ | 上限 |
|---|---|---|
| gemini | prompt / systemPrompt | 200,000字 / 10,000字 |
| geminiTts | transcript | 15,000字 |
| googleTts | text / dialogue turn | 2,000字 / 200字・最大200ターン |

### Firestoreデータ構造
```
users/{uid}: {
  plan, firstOpenedAt, lastFreeUseAt, geminiTtsLastCallAt,
  ttsAudioUrl, ttsUpdatedAt,
  notionAccessToken, notionWorkspaceId, notionOwnerId,
  slackWorkspaces: [{teamId, teamName, accessToken}]  // 最大5
  teamsAccessToken/RefreshToken/TokenExpiresAt/DisplayName,
  chatworkAccessToken/RefreshToken/TokenExpiresAt/chatworkName,
}
users/{uid}/memory/context     // inferredRole, frequentContacts, recentTopics, pendingFollowups
users/{uid}/cache/dailyNews    // date, language, chapters, cachedAt
```

### OAuthコールバックフロー（Slack/Notion/Teams/Chatwork共通）
`settings.tsx` → `WebBrowser.openAuthSessionAsync` → 各サービス認証 → GitHub Pages（`docs/`配下のcallback html）→ deep link `polaris://xxx-callback` → `app/xxx-callback.tsx` → Function呼び出し → Firestore保存

**自己編集フィルタ**: `notionOwnerId`（Firestore）↔ `last_edited_by.id`（Notion API）でID比較し自分の編集を除外。既存ユーザー向けにはワンタイム移行ロジックあり（`notionPages`内）。

---

## Google OAuth検証状況（2026-06-29時点）

「このアプリはGoogleで検証されていません」警告の解消作業:
- ✅ `isyd.me`カスタムドメイン・SSL・Search Console所有権確認 完了
- ✅ Google Cloud Consoleブランディング（ホームページ/プライバシー/利用規約URL・承認済みドメイン）検証済み
- ⏳ データアクセス申請（`gmail.readonly`スコープ）審査中。審査通過で警告解消・100ユーザー制限解除
- 注意: 制限付きスコープのためCASA（Cloud App Security Assessment、$75〜150程度）が必要になる可能性あり

---

## リリース状態（Android）

| vc | 主な変更 | Play Console |
|----|---------|-------------|
| 3〜18 | （初期実装〜バグ修正） | 公開済み |
| 19 | expo-keep-awake・Firestore新規ユーザー作成ルール修正 | 公開済み |
| 20〜27 | 2フェーズ生成・Pro10分・字幕syncOffset・thinking汚染修正・BG復帰3分ルール | 公開済み |
| 28〜30 | Chatwork名前自動取得・メモリ更新・BG一時停止・再生不能修正 | 内部テスト公開済み |
| 31 | 記憶7日・Notion名前認識・ニュース10分キャッシュ・replay・Italian追加・エラーハンドリング | 内部テスト アップロード済み |
| 32 | player完了率/進捗バー/TTS遷移バグ4件・Notion自己編集filter移行ロジック | 内部テスト アップロード済み |
| 33 | 多言語対応修正（UIハードコード・Italianロケール欠落・generateBriefing()プロンプトの言語バイアス） | ※実際のEASビルドはvc35でまとめて実施（下記） |
| 34 | 多言語対応修正 続き（遷移アナウンス文言・generateNewsCast()プロンプトの言語バイアス・briefingService.tsのinterestText区切り文字） | ※実際のEASビルドはvc35でまとめて実施（下記） |
| 35 | 上記33・34の内容をまとめて初めてEASビルド・アップロード（`app.config.ts`のversionCodeは32→35に一括で上げた） | 内部テスト アップロード済み（Google Play Developer APIで確認済み） |
| 36 | ニュースパート2段階生成（テーマ選定→深堀り、`selectNewsTheme`/`generateNewsCast`）・targetMinutes追従修正 | ビルド完了（EAS build ID `b94fcac1-d60c-4151-a3c2-b0ad4a934e7a`）のみ・Play Consoleへは未アップロードのままvc37に差し替え |
| 37 | ニュース遷移画面（本編→ニュースパート間）の表示修正。`newscast_label`翻訳キー欠落・`interestText`（実テーマと無関係な固定の興味カテゴリ表示）を廃止し`news_briefing_label`固定ラベルに置き換え | 内部テスト アップロード済み（2026-07-06、EAS build ID `7b4695d8-5dad-4d21-9afe-5bd45eb05612`） |

| トラック | 状態 | バージョン |
|---|---|---|
| クローズドテスト Alpha（実テスター在籍: `polaris-testers@googlegroups.com`） | アップロード済み | vc39（2026-07-18、テスターフィードバック7件対応） |
| 内部テスト（テスター未登録・実質未使用） | アップロード済み（参考） | vc38 |
| 製品版 | 未提出 | — |

**注記（2026-07-18）**: Play Developer APIで直接確認した結果、`internal`トラックにはテスターが1人も登録されておらず、実際のフィードバックはすべて`alpha`トラックのGoogleグループ経由。`upload_aab.mjs`のデフォルト提出先を`internal`→`alpha`に変更済み。今後のアップロードは`node upload_aab.mjs polaris-vc{N}.aab`でalphaへ提出される。

---

## ローカル開発

```bash
# JS変更のみ（最速）
npx expo start
# → スマホのEAS dev clientアプリでQRスキャン or URL入力

# ネイティブ変更がある場合
eas build --platform android --profile development
```

## ビルド〜アップロード手順

**コード変更後は必ずビルドしてPlay Consoleにアップロードするところまで完了させること。**

1. `app.config.ts`の`versionCode`を+1
2. EASクラウドビルド（Windowsはローカルビルド不可）
   ```bash
   eas build --platform android --profile production --non-interactive
   ```
3. AABをダウンロード
   ```powershell
   Invoke-WebRequest -Uri "<EAS_URL>" -OutFile "polaris-vc{N}.aab" -UseBasicParsing
   ```
4. Play Consoleにアップロード（`upload_aab.mjs`はプロジェクトルート配置済み）
   ```bash
   node upload_aab.mjs polaris-vc{N}.aab
   ```
   前提: サービスアカウントJSON `polaris-app-yukid-458b1ff906c2.json` がプロジェクトルートに存在すること（`upload_aab.mjs`と同階層、`path.join(import.meta.dirname, ...)`で解決。gitignore対象・マシンごとに手動配置が必要。バックアップは`H:\マイドライブ\AI\Secrets\Polaris\`）。アップロード先: `alpha`トラック（2026-07-18、実テスターが在籍するのがalphaと判明したため`internal`から変更）。
   `googleapis`パッケージが必要（devDependency、2026-07-04追加）。

**アップロード確認方法**: `com.yukid.polaris`は製品版・betaトラックが未提出のため、一般公開URL（`https://play.google.com/store/apps/details?id=com.yukid.polaris`）は**404になる**（これは正常。バグではない）。アップロードが実際に反映されたかは以下で確認する:
```js
// androidpublisher APIでedits.tracks.get / edits.bundles.listを叩き、
// バンドルのsha1と手元のAABファイルのsha1（sha1sum）を突き合わせる
```
端末側での反映確認は、クローズドテスト参加リンクからインストールしたPlay Storeアプリ内でのみ可能（一般公開ページでは不可）。反映まで数分〜数十分のタイムラグがあることがある。

### Web
```bash
npx expo export --platform web
vercel deploy dist --token <TOKEN> --yes   # vercel loginはWindowsユーザー名(日本語)問題でtoken直接渡し
```

### EAS環境変数グループ（`development`/`preview`/`production`固定・リネーム不可）

`eas.json`のビルドプロファイル名（`development`/`preview`/`production`）とEAS環境変数グループ名は別概念。プロファイルの`"environment"`フィールドでどのグループを使うか指定する。

| ビルドプロファイル | 参照する環境変数グループ | 備考 |
|---|---|---|
| `development` | （未指定） | ローカル`.env`を使用 |
| `preview` | `development` | 意図的にdevelopmentグループを参照 |
| `production` | `production` | 2026-07-04修正: 以前は誤って`development`グループを参照していた（`production`グループはRevenueCat iOSキーのみで他14変数が欠落）。全14変数を`production`グループに複製し、`eas.json`を修正済み |

`EXPO_PUBLIC_`変数は`secret`可視性で新規作成不可（EAS CLI側の制約、アプリバンドルに平文で入るため）。既存の`secret`変数（RevenueCat iOSキー等）はそのまま維持されるが、新規追加は`sensitive`または`plaintext`を使うこと。

---

## 未完了タスク・TODO

### リリースブロッカー
- [ ] Alpha審査通過（審査中、テスター12名以上・14日間運用が必要）→ 製品版へプロモート
- [ ] Google OAuth検証（データアクセス審査中）→ 通過待ち、CASA費用発生の可能性

### 技術的負債
- [ ] Firebase Functions Node 20 → 22（2026-10-30廃止期限）
- [ ] `teamsMessages` / `chatworkMessages` にレート制限追加（現状未実装）
- [ ] Slack再接続案内UI（`users:read`スコープ未取得の既存接続向け）
- [ ] 字幕タイミング精度向上（文字数比率推定のため実音声とズレる場合あり）
- [ ] `generateDeepcast()`の多言語対応（`generateBriefing()`/`generateNewsCast()`と同じ日本語プロンプトバイアス問題が未修正のまま残っている）。`app/deepcast.tsx`から呼ばれるオンデマンドのトピック解説機能専用で、ニュースパート（`generateNewsCast()`、既に多言語対応済み）とは別物。`lang`引数自体を受け取っておらず、指示文・JSON出力例のtitle・システムプロンプトが丸ごと日本語ハードコードのため、端末言語に関わらず常に日本語で生成される（2026-07-06確認）

### 調査中（2026-07-05）
- [ ] 「新着メール取得できてない気がする」報告の原因特定。仮説2つ:
  1. `after:YYYY/MM/DD`のタイムゾーン境界バグ → Unixタイムスタンプ方式に修正済み（`googleDataService.ts`）
  2. Gmail検索API自体の索引反映遅延（届いたばかりのメールが`q=`検索にすぐ載らない可能性、OAuth認証のリアルタイム性とは別問題）→ 未確認。次回、実際に「メール送信直後に生成」で再現するか要検証
- [ ] EAS build creditsが請求期間の97%消費（2026-07-06 vc37ビルド時点、ビルドログで確認。vc36時点の95%からさらに増加）。ほぼ従量課金ラインに到達済みのため、次回以降のビルドはpay-as-you-go料金が発生する前提で見積もる必要あり。詳細: https://expo.dev/accounts/semla/settings/billing

### 未着手
- [ ] iOS版ビルド
- [ ] Vercelデプロイ自動化（GitHub Actions等）
- [ ] 記憶内容をSettingsで確認・編集できるUI

収益化・価格戦略・プロダクト方向性は別メモリ参照（`project-monetization`, `project-strategy-direction`, `project-huxe-analysis`）。

---

## 作業ログ

### 2026-07-04: 新マシン環境セットアップ

旧マシン（ユーザー名`yukid`）から新マシン（ユーザー名`YUki`）へ移行。以下を実施:
- Node.js v24.14.1・git 2.53.0（導入済み確認）
- `firebase-tools` / `eas-cli` / `vercel` を新規ログイン（すべて`yukidate05@gmail.com`）
- Google Cloud SDK: `gcloud auth login` + `gcloud config set project polaris-app-yukid`（Git Bash経由だとWindows Storeのpythonスタブを誤検出して`gcloud --version`が壊れて見えるが、PowerShell経由なら問題なし。ブラウザリダイレクト方式のログインはこのハーネスのバックグラウンド実行では窓が開かないため、`Start-Process`で別ウィンドウを起動して手動認証する必要があった）
- JDK 17（Microsoft OpenJDK）・Android Studio・`platform-tools`（adb）をwingetで新規インストール
- `npm install`実行（node_modules未生成だった）
- Play Consoleアップロード用サービスアカウントJSON（`polaris-app-yukid-458b1ff906c2.json`）を旧マシンから移設、プロジェクトルートに配置・`.gitignore`に追加。`upload_aab.mjs`のハードコードパスを相対パス解決に修正
- EAS `production`環境変数グループの不整合を修正（詳細は上記「EAS環境変数グループ」参照）

結果: `eas build --profile production` からPlay Consoleアップロードまで新マシンで一通り実行可能な状態。

### 2026-07-04: 多言語対応の不具合修正

デバイス言語を英語に設定していても、ホーム画面の一部が日本語のまま・ブリーフィングが時々日本語で生成される・英語音声が棒読み、という報告を受けて調査・修正。

**UIハードコード文字列（`src/i18n/index.ts`）:**
- ホーム画面の生成ステップ表示（データ取得/スクリプト生成/音声生成）、エラーバナー、アクセシビリティラベルが日本語ハードコードだったため`t()`経由に変更
- サブスク状態バナー（`SubscriptionStatusBanner.tsx`）・ペイウォール（`PaywallModal.tsx`）の残り日数表示・機能リスト・CTAも同様に修正
- 設定画面のプラン/トライアル表示（`settings.tsx`）も修正
- 9言語（ja/en/zh/ko/es/it/fr/de/pt）分の翻訳キーを追加。`useT()`にプレースホルダー補間（`{n}`など）を追加
- **副次的発見**: `SUPPORTED_LANGUAGES`にItalian(`it`)が登録されているのに翻訳辞書(`T`)に`it`のエントリが丸ごと存在せず、Italianユーザーは常に英語にフォールバックしていたバグを修正（辞書を新規追加）

**ブリーフィング生成プロンプトの言語バイアス（`src/services/claudeService.ts` `generateBriefing()`）:**
- 根本原因: システムプロンプトで「`${lang}`で全て回答して」と指示していたが、メインプロンプト本文・JSON出力例の`text`フィールドの中身が丸ごと日本語で書かれていたため、指示文の大部分が日本語コンテキストとなり、時々日本語に引っ張られる・英語の言い回しがぎこちなくなる原因になっていた
- 「80〜120字」という文字数指定もCJK専用の指示だった → `lineLengthInstruction(lang)`で日/中/韓は文字数、それ以外は単語数（15〜25語）に分岐
- プロンプト本文・JSON出力例・禁止表現リストなどの指示文を全て英語に書き直し（出力自体は引き続き`${lang}`で生成されるようシステムプロンプトで指示。指示文は英語でも出力は動的に切り替わる設計）
- `src/services/voiceService.ts`のホスト`description`/`style`（Claudeプロンプト専用、UIには`mood`のみ表示）も日本語の語尾表現（「〜だね」「〜です」等）で書かれておりCJK専用だったため英語の記述に変更
- **未対応（今回のスコープ外・合意済み）**: `generateDeepcast()`（オンデマンドのトピック解説）は同じ問題を抱えたまま

**実機テスト（vc33）で追加発覚・修正（vc34）:**
- ホーム画面のPart1→Part2間の遷移アナウンス（`app/(tabs)/home.tsx`）が`lang === 'ja' ? ... : ...`の二択判定で、英語以外（zh/ko/es/it/fr/de/pt）は未対応だった → `i18n`の`transition_announcement`キー（9言語・`{name}`/`{topic}`プレースホルダー）に置き換え
- `src/services/briefingService.ts`の`generateNewsSegment()`内`interestText`が区切り文字`・`とフォールバック「テクノロジー・ビジネス」を日本語ハードコードしていた → `, `区切り・英語フォールバックに変更（生成する側の`claudeService.ts`と同じ言語非依存な扱いに統一）
- **`generateNewsCast()`（第2パート・ニュースキャスト生成）のプロンプトも`generateBriefing()`と同じ言語バイアス問題があり修正**。実際にAPI呼び出しで英語生成を確認済み（Google Search grounding込み）
- これで`generateDeepcast()`以外の全生成経路（ブリーフィング本編・ニュースキャスト・遷移アナウンス）が言語非依存になった

### 2026-07-06: ニュースパートの2段階生成（Two-Phase News）実装 + vc36ビルド

「ニュースパートをもっと長く、1テーマを深堀りできないか」という要望を受けて設計・実装。詳細は上記「ニュースパートの2段階生成」参照。

- `claudeService.selectNewsTheme()`（Phase1: テーマ選定、Google Search grounding）→`claudeService.generateNewsCast()`（Phase2: 深堀り生成）の2段階に変更
- 旧実装は3セクション×5行固定でJSON例のセリフ数が`targetMinutes`に関わらず変化しない不具合があり、「ニュースが毎回3分程度にしかならない」という報告の一因だった。`NEWS_DEEPDIVE_TEMPLATES`から動的にセリフ数を切り出す方式に変更し解消
- 本番Gemini鍵（`firebase functions:secrets:access GEMINI_API_KEY`）を使い実API直接検証を2回実施。1回目で「80〜120文字」指示があってもモデルは平均60字/行程度でしか書かず、素朴な計算だと7分指定が実測4.0分にしかならないと判明 → 行数計算の補正係数（`avgLineChars`）と指示文強化で7分指定→実測7.4分まで改善
- `briefingService.generate()`内にあった旧・単一フェーズ版ニュース生成コード（`skipNews`フラグ経由、呼び出し元`home.tsx`が常に`true`で渡すため実質到達不能だった）を削除し、`generateNewsSegment()`に一本化
- `app.config.ts`のversionCodeを35→36に変更しEASクラウドビルド開始（build ID `b94fcac1-d60c-4151-a3c2-b0ad4a934e7a`）。ビルド中にEAS build creditsが請求期間の95%消費と判明（前回確認時91%から増加）
- **副次的発見**: Google Play Developer API（`edits.tracks.get`）で内部テストトラックを確認したところ、実際に反映されていたのは`versionCode 35`で、SPEC.mdの変更履歴表が主張していた「vc34まで実施済み」という記述と食い違っていた。実際にはvc33・34の内容はどちらも個別にはビルドされず、versionCodeを35まで一括で上げた状態で1回だけEASビルド・アップロードされていた（変更履歴表を実態に合わせて修正済み）

### 2026-07-06: ニュース遷移画面の表示修正

実機スクリーンショットで、本編とニュースパートの間の遷移画面に「ai_tech, business, market / newscast_label」という生の文字列が表示されている不具合を発見・修正。

- 原因1: `player.tsx`が呼んでいた`t('newscast_label')`キーがi18n辞書に存在せず、フォールバックでキー名がそのまま画面に表示されていた
- 原因2: 見出しに表示していた`newsSegment.interestText`（`briefingService.ts`の`generateNewsSegment()`が返す、ユーザーの興味カテゴリを3つ`join(', ')`しただけの値）が、その日実際に`selectNewsTheme()`が選んだニューステーマとは無関係の固定値で、翻訳もされない生のカテゴリキー（`ai_tech`等）だった
- 対応方針として、興味カテゴリ表示自体をやめてシンプルな汎用ラベルに変更する案を採用（実テーマ名を表示する案もあったが見送り）
- `player.tsx`の遷移画面見出しを`t('news_briefing_label')`（9言語追加）に置き換え。`newsSegment.interestText`はこれで表示先が無くなり未使用のプロパティとして残っている（削除は未着手）

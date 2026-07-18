# Polaris — 仕様書

最終更新: 2026-07-04（versionCode 32時点）

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
   遷移アナウンス音声（Google TTS、数秒）を即生成 → setTransitionAudioUri
   geminiTtsService.generateDialogueAudio(newsText.dialogue)  # 本編再生中に完了する想定
     → setNewsAudioUri(uri) / setNewsStatus('ready' | 'error')

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
- `googleTtsService.ts`: フォールバック（`ja-JP-Neural2-B/C`）

### ホスト設定 (`src/services/voiceService.ts`)
| ホスト | speaker | スタイル |
|---|---|---|
| Aria | A | 明るく・テンポよく・フレンドリー。「〜だね」「〜だよ」 |
| Crest | B | ですます調・丁寧語で力強く。「〜です」「〜ます」「要点をまとめますと」 |

デフォルト: `DEFAULT_HOST_IDS = ['aria', 'crest']`

### Gmail取得 (`googleDataService.ts`)
- フィルター: `after:YYYY/MM/DD category:primary`（当日受信・メインタブのみ）
- topEmails: 最大5件のSubject/From

### ユーザー記憶 (`memoryService.ts`)
- Firestore: `users/{uid}/memory/context`
- 蓄積: `inferredRole` / `frequentContacts`（最大10人） / `recentTopics`（最大10個） / `pendingFollowups`（最大5個）
- 直近7日分を保持。生成完了後にバックグラウンドで非同期抽出・保存（ノンブロッキング）

### プレイヤー字幕 (`app/player.tsx`)
- 3スロット表示: 前（opacity 0.6）/ 現在（大・明、フェード130ms out→200ms in）/ 次（opacity 0.6）/ 遠いターン（`FAR_H=72px`固定、`rgba(255,255,255,0.35)`）
- 字幕切替タイミング: `ahead = currentSec + syncOffset`（デフォルト `syncOffset = -1.0s`）、設定UIで-4.0〜+2.0の範囲を0.5s単位で調整可能
- `PlayPhase`: `'briefing' | 'transition' | 'news'`、`completedNaturallyRef`で自然終了を追跡しcompletionRate=1.0を保証

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
| 32 | player完了率/進捗バー/TTS遷移バグ4件・Notion自己編集filter移行ロジック | 内部テスト アップロード済み ✅（最新） |

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
   前提: サービスアカウントJSON `secrets/polaris-app-yukid-458b1ff906c2.json`(プロジェクトルート直下、Git管理外)が存在すること。アップロード先: `internal`トラック。

### Web
```bash
npx expo export --platform web
vercel deploy dist --token <TOKEN> --yes   # vercel loginはWindowsユーザー名(日本語)問題でtoken直接渡し
```

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

### 未着手
- [ ] iOS版ビルド
- [ ] Vercelデプロイ自動化（GitHub Actions等）
- [ ] 記憶内容をSettingsで確認・編集できるUI

収益化・価格戦略・プロダクト方向性は別メモリ参照（`project-monetization`, `project-strategy-direction`, `project-huxe-analysis`）。

# Polaris — 仕様書・作業記録

## プロジェクト概要

AIポッドキャスト型モーニングブリーフィングアプリ。  
Gmailとカレンダーを取得し、Geminiがデュアルボイスの台本を生成、TTSで音声化して毎朝ポッドキャスト形式で届ける。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| フレームワーク | Expo SDK 54 / React Native 0.81.5 |
| ルーター | expo-router 6.0 |
| 状態管理 | Zustand |
| 認証 | Firebase Auth + Google Sign-In |
| DB | Firestore（Tokyo リージョン） |
| 課金 | RevenueCat |
| アナリティクス | PostHog |
| Web デプロイ | Vercel（https://polaris-omega-three.vercel.app） |
| Android ビルド | EAS Build（internal distribution） |

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

---

## ブリーフィング生成フロー

```
Google Gmail/Calendar API（当日受信 + メインタブのみ）
    ↓
googleDataService.fetchAll()
    ↓
memoryService.getContext(uid)    ← Firestoreから過去の記憶を読み込み（並行）
    ↓
claudeService.generateBriefing() ← Gemini 2.5 Flash で台本生成
    userContext（記憶）をプロンプトに注入
    ↓ JSON: chapters[]{dialogue[]{speaker,text}}
briefingService.generate()
    ↓
geminiTtsService.generateDialogueAudio()  ← Gemini 2.5 Flash TTS（マルチスピーカー）
    ↓ 失敗時フォールバック
googleTtsService.generateDialogueAudio()  ← Google Cloud TTS Neural2
    ↓
.wav ファイル（キャッシュ）→ expo-av で再生

[バックグラウンド・ノンブロッキング]
memoryService.extractAndSave(uid, googleData, existing)
    ← Geminiが今日のデータから記憶を抽出 → Firestore users/{uid}/memory/context に保存
```

---

## 主要サービス

### 台本生成 (`claudeService.ts`)
- モデル: `gemini-2.5-flash`（`thinkingBudget: 0`）
- 出力: 5章構成 JSON（opening / email / schedule / insights / closing）
- 各セリフ: 80〜120字（厳守）
- 目標文字数: 約1800字（6分想定、実際は5〜5.5分に収まる）
- MC: Aria（A・女性）/ Kai（B・男性）
- `userContext` があればプロンプトに注入（推定役職・頻繁な連絡先・最近のトピック・フォローアップ）

### 音声合成 (`geminiTtsService.ts`)
- モデル: `gemini-2.5-flash-preview-tts`
- 方式: 全対話を1回のAPIコールで生成（マルチスピーカー）
- 声: Aria → `Aoede`（明るい女性）/ Kai → `Puck`（男性）
- 出力: PCM 24kHz 16bit mono → WAV ヘッダー付加して保存
- フォールバック: `ja-JP-Neural2-B/C`（Google Cloud TTS）

### Gmail取得 (`googleDataService.ts`)
- フィルター: `after:YYYY/MM/DD category:primary`（**当日受信** + メインタブのみ）
- プロモーション・迷惑メール・ソーシャル・過去の未読は除外
- UIラベル: 「今日のメール」
- topEmails: 最大5件のSubject/Fromを取得

### ユーザー記憶 (`memoryService.ts`)
- Firestore パス: `users/{uid}/memory/context`
- 蓄積内容: `inferredRole` / `frequentContacts` / `recentTopics` / `pendingFollowups`
- 更新タイミング: ブリーフィング生成完了後にバックグラウンドで実行
- 初回は記憶なしで生成、翌日以降から反映される

### プレイヤー字幕 (`app/player.tsx`)
- 3スロット表示: 前のセリフ（opacity 28%）/ 現在（大・明）/ 次のセリフ（opacity 28%）
- セリフ切替時にフェードアニメーション（130ms out → 200ms in）
- タイミング: 文字数比率 × 実際の音声尺で推定
- ダークテーマ（`#0D1117` ベース）

---

## ローカル開発

```bash
# JS変更のみ（最速）
npx expo start
# → スマホのEAS dev clientアプリを開いてQRスキャン or URL入力

# ネイティブ変更がある場合
eas build --platform android --profile development
```

---

## デプロイ

```bash
# Webビルド → Vercel（vercel loginはWindowsユーザー名問題でtokenを使う）
npx expo export --platform web
vercel deploy dist --token <TOKEN> --yes

# Android APK（スタンドアロン・QRインストール）
eas build --platform android --profile preview
```

---

## 作業記録

### 2026-05-30
- **ブリーフィング5分化**: 実測3分55秒（1175字）→ 5〜6分に修正
  - closing章を2ターン → 4ターンに増量
  - 各セリフ指示を「60〜100字」→「80〜120字」に引き上げ
  - 全体目標を「1500字」→「1800字」に変更
- **TTS改善**: Google Cloud TTS Neural2（棒読み）→ Gemini 2.5 Flash TTS（マルチスピーカー）に切替
  - 全対話を1回のAPIコールで生成 → 自然な会話フロー実現
  - NotebookLMに近い品質を達成
- **Vercel デプロイ**
  - URL: https://polaris-omega-three.vercel.app
  - `vercel login` がWindowsユーザー名の日本語文字（ー）でクラッシュ → token直接渡しで回避

### 2026-05-31
- **Gmail フィルター**: 未読201件 → 当日受信のみ（`after:today category:primary`）に変更
  - UIラベルも「未読メール」→「今日のメール」に変更
- **プレイヤー字幕UI**: スクロールリスト表示 → 3スロット（前/現在/次）表示に変更
  - ダークテーマ、フェードアニメーション付き
  - セリフ切替はタイムスタンプ推定（文字数比率）
- **ユーザー記憶システム**: `memoryService.ts` を新規実装
  - Geminiがメール・カレンダーから役職・連絡先・トピック・フォローアップを抽出
  - Firestore `users/{uid}/memory/context` に蓄積
  - 翌日以降のブリーフィングプロンプトに自動注入
  - 初回は記憶なし → 毎日蓄積されて文脈が深まる設計

---

## 未完了タスク・TODO

### 動作確認が必要
- [ ] **記憶システムの動作確認**: Firestoreの `users/{uid}/memory/context` にデータが書き込まれているか確認（Firestoreコンソール: https://console.firebase.google.com/project/polaris-app-yukid/firestore）
- [ ] **Firestoreセキュリティルール**: `users/{uid}/memory/context` への書き込みが許可されているか確認・設定
- [ ] **字幕タイミング精度**: 文字数比率推定なので実際の音声と若干ズレる可能性あり → 体感確認

### 将来やること
- [ ] Vercel デプロイの自動化（GitHub Actions等）
- [ ] Firebase Storage / Auth の手動セットアップ
- [ ] 記憶内容をSettingsで確認・編集できるUI
- [ ] 字幕タイミングの精度向上（音声タイムスタンプAPIが使えれば）
- [ ] iOS版ビルド

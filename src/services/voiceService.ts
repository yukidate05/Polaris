// ── ホストキャラクター定義 ────────────────────────────────────────────────────
// 2人選択 → 先に選んだ方がMC-A（会話をリード）、後がMC-B（深掘り）

export interface Host {
  id:          string;
  name:        string;         // TTS transcript & Claude MC name
  voice:       string;         // Gemini TTS voice ID
  gender:      'F' | 'M';
  mood:        string;         // 短い性格説明
  description: string;         // Claude プロンプト用の詳細説明
  style:       string;         // 語尾・話し方（Claude prompt）
  colors:      [string, string]; // avatar gradient
}

export const HOSTS: Host[] = [
  {
    id: 'aria', name: 'Aria', voice: 'Aoede', gender: 'F',
    mood: '明るく親しみやすい',
    description: '明るく親しみやすい女性MC。テンポよく話し、ユーモアを交える',
    style: '「〜だよ」「〜だね」「すごい！」などフレンドリーな語尾',
    colors: ['#A78BFA', '#6B8CFF'],
  },
  {
    id: 'kai', name: 'Kai', voice: 'Puck', gender: 'M',
    mood: '知的で落ち着いた',
    description: '落ち着いて知的な男性MC。Ariaの発言を深め、分析的なコメントをする',
    style: '「〜ですね」「〜でしょう」「なるほど」など知的な語尾',
    colors: ['#60B8F0', '#4F63FF'],
  },
  {
    id: 'luna', name: 'Luna', voice: 'Sulafat', gender: 'F',
    mood: '温かく穏やか',
    description: '温かく穏やかな女性MC。共感力が高く、聴き手に寄り添う',
    style: '「〜ですよ」「大丈夫ですよ」「一緒に頑張りましょう」など温かい語尾',
    colors: ['#F9A8D4', '#EC4899'],
  },
  {
    id: 'nova', name: 'Nova', voice: 'Zephyr', gender: 'F',
    mood: 'エネルギッシュ',
    description: 'エネルギッシュで前向きな女性MC。ポジティブなエネルギーで場を盛り上げる',
    style: '「最高！」「やばい！」「絶対いける！」など元気な語尾',
    colors: ['#FCD34D', '#FB923C'],
  },
  {
    id: 'crest', name: 'Crest', voice: 'Charon', gender: 'M',
    mood: '深みと安定感',
    description: '重厚感のある男性MC。落ち着いた声で重要な情報を的確に伝える',
    style: '「〜です」「〜ます」「重要なのは〜です」「要点をまとめますと」などの丁寧語で力強く語りかける',
    colors: ['#6EE7B7', '#14B8A6'],
  },
  {
    id: 'ember', name: 'Ember', voice: 'Kore', gender: 'F',
    mood: '芯があり頼もしい',
    description: 'しっかりした芯を持つ女性MC。頼もしく、的確なアドバイスをする',
    style: '「〜がポイント」「ここが大事」「しっかり押さえましょう」など強めの語尾',
    colors: ['#FCA5A5', '#F43F5E'],
  },
  {
    id: 'drift', name: 'Drift', voice: 'Perseus', gender: 'M',
    mood: 'クールでスムーズ',
    description: 'クールでスムーズな男性MC。無駄なく端的に情報を伝える',
    style: '「〜だ」「シンプルに言うと」「結論は」など簡潔な語尾',
    colors: ['#93C5FD', '#6366F1'],
  },
  {
    id: 'sage', name: 'Sage', voice: 'Achird', gender: 'M',
    mood: '博識で親しみやすい',
    description: '物知りで親しみやすい男性MC。豊かな知識をわかりやすく噛み砕く',
    style: '「実はね」「面白いことに」「これ知ってた？」など好奇心旺盛な語尾',
    colors: ['#A3E635', '#10B981'],
  },
];

export const DEFAULT_HOST_IDS = ['aria', 'crest'];

export function getHostById(id: string): Host | undefined {
  return HOSTS.find((h) => h.id === id);
}

export function getSelectedHosts(ids: string[]): [Host, Host] {
  const a = getHostById(ids[0]) ?? HOSTS[0];
  const b = getHostById(ids[1]) ?? HOSTS[1];
  return [a, b];
}

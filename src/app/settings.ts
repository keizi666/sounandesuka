/** 設定（docs/11 §6、FR-42）。localStorage の hks.v1.settings に保存する */

export type QualitySetting = 'auto' | 'low' | 'mid' | 'high';
export type AutoPause = 'choice' | 'important' | 'all';
/**
 * 難しさ（ユーザーの指定。出発の前に選ぶ。神の視点のボタンの代わり）
 * - easy: 体の数値・天気がすべて見える。分岐で推奨の選択肢が緑になる。現在地が分からなくなってもぼかさない
 * - normal: 体の数値・天気がすべて見える。現在地が分からなくなったら、自分たちから 50 m より遠くをぼかす
 * - hard: 登山者に分かることだけ。体調はリーダーの分しか分からない。500 m より遠くはぼやけ、現在地が分からなくなったら強くぼかす
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  quality: QualitySetting;
  /** 自動判定した画質（quality が auto のとき使う） */
  detectedQuality: 'low' | 'mid' | 'high' | null;
  figureScale: number;
  vExag: number;
  autoPause: AutoPause;
  timed: boolean;
  observe: boolean;
  godViewDefault: boolean;
  difficulty: Difficulty;
  autoCamera: boolean;
  speechBubbles: boolean;
  thoughtBubbles: boolean;
  fictionalSpeech: boolean;
  textSize: 'small' | 'medium' | 'large';
  /** 箱庭らしい上下のぼかし（ミニチュア写真風） */
  tiltShift: boolean;
  /** 立体の雲（気象の計算）。重い環境では切る */
  clouds3d: boolean;
  /** 環境音（雨・風・雷） */
  sound: boolean;
  soundVolume: number;
  /** 効果音（電話・ヘリ・鼓動・知らせなど）と音楽 */
  se: boolean;
  seVolume: number;
  music: boolean;
  musicVolume: number;
  /** シナリオ中の曲: auto（場面に合わせてランダム）か、曲の ID（その曲を繰り返す） */
  musicTrack: string;
  /** 録画の品質（low 720p・mid 1080p・high 画面のまま 60fps） */
  recordQuality: 'low' | 'mid' | 'high';
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  detectedQuality: null,
  figureScale: 25,
  vExag: 1.0,
  autoPause: 'choice',
  timed: false,
  observe: false,
  godViewDefault: true,
  difficulty: 'normal',
  autoCamera: false,
  speechBubbles: true,
  thoughtBubbles: true,
  fictionalSpeech: true,
  textSize: 'medium',
  tiltShift: true,
  clouds3d: true,
  sound: false,
  soundVolume: 0.6,
  se: true,
  seVolume: 0.7,
  music: true,
  musicVolume: 0.3,
  musicTrack: 'auto',
  recordQuality: 'mid',
};

const KEY = 'hks.v1.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // 読めなければ既定値
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても動作は続ける
  }
  document.documentElement.dataset['textSize'] = s.textSize;
  for (const f of prefsListeners) f(s);
}

const prefsListeners: ((s: Settings) => void)[] = [];
/** 設定が保存されたときに呼ぶ（音量の反映など） */
export function onSettingsSaved(f: (s: Settings) => void): void {
  prefsListeners.push(f);
}

export function effectiveQuality(s: Settings): 'low' | 'mid' | 'high' {
  return s.quality === 'auto' ? (s.detectedQuality ?? 'mid') : s.quality;
}

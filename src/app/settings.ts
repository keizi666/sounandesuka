/** 設定（docs/11 §6、FR-42）。localStorage の hks.v1.settings に保存する */

export type QualitySetting = 'auto' | 'low' | 'mid' | 'high';
export type AutoPause = 'choice' | 'important' | 'all';

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
  autoCamera: boolean;
  speechBubbles: boolean;
  thoughtBubbles: boolean;
  fictionalSpeech: boolean;
  textSize: 'small' | 'medium' | 'large';
  /** 箱庭らしい上下のぼかし（ミニチュア写真風） */
  tiltShift: boolean;
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
  autoCamera: false,
  speechBubbles: true,
  thoughtBubbles: true,
  fictionalSpeech: true,
  textSize: 'medium',
  tiltShift: true,
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
}

export function effectiveQuality(s: Settings): 'low' | 'mid' | 'high' {
  return s.quality === 'auto' ? (s.detectedQuality ?? 'mid') : s.quality;
}

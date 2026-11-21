/**
 * 天候のタイムラインの行（変数）の定義と、画面の寸法・目印の型（Timeline.ts と timelineDraw.ts で共通）。
 */
import type { WeatherKeyframe } from '../../sim/types';

export interface RowDef {
  key: keyof WeatherKeyframe | 'cloud';
  label: string;
  min: number;
  max: number;
  log?: boolean;
  fmt: (v: number) => string;
  step: number;
}

export const ROWS: RowDef[] = [
  { key: 'tempC', label: '気温（基準）', min: -20, max: 30, fmt: (v) => `${v.toFixed(1)}℃`, step: 0.5 },
  { key: 'windMs', label: '風速', min: 0, max: 30, fmt: (v) => `${v.toFixed(1)} m/s`, step: 0.5 },
  { key: 'windDirDeg', label: '風向', min: 0, max: 360, fmt: (v) => `${Math.round(v)}°`, step: 5 },
  { key: 'precipMmH', label: '降水', min: 0, max: 20, fmt: (v) => `${v.toFixed(1)} mm/h`, step: 0.5 },
  { key: 'cloudCover', label: '雲量', min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%`, step: 0.05 },
  { key: 'cloudBaseM', label: '雲底', min: 500, max: 4500, fmt: (v) => `${Math.round(v)} m`, step: 50 },
  { key: 'visibilityM', label: '視程', min: 30, max: 40000, log: true, fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`), step: 1 },
  { key: 'thunder', label: '雷', min: 0, max: 1, fmt: (v) => v.toFixed(2), step: 0.05 },
  { key: 'pressureHpa', label: '気圧', min: 960, max: 1040, fmt: (v) => `${Math.round(v)} hPa`, step: 1 },
  { key: 'gustiness', label: '突風', min: 0, max: 1, fmt: (v) => v.toFixed(2), step: 0.05 },
];

export const LEFT = 104;
export const RIGHT = 10;
export const TOP = 24;
export const ROW_H = 36;
export const HIT_PX = 9;
/** 値のドラッグ: この距離（px）で目盛りの全幅 */
export const DRAG_FULL_PX = 150;

export interface TimelineMarks {
  sunrise: number[];
  sunset: number[];
  choices: { tMin: number; label: string }[];
  events: { tMin: number; label: string }[];
  /** 雲底の行に引く地点の標高 */
  nodeElevs: { name: string; elevM: number }[];
  cells: { id: string; from: number; peak: number; to: number }[];
}

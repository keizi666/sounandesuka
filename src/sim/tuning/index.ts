/**
 * 調整用の数値定数（CLAUDE.md 鉄則 4）。sim のコード中に魔法の数値を書かず、ここに集約する。
 * プレーンな JSON 互換の値だけを入れる。分野ごとのファイルに分け、ここでまとめる。
 */
import { capacity, movement, physiology } from './climber';
import { behavior, choices, endings } from './scenario';
import { derive, radio, terrain, trails } from './terrain';
import { ground, sun, weather } from './world';

export const TUNING = {
  sun,
  weather,
  ground,
  terrain,
  derive,
  trails,
  radio,
  movement,
  capacity,
  physiology,
  behavior,
  choices,
  endings,
};

export type Tuning = typeof TUNING;

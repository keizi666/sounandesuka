/**
 * 調整用の数値定数（CLAUDE.md 鉄則 4）。sim のコード中に魔法の数値を書かず、ここに集約する。
 * プレーンな JSON 互換の値だけを入れる。分野ごとのファイルに分け、ここでまとめる。
 */
import { capacity, illness, movement, physiology } from './climber';
import { devices, era, lightning, nav, rescue, slip, thoughts } from './hazards';
import { behavior, choices, endings } from './scenario';
import { derive, radio, terrain, trails } from './terrain';
import { ground, sun, weather } from './world';
import { animals } from './animals';
import { altitude } from './altitude';

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
  illness,
  behavior,
  choices,
  endings,
  nav,
  slip,
  lightning,
  devices,
  era,
  rescue,
  thoughts,
  animals,
  altitude,
};

export type Tuning = typeof TUNING;

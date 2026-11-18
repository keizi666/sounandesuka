/**
 * 描画の尺度（docs/10 §1）。シーン単位 = 1 m / 1000。鉛直誇張 vExag。台座の厚み plinth（m）。
 * y = (elevM − baseElevation + plinth) / 1000 × vExag。x・z はそのまま 1/1000。
 */
import type { MapRuntime } from '../sim/types';

export const UNIT = 1 / 1000;

export interface ViewScale {
  baseElevM: number;
  plinthM: number;
  vExag: number;
  half: number;
}

export function makeScale(map: MapRuntime, vExag = 1.0): ViewScale {
  return { baseElevM: map.def.terrain.baseElevation, plinthM: Math.max(120, map.def.size * 0.04), vExag, half: map.half };
}

export function toSceneY(s: ViewScale, elevM: number): number {
  return (elevM - s.baseElevM + s.plinthM) * UNIT * s.vExag;
}

export function fromSceneY(s: ViewScale, y: number): number {
  return y / (UNIT * s.vExag) - s.plinthM + s.baseElevM;
}

/** 台座の上面の y（地形の最低点の少し下） */
export function plinthTopY(s: ViewScale): number {
  return toSceneY(s, s.baseElevM - s.plinthM * 0.5);
}

/** 台座の底の y */
export const TABLE_Y = 0;

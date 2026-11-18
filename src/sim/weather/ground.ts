/**
 * 地面の状態（docs/05 §3）。標高 50 m 刻みのビンで持つ。更新は P3 で実装する。
 */
import type { GroundState } from '../types';

export const GROUND_BIN_M = 50;
export const GROUND_BINS = 61; // 0〜3,050 m

export function createGround(): GroundState {
  return {
    snowCm: new Array<number>(GROUND_BINS).fill(0),
    wet: new Array<number>(GROUND_BINS).fill(0),
    icy: new Array<number>(GROUND_BINS).fill(0),
  };
}

export function groundBin(elevM: number): number {
  const b = Math.floor(elevM / GROUND_BIN_M);
  return b < 0 ? 0 : b >= GROUND_BINS ? GROUND_BINS - 1 : b;
}

export function groundAt(g: GroundState, elevM: number): { snowCm: number; wet: number; icy: boolean } {
  const b = groundBin(elevM);
  return { snowCm: g.snowCm[b] ?? 0, wet: g.wet[b] ?? 0, icy: (g.icy[b] ?? 0) > 0.5 };
}

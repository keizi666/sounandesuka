/**
 * コースタイムとの比較（docs/16 §4.4）: 標準登山者が休まず歩いた場合の所要時間（Tobler × 道の等級、paceAdj = 1）と、
 * 入力されたコースタイムから paceAdj（0.6〜1.4）を提案する。
 */
import { toblerKmh } from '../sim/climber/movement';
import { TUNING } from '../sim/tuning';
import type { MapRuntime } from '../sim/types';

export function standardLegMin(map: MapRuntime, edgeId: string, dir: 1 | -1): number {
  const t = map.trails[edgeId];
  if (!t) return NaN;
  const s = dir === 1 ? t.samples : [...t.samples].reverse();
  const classF = TUNING.movement.classF[t.def.class];
  let min = 0;
  for (let i = 1; i < s.length; i += 1) {
    const ds = Math.abs(s[i]!.s - s[i - 1]!.s);
    const dh = Math.abs(s[i]!.sH - s[i - 1]!.sH) || ds;
    const grade = (s[i]!.elevM - s[i - 1]!.elevM) / Math.max(1, dh);
    const ms = (toblerKmh(grade) * classF) / 3.6;
    min += ds / Math.max(0.05, ms) / 60;
  }
  return min;
}

/** 試算 ÷ コースタイム を 0.6〜1.4 に丸める（速く歩かせたいなら 1 より大きい） */
export function suggestPaceAdj(simMin: number, courseMin: number): number {
  if (!(simMin > 0) || !(courseMin > 0)) return 1;
  return Math.round(Math.min(1.4, Math.max(0.6, simMin / courseMin)) * 100) / 100;
}

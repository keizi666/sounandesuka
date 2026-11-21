/**
 * スケルトンのノードごとに、名前の候補から既定の結び付けを作る（1 つの候補は 1 つのノードにだけ使う: 名前がいちばん近いノードが取る）。
 * ノードに位置の手がかり（x・z が 0 でない。AI 向けプロンプトで作ったバンドルの nodeLatLon から入る）があれば:
 * 名前の候補はその近く（HINT_MAX_M 以内）のものだけを近い順に使い、候補がなければ手がかりの位置そのものに置く
 * （結合のときに近くの登山道へ寄せる）。手がかりのないノード（収録のスケルトン）はこれまでどおり。
 */
import type { MapDef, NodeDef } from '../../sim/types';
import { toLatLon, toXZ } from './projection';
import { candidatesFor, normalizeName, type NamedPoint } from './skeleton';

/** 位置の手がかりから、名前の候補を探す範囲（m）。AI が書く緯度経度のずれを見込む */
export const HINT_MAX_M = 1000;

/** 位置の手がかりがあるか（スケルトンのノードは x・z が 0） */
export function hasPosHint(n: NodeDef): boolean {
  return n.x !== 0 || n.z !== 0;
}

function bestCandidate(n: NodeDef, points: readonly NamedPoint[], elevAt: (x: number, z: number) => number): NamedPoint | undefined {
  const cs = candidatesFor(n, points, elevAt);
  if (!hasPosHint(n)) return cs[0];
  const d = (p: NamedPoint): number => Math.hypot(p.x - n.x, p.z - n.z);
  return cs.filter((p) => d(p) <= HINT_MAX_M).sort((a, b) => d(a) - d(b))[0];
}

/**
 * スケルトンの範囲の中心を動かしたとき、位置の手がかり（中心からの x・z）を同じ緯度経度に保つ。
 * 結合の前（skeleton: true）だけ。結合した後の地点は地形とともに動く（これまでどおり）
 */
export function keepHintsOnRecenter(map: MapDef, oldLat: number, oldLon: number): void {
  const g = map.geo;
  if (!map.skeleton || !g || (g.centerLat === oldLat && g.centerLon === oldLon)) return;
  for (const n of map.nodes) {
    if (!hasPosHint(n)) continue;
    const q = toXZ(g.centerLat, g.centerLon, toLatLon(oldLat, oldLon, n.x, n.z));
    n.x = Math.round(q.x);
    n.z = Math.round(q.z);
  }
}

export function defaultBinding(skeleton: MapDef, points: readonly NamedPoint[], elevAt: (x: number, z: number) => number): Record<string, NamedPoint> {
  const want = skeleton.nodes.map((n) => ({ n, c: bestCandidate(n, points, elevAt) })).filter((x): x is { n: NodeDef; c: NamedPoint } => x.c !== undefined);
  // 名前の長さの差が小さい順に確定していく
  want.sort((a, b) => Math.abs(normalizeName(a.n.osmName ?? a.n.name).length - normalizeName(a.c.name).length) - Math.abs(normalizeName(b.n.osmName ?? b.n.name).length - normalizeName(b.c.name).length));
  const used = new Set<NamedPoint>();
  const out: Record<string, NamedPoint> = {};
  for (const w of want) {
    if (used.has(w.c)) continue;
    used.add(w.c);
    out[w.n.id] = w.c;
  }
  // 名前で決まらなかったノードは、位置の手がかりがあればそこに
  for (const n of skeleton.nodes) if (!out[n.id] && hasPosHint(n)) out[n.id] = { name: n.name, x: n.x, z: n.z, kind: 'hint' };
  return out;
}

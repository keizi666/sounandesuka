/**
 * スケルトンのノードごとに、名前の候補から既定の結び付けを作る（1 つの候補は 1 つのノードにだけ使う: 名前がいちばん近いノードが取る）。
 */
import type { MapDef } from '../../sim/types';
import { candidatesFor, normalizeName, type NamedPoint } from './skeleton';

export function defaultBinding(skeleton: MapDef, points: readonly NamedPoint[], elevAt: (x: number, z: number) => number): Record<string, NamedPoint> {
  const want = skeleton.nodes.map((n) => ({ n, c: candidatesFor(n, points, elevAt)[0] })).filter((x): x is { n: (typeof skeleton.nodes)[number]; c: NamedPoint } => x.c !== undefined);
  // 名前の長さの差が小さい順に確定していく
  want.sort((a, b) => Math.abs(normalizeName(a.n.osmName ?? a.n.name).length - normalizeName(a.c.name).length) - Math.abs(normalizeName(b.n.osmName ?? b.n.name).length - normalizeName(b.c.name).length));
  const used = new Set<NamedPoint>();
  const out: Record<string, NamedPoint> = {};
  for (const w of want) {
    if (used.has(w.c)) continue;
    used.add(w.c);
    out[w.n.id] = w.c;
  }
  return out;
}

/**
 * 格子上の A*（docs/03: GPS で道へ戻る、救助隊・電波探し・風下への移動）。
 * コスト = 距離 / 道外の速度係数（植生 × 傾斜）。崖は通れない。決定論的（同じコストは添字順）。
 */
import { DEG, dcos } from '../core/dmath';
import { TUNING, type Tuning } from '../tuning';
import { VegClass, type EdgeId, type MapRuntime } from '../types';
import { nearestIndex, vertexX, vertexZ } from './sample';

/** 道外の速度係数（植生 × 傾斜） */
export function offTrailFactor(map: MapRuntime, i: number, tuning: Tuning = TUNING): number {
  const veg = map.veg[i]!;
  const vs = tuning.movement.vegSpeed[veg] ?? 0.5;
  const c = dcos((map.slopeDeg[i]! * DEG));
  return vs * Math.max(tuning.movement.offTrailMinSlopeF, c * c);
}

const N8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

class Heap {
  k: number[] = [];
  v: number[] = [];
  get size(): number {
    return this.v.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! < key || (k[p] === key && v[p]! <= val)) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0]!;
    const lk = k.pop()!;
    const lv = v.pop()!;
    const n = v.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (k[r]! < k[l]! || (k[r] === k[l] && v[r]! < v[l]!)) ? r : l;
        if (lk < k[c]! || (lk === k[c] && lv <= v[c]!)) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/**
 * from から isGoal を満たす格子点までの経路（世界座標の点列、from 自身は含まない）。
 * maxCost を超えたら打ち切って null。
 */
export function findPath(
  map: MapRuntime,
  fromX: number,
  fromZ: number,
  isGoal: (i: number) => boolean,
  opts: { maxCost?: number; heuristicTo?: [number, number]; tuning?: Tuning } = {},
): [number, number][] | null {
  const tuning = opts.tuning ?? TUNING;
  const n = map.n;
  const start = nearestIndex(map, fromX, fromZ);
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  const maxCost = opts.maxCost ?? Infinity;
  const h = (i: number): number => {
    if (!opts.heuristicTo) return 0;
    const dx = vertexX(map, i % n) - opts.heuristicTo[0];
    const dz = vertexZ(map, Math.floor(i / n)) - opts.heuristicTo[1];
    return Math.sqrt(dx * dx + dz * dz); // 係数 1 が最速（藪なし・平坦）なので許容的
  };
  g.set(start, 0);
  heap.push(h(start), start);
  const closed = new Set<number>();
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (isGoal(cur)) {
      const out: [number, number][] = [];
      let c = cur;
      while (c !== start) {
        out.push([vertexX(map, c % n), vertexZ(map, Math.floor(c / n))]);
        c = prev.get(c)!;
      }
      return out.reverse();
    }
    const gc = g.get(cur)!;
    if (gc > maxCost) return null;
    const cx = cur % n;
    const cz = (cur - cx) / n;
    for (const [dx, dz] of N8) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      if (closed.has(j) || map.veg[j] === VegClass.CLIFF) continue;
      const f = offTrailFactor(map, j, tuning);
      if (f <= 0) continue;
      const step = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * map.cell;
      const ng = gc + step / f;
      if (ng < (g.get(j) ?? Infinity)) {
        g.set(j, ng);
        prev.set(j, cur);
        heap.push(ng + h(j), j);
      }
    }
  }
  return null;
}

export interface TrailCellRef {
  edgeId: EdgeId;
  s: number;
}

const trailCellCache = new WeakMap<MapRuntime, Map<number, TrailCellRef>>();

/** 正規の登山道が通る格子点 → その地点の（エッジ, s） */
export function trailCells(map: MapRuntime): Map<number, TrailCellRef> {
  let m = trailCellCache.get(map);
  if (!m) {
    m = new Map();
    for (const [id, t] of Object.entries(map.trails)) {
      if (t.def.kind !== 'trail') continue;
      for (const smp of t.samples) {
        const i = nearestIndex(map, smp.x, smp.z);
        if (!m.has(i)) m.set(i, { edgeId: id, s: smp.s });
      }
    }
    trailCellCache.set(map, m);
  }
  return m;
}

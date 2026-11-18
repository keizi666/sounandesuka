/**
 * 流量累積（docs/04 §4 flowAcc）。priority-flood（ε 付き）で窪地を埋めてから D8 で流向を決め、
 * 埋めた標高の高い順にセル数を下流へ足していく。外周が流出口。
 * 同じ標高はセルの添字で順序を決めるので結果は決定論的。
 */
import type { GridGeom } from './sample';

const D8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** (標高, 添字) の最小ヒープ */
class MinHeap {
  private keys: number[] = [];
  private ids: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(key: number, id: number): void {
    const keys = this.keys;
    const ids = this.ids;
    let i = ids.length;
    keys.push(key);
    ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(keys[p]!, ids[p]!, key, id)) break;
      keys[i] = keys[p]!;
      ids[i] = ids[p]!;
      i = p;
    }
    keys[i] = key;
    ids[i] = id;
  }
  pop(): number {
    const keys = this.keys;
    const ids = this.ids;
    const top = ids[0]!;
    const lastK = keys.pop()!;
    const lastI = ids.pop()!;
    const len = ids.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && less(keys[r]!, ids[r]!, keys[l]!, ids[l]!) ? r : l;
        if (less(lastK, lastI, keys[c]!, ids[c]!)) break;
        keys[i] = keys[c]!;
        ids[i] = ids[c]!;
        i = c;
      }
      keys[i] = lastK;
      ids[i] = lastI;
    }
    return top;
  }
}

function less(ka: number, ia: number, kb: number, ib: number): boolean {
  return ka < kb || (ka === kb && ia < ib);
}

/** 窪地を埋めた標高（Float64）。平坦部には ε の勾配を付けて必ず外周へ流れるようにする */
export function fillDepressions(g: GridGeom, heights: ArrayLike<number>, epsilon: number): Float64Array {
  const n = g.n;
  const filled = new Float64Array(n * n);
  const done = new Uint8Array(n * n);
  const heap = new MinHeap();
  for (let i = 0; i < n * n; i += 1) {
    const ix = i % n;
    const iz = (i - ix) / n;
    if (ix === 0 || iz === 0 || ix === n - 1 || iz === n - 1) {
      filled[i] = heights[i]!;
      done[i] = 1;
      heap.push(filled[i]!, i);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const cx = c % n;
    const cz = (c - cx) / n;
    for (const [dx, dz] of D8) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      if (done[j]) continue;
      done[j] = 1;
      filled[j] = Math.max(heights[j]!, filled[c]! + epsilon);
      heap.push(filled[j]!, j);
    }
  }
  return filled;
}

/** D8 の流量累積（自分自身を 1 として数えたセル数） */
export function flowAccumulation(g: GridGeom, heights: ArrayLike<number>, epsilon: number): Float32Array {
  const n = g.n;
  const filled = fillDepressions(g, heights, epsilon);
  const N = n * n;
  // 流向: 最急降下の隣接セル（外周・最低点は -1）
  const down = new Int32Array(N).fill(-1);
  const diagDist = Math.SQRT2;
  for (let i = 0; i < N; i += 1) {
    const ix = i % n;
    const iz = (i - ix) / n;
    let best = 0;
    let bestJ = -1;
    for (const [dx, dz] of D8) {
      const x = ix + dx;
      const z = iz + dz;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const j = z * n + x;
      const drop = (filled[i]! - filled[j]!) / (dx !== 0 && dz !== 0 ? diagDist : 1);
      if (drop > best) {
        best = drop;
        bestJ = j;
      }
    }
    down[i] = bestJ;
  }
  // 高い順に処理（同値は添字順）
  const order = new Int32Array(N);
  for (let i = 0; i < N; i += 1) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => filled[b]! - filled[a]! || a - b);
  const acc = new Float32Array(N).fill(1);
  for (const i of sorted) {
    const j = down[i]!;
    if (j >= 0) acc[j]! += acc[i]!;
  }
  return acc;
}

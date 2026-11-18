/**
 * スケルトンマップの結合（docs/16 §8）: 座標を持たない骨組みのマップ（地名・道のつながり・概略標高）を、実地形と OSM の登山道に結び付ける。
 * - 各ノードは、名前が合う OSM の地点を候補にする（部分一致、ひらがな・カタカナ同一視、候補が複数なら概略標高に近い順）。
 * - 候補のないノードは、両隣の結び付いたノードの間の登山道の上に、概略標高がいちばん合うように順に置く（作者が後で直す前提の下書き）。
 * - エッジは、両端の間を OSM の登山道グラフの最短経路でたどって折れ線にする。ID はスケルトンのものを保つ。
 * すべて純粋関数（Node でテストできる）。
 */
import type { EdgeDef, MapDef, NodeDef } from '../../sim/types';
import type { OsmJson } from './overpass';
import { toXZ } from './projection';

export interface NamedPoint {
  name: string;
  x: number;
  z: number;
  kind: string;
}

/** ひらがな・カタカナ・空白・括弧の違いを無視した名前 */
export function normalizeName(s: string): string {
  return [...s.normalize('NFKC')]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
    })
    .join('')
    .replace(/[\s　・()（）「」]/g, '')
    .toLowerCase();
}

/** OSM の応答から、名前のある地点（ノード・way の中心）を集める */
export function namedPoints(osm: OsmJson, lat0: number, lon0: number, size: number): NamedPoint[] {
  const out: NamedPoint[] = [];
  const half = size / 2;
  for (const e of osm.elements) {
    const name = e.tags?.['name:ja'] ?? e.tags?.['name'];
    if (!name) continue;
    let ll: { lat: number; lon: number } | null = null;
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) ll = { lat: e.lat, lon: e.lon };
    else if (e.geometry && e.geometry.length > 0 && !e.tags?.['highway']) {
      ll = e.geometry.reduce((a, g) => ({ lat: a.lat + g.lat / e.geometry!.length, lon: a.lon + g.lon / e.geometry!.length }), { lat: 0, lon: 0 });
    }
    if (!ll) continue;
    const p = toXZ(lat0, lon0, ll);
    if (Math.abs(p.x) > half || Math.abs(p.z) > half) continue;
    out.push({ name, x: p.x, z: p.z, kind: e.tags?.['natural'] ?? e.tags?.['tourism'] ?? e.tags?.['place'] ?? e.tags?.['amenity'] ?? e.type });
  }
  return out;
}

/** 名前が合う候補（概略標高に近い順） */
export function candidatesFor(node: NodeDef, points: readonly NamedPoint[], elevAt: (x: number, z: number) => number): NamedPoint[] {
  const key = normalizeName(node.osmName ?? node.name);
  if (!key) return [];
  const hit = points.filter((p) => {
    const n = normalizeName(p.name);
    return n.includes(key) || key.includes(n);
  });
  const exp = node.expectedElevM;
  // 完全一致を優先し、次に概略標高との差
  return hit.sort((a, b) => {
    const ea = normalizeName(a.name) === key ? 0 : 1;
    const eb = normalizeName(b.name) === key ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return exp === undefined ? 0 : Math.abs(elevAt(a.x, a.z) - exp) - Math.abs(elevAt(b.x, b.z) - exp);
  });
}

/** 登山道の頂点グラフ（10 m 間隔の頂点がそのままグラフの頂点） */
export interface VertexGraph {
  xs: number[];
  zs: number[];
  adj: number[][];
}

export function buildVertexGraph(nodes: readonly NodeDef[], edges: readonly EdgeDef[]): VertexGraph {
  const g: VertexGraph = { xs: [], zs: [], adj: [] };
  const nodeV = new Map<string, number>();
  const add = (x: number, z: number): number => {
    g.xs.push(x);
    g.zs.push(z);
    g.adj.push([]);
    return g.xs.length - 1;
  };
  const vOf = (id: string): number | null => {
    const hit = nodeV.get(id);
    if (hit !== undefined) return hit;
    const n = nodes.find((x) => x.id === id);
    if (!n) return null;
    const v = add(n.x, n.z);
    nodeV.set(id, v);
    return v;
  };
  for (const e of edges) {
    if (e.kind !== 'trail') continue;
    let prev = vOf(e.from);
    for (const w of e.waypoints) {
      const v = add(w[0], w[1]);
      if (prev !== null) {
        g.adj[prev]!.push(v);
        g.adj[v]!.push(prev);
      }
      prev = v;
    }
    const last = e.to ? vOf(e.to) : null;
    if (prev !== null && last !== null) {
      g.adj[prev]!.push(last);
      g.adj[last]!.push(prev);
    }
  }
  return g;
}

export function nearestVertex(g: VertexGraph, x: number, z: number): { v: number; distM: number } {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < g.xs.length; i += 1) {
    const d = (g.xs[i]! - x) * (g.xs[i]! - x) + (g.zs[i]! - z) * (g.zs[i]! - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { v: best, distM: Math.sqrt(bd) };
}

/** 最短経路（距離）。つながっていなければ null */
export function tracePath(g: VertexGraph, a: number, b: number): number[] | null {
  const n = g.xs.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // 二分ヒープ
  const heap: number[] = [a];
  dist[a] = 0;
  const up = (i: number): void => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[heap[p]!]! <= dist[heap[i]!]!) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const down = (i: number): void => {
    for (;;) {
      let m = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < heap.length && dist[heap[l]!]! < dist[heap[m]!]!) m = l;
      if (r < heap.length && dist[heap[r]!]! < dist[heap[m]!]!) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i]!, heap[m]!];
      i = m;
    }
  };
  while (heap.length > 0) {
    const u = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      down(0);
    }
    if (done[u]) continue;
    done[u] = 1;
    if (u === b) break;
    for (const v of g.adj[u]!) {
      const d = dist[u]! + Math.hypot(g.xs[v]! - g.xs[u]!, g.zs[v]! - g.zs[u]!);
      if (d < dist[v]!) {
        dist[v] = d;
        prev[v] = u;
        heap.push(v);
        up(heap.length - 1);
      }
    }
  }
  if (!Number.isFinite(dist[b]!)) return null;
  const path: number[] = [];
  for (let v = b; v !== -1; v = prev[v]!) path.push(v);
  return path.reverse();
}

export interface JoinResult {
  nodes: NodeDef[];
  edges: EdgeDef[];
  /** 名前で結び付いたノード */
  matched: string[];
  /** 登山道の上に補間で置いたノード（作者の確認が必要） */
  interpolated: string[];
  warnings: string[];
}

/**
 * スケルトンを結合する。bound は確定済みの位置（名前の候補から選んだもの・地図クリック）。
 * bound にないノードは、スケルトンの道のつながりで両隣にある確定済みノードの間に補間する。
 */
export function joinSkeleton(
  skeleton: MapDef,
  bound: Readonly<Record<string, { x: number; z: number }>>,
  g: VertexGraph,
  elevAt: (x: number, z: number) => number,
  opts: { snapM?: number; order?: readonly string[] } = {},
): JoinResult {
  const snapM = opts.snapM ?? 200;
  const order = opts.order;
  const warnings: string[] = [];
  const pos: Record<string, number> = {}; // ノード ID → グラフの頂点
  const matched: string[] = [];
  for (const n of skeleton.nodes) {
    const b = bound[n.id];
    if (!b) continue;
    const nv = nearestVertex(g, b.x, b.z);
    if (nv.v < 0 || nv.distM > snapM) {
      warnings.push(`${n.name}: 近くに登山道がありません（${Math.round(nv.distM)} m）`);
      continue;
    }
    pos[n.id] = nv.v;
    matched.push(n.id);
  }
  // 補間: 未確定ノードの鎖（スケルトンのエッジをたどる）を、両端の確定ノードの間の経路に置く
  const interpolated: string[] = [];
  const adj = new Map<string, string[]>();
  for (const e of skeleton.edges) {
    if (!e.to) continue;
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const elevOf = (v: number): number => elevAt(g.xs[v]!, g.zs[v]!);
  /** start と end（確定済み）の間の経路に、chain のノードを順番どおりに置く */
  const placeChain = (startId: string, chain: string[], endId: string): void => {
    const path = tracePath(g, pos[startId]!, pos[endId]!);
    if (!path || path.length < chain.length * 3 + 2) return;
    // 経路上の位置を、順番を保ったまま概略標高との差の合計が最小になるように選ぶ（動的計画法）
    const k = chain.length;
    const m = path.length;
    const cost = (i: number, j: number): number => {
      const exp = skeleton.nodes.find((x) => x.id === chain[i])?.expectedElevM;
      const even = Math.abs(j - ((i + 1) * m) / (k + 1)) / m; // 標高が同じなら等間隔に近い方
      return (exp === undefined ? 0 : Math.abs(elevOf(path[j]!) - exp)) + even * 30;
    };
    const INF = 1e18;
    const dp: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(INF));
    const from: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(-1));
    for (let j = 1; j < m - 1; j += 1) dp[0]![j] = cost(0, j);
    for (let i = 1; i < k; i += 1) {
      let best = INF;
      let bj = -1;
      for (let j = 1; j < m - 1; j += 1) {
        // 前のノードは 3 頂点（約 30 m）以上手前
        if (j - 3 >= 1 && dp[i - 1]![j - 3]! < best) {
          best = dp[i - 1]![j - 3]!;
          bj = j - 3;
        }
        if (bj >= 0) {
          dp[i]![j] = best + cost(i, j);
          from[i]![j] = bj;
        }
      }
    }
    let endJ = -1;
    let endC = INF;
    for (let j = 1; j < m - 1; j += 1)
      if (dp[k - 1]![j]! < endC) {
        endC = dp[k - 1]![j]!;
        endJ = j;
      }
    if (endJ < 0) return;
    for (let i = k - 1, j = endJ; i >= 0; i -= 1) {
      pos[chain[i]!] = path[j]!;
      interpolated.push(chain[i]!);
      j = from[i]![j]!;
    }
  };
  // 1) 計画ルートの順番があれば、それに沿って確定ノードの間を埋める
  if (order) {
    let lastBound: string | null = null;
    let run: string[] = [];
    for (const id of order) {
      if (pos[id] !== undefined) {
        if (lastBound !== null && run.length > 0) placeChain(lastBound, run, id);
        lastBound = id;
        run = [];
      } else if (!run.includes(id)) run.push(id);
    }
  }
  // 2) 残りは、スケルトンの道のつながりを一本道にたどって埋める
  for (const start of skeleton.nodes) {
    if (pos[start.id] === undefined) continue;
    for (const first of adj.get(start.id) ?? []) {
      if (pos[first] !== undefined) continue;
      const chain: string[] = [];
      let prev = start.id;
      let cur: string | undefined = first;
      while (cur !== undefined && pos[cur] === undefined) {
        chain.push(cur);
        const next: string | undefined = (adj.get(cur) ?? []).find((x) => x !== prev && !chain.includes(x));
        prev = cur;
        cur = next;
      }
      if (cur === undefined) continue;
      placeChain(start.id, chain, cur);
    }
  }
  const nodes: NodeDef[] = [];
  for (const n of skeleton.nodes) {
    const v = pos[n.id];
    if (v === undefined) {
      warnings.push(`${n.name}: 位置が決まりませんでした（地図をクリックして置いてください）`);
      continue;
    }
    nodes.push({ ...n, x: Math.round(g.xs[v]! * 10) / 10, z: Math.round(g.zs[v]! * 10) / 10, snap: false });
  }
  const edges: EdgeDef[] = [];
  for (const e of skeleton.edges) {
    const a = pos[e.from];
    const b = e.to ? pos[e.to] : undefined;
    if (a === undefined || b === undefined) {
      warnings.push(`道 ${e.name}: 端の位置が決まっていません`);
      continue;
    }
    const path = tracePath(g, a, b);
    if (!path) {
      warnings.push(`道 ${e.name}: 登山道がつながっていません`);
      continue;
    }
    edges.push({ ...e, smooth: false, sinuosity: 1, waypoints: path.slice(1, -1).map((v) => [Math.round(g.xs[v]! * 10) / 10, Math.round(g.zs[v]! * 10) / 10] as [number, number]) });
  }
  return { nodes, edges, matched, interpolated: [...new Set(interpolated)], warnings };
}

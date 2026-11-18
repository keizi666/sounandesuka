/**
 * OpenStreetMap（Overpass API）からの登山道・地点の取り込み（docs/16 §4.1）。
 * 1 エリアにつき 1 回だけ問い合わせ、応答は raw.osm に保存して再取得しない。変換 osmToGraph は Node でテストできる純粋関数。
 */
import type { EdgeDef, HazardDef, NodeDef, NodeType, TrailClass } from '../../sim/types';
import { bboxOf, toXZ } from './projection';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
}
export interface OsmJson {
  elements: OsmElement[];
}

export function overpassQuery(lat0: number, lon0: number, size: number): string {
  const b = bboxOf(lat0, lon0, size);
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:60];
(
  way["highway"~"^(path|footway|track|steps|bridleway)$"](${bb});
  node["natural"="peak"](${bb});
  node["natural"="saddle"](${bb});
  node["tourism"~"^(alpine_hut|wilderness_hut)$"](${bb});
  way["tourism"~"^(alpine_hut|wilderness_hut)$"](${bb});
  node["amenity"="shelter"](${bb});
  node["waterway"="waterfall"](${bb});
  node["information"="guidepost"](${bb});
  node["highway"="trailhead"](${bb});
);
out geom tags;`;
}

export async function fetchOsm(lat0: number, lon0: number, size: number): Promise<OsmJson> {
  const res = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(lat0, lon0, size) }) });
  if (res.status === 429) throw new Error('Overpass API が混雑しています（429）。しばらくしてからやり直してください。');
  if (!res.ok) throw new Error(`OpenStreetMap のデータを取得できませんでした（${res.status}）`);
  return (await res.json()) as OsmJson;
}

export interface GraphResult {
  nodes: NodeDef[];
  edges: EdgeDef[];
  hazards: HazardDef[];
  /** 取り込み直後は下書き（作者が確定する） */
  draftEdgeIds: string[];
  warnings: string[];
}

const NAME = (t: Record<string, string> | undefined): string => t?.['name:ja'] ?? t?.['name'] ?? '';

function pointType(t: Record<string, string>): { type: NodeType; shelter?: NodeDef['shelter'] } | 'waterfall' | null {
  if (t['natural'] === 'peak') return { type: 'peak' };
  if (t['natural'] === 'saddle') return { type: 'saddle' };
  if (t['tourism'] === 'alpine_hut') return { type: 'hut', shelter: { kind: 'staffed', open: true } };
  if (t['tourism'] === 'wilderness_hut' || t['amenity'] === 'shelter') return { type: 'shelter', shelter: { kind: 'emergency', open: true } };
  if (t['highway'] === 'trailhead') return { type: 'trailhead' };
  if (t['information'] === 'guidepost') return { type: 'landmark' };
  if (t['waterway'] === 'waterfall') return 'waterfall';
  return null;
}

/** OSM タグから class・markers・drift・kind（docs/16 §4.1 の表） */
export function trailAttrs(t: Record<string, string>, meanSlopeDeg: number): { cls: TrailClass; markers: number; drift: number; kind: 'trail' | 'false' } {
  let cls: TrailClass;
  const sac = t['sac_scale'];
  if (t['highway'] === 'track') cls = 'T1';
  else if (sac === 'hiking') cls = 'T1';
  else if (sac === 'mountain_hiking') cls = 'T2';
  else if (sac) cls = 'T3';
  else cls = meanSlopeDeg < 15 ? 'T1' : meanSlopeDeg < 25 ? 'T2' : 'T3';
  let markers = t['highway'] === 'track' ? 0.8 : 0.6;
  let drift = 0.02;
  const vis = t['trail_visibility'];
  if (vis === 'excellent') markers = 0.9;
  else if (vis === 'good') markers = 0.75;
  else if (vis === 'intermediate') {
    markers = 0.5;
    drift = 0.03;
  } else if (vis === 'bad' || vis === 'horrible' || vis === 'no') {
    markers = 0.2;
    drift = 0.06;
  }
  const abandoned = Object.keys(t).some((k) => /^(abandoned|disused)(:|$)/.test(k)) || t['highway'] === 'abandoned';
  return { cls, markers, drift, kind: abandoned ? 'false' : 'trail' };
}

/**
 * OSM の応答 → 箱庭のグラフ。共有ノード・端点・地点から 25 m 以内の点を分岐点にし、そこで way を分割する。
 * エリアの外は境界で切り、境界上に登山口の候補を置く。頂点は 10 m 間隔に間引く。smooth: false、sinuosity 1.0。
 */
export function osmToGraph(osm: OsmJson, lat0: number, lon0: number, size: number, elevAt: (x: number, z: number) => number): GraphResult {
  const half = size / 2;
  const inside = (p: { x: number; z: number }): boolean => Math.abs(p.x) <= half && Math.abs(p.z) <= half;
  const warnings: string[] = [];
  const nodes: NodeDef[] = [];
  const hazards: HazardDef[] = [];
  // 地点
  for (const e of osm.elements) {
    if (e.type !== 'node' || !e.tags || e.lat === undefined || e.lon === undefined) continue;
    const pt = pointType(e.tags);
    if (!pt) continue;
    const p = toXZ(lat0, lon0, { lat: e.lat, lon: e.lon });
    if (!inside(p)) continue;
    if (pt === 'waterfall') {
      hazards.push({ id: `WF${hazards.length + 1}`, type: 'waterfall', name: NAME(e.tags) || '滝', x: p.x, z: p.z, radius: 40 });
      continue;
    }
    nodes.push({ id: '', name: NAME(e.tags) || '', type: pt.type, x: p.x, z: p.z, shelter: pt.shelter, snap: false, source: 'osm', osmId: `n${e.id}` });
  }
  // 小屋の way は中心を地点に
  for (const e of osm.elements) {
    if (e.type !== 'way' || !e.tags || !e.geometry || !/hut$/.test(e.tags['tourism'] ?? '')) continue;
    const c = e.geometry.reduce((a, g) => ({ lat: a.lat + g.lat / e.geometry!.length, lon: a.lon + g.lon / e.geometry!.length }), { lat: 0, lon: 0 });
    const p = toXZ(lat0, lon0, c);
    if (!inside(p)) continue;
    const pt = pointType(e.tags);
    if (pt && pt !== 'waterfall') nodes.push({ id: '', name: NAME(e.tags), type: pt.type, x: p.x, z: p.z, shelter: pt.shelter, snap: false, source: 'osm', osmId: `w${e.id}` });
  }
  // 道: OSM ノード ID ごとの出現回数（共有点の検出）
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry && e.nodes && /^(path|footway|track|steps|bridleway)$/.test(e.tags?.['highway'] ?? ''));
  const count = new Map<number, number>();
  for (const w of ways) w.nodes!.forEach((id, i) => count.set(id, (count.get(id) ?? 0) + (i === 0 || i === w.nodes!.length - 1 ? 2 : 1)));
  // 分岐点（OSM ノード ID → 箱庭ノード）
  const junction = new Map<number, NodeDef>();
  const nodeFor = (osmId: number, p: { x: number; z: number }, onBorder: boolean): NodeDef => {
    let nd = junction.get(osmId);
    if (nd) return nd;
    // 取り込んだ地点から 25 m 以内ならその地点
    const near = nodes.find((x) => Math.hypot(x.x - p.x, x.z - p.z) < 25);
    nd = near ?? { id: '', name: onBorder ? '登山口（境界）' : '', type: onBorder ? 'trailhead' : 'junction', x: p.x, z: p.z, snap: false, source: 'osm', osmId: `n${osmId}` };
    if (!near) nodes.push(nd);
    junction.set(osmId, nd);
    return nd;
  };
  const edges: EdgeDef[] = [];
  let borderSeq = -1;
  for (const w of ways) {
    const pts = w.geometry!.map((g, i) => ({ ...toXZ(lat0, lon0, g), id: w.nodes![i]! }));
    // エリア内の連続区間に分ける（境界で切る）
    const runs: { x: number; z: number; id: number; border?: boolean }[][] = [];
    let cur: { x: number; z: number; id: number; border?: boolean }[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!;
      const prev = pts[i - 1];
      if (inside(p)) {
        if (cur.length === 0 && prev && !inside(prev)) cur.push({ ...clipToBox(prev, p, half), id: borderSeq--, border: true });
        cur.push(p);
      } else if (cur.length > 0) {
        cur.push({ ...clipToBox(pts[i - 1]!, p, half), id: borderSeq--, border: true });
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) runs.push(cur);
    for (const run of runs) {
      if (run.length < 2) continue;
      // 分割点: 端点・共有点・地点から 25 m 以内
      let start = 0;
      for (let i = 1; i < run.length; i += 1) {
        const p = run[i]!;
        const isEnd = i === run.length - 1;
        const shared = (count.get(p.id) ?? 0) > 1;
        const nearPoint = nodes.some((x) => x.type !== 'junction' && x.type !== 'trailhead' && Math.hypot(x.x - p.x, x.z - p.z) < 25);
        if (!isEnd && !shared && !nearPoint) continue;
        const seg = run.slice(start, i + 1);
        const a = nodeFor(seg[0]!.id, seg[0]!, Boolean(seg[0]!.border));
        const b = nodeFor(p.id, p, Boolean(p.border));
        if (a !== b) {
          const slope = meanSlope(seg, elevAt);
          const at = trailAttrs(w.tags ?? {}, slope);
          edges.push({
            id: '',
            name: NAME(w.tags),
            kind: at.kind,
            from: a.id,
            to: b.id,
            class: at.cls,
            markers: at.markers,
            drift: at.drift,
            sinuosity: 1.0,
            smooth: false,
            source: 'osm',
            osmIds: [`w${w.id}`],
            waypoints: resample(seg, 10).slice(1, -1).map((q) => [round1(q.x), round1(q.z)] as [number, number]),
            // 作業用: 端点ノードの参照（ID 付けの後に置き換える）
            ...({ _a: a, _b: b } as object),
          });
        }
        start = i;
      }
    }
  }
  // ID を振る（地点は種類ごと、道は E001…）
  const seq: Record<string, number> = {};
  const prefix: Record<NodeType, string> = { trailhead: 'TH', junction: 'J', peak: 'PK', saddle: 'SD', hut: 'HUT', shelter: 'SH', landmark: 'LM' };
  const used = new Set<NodeDef>();
  for (const e of edges) {
    used.add((e as unknown as { _a: NodeDef })._a);
    used.add((e as unknown as { _b: NodeDef })._b);
  }
  const keep = nodes.filter((n) => used.has(n) || n.type !== 'junction');
  for (const n of keep) {
    const p = prefix[n.type];
    seq[p] = (seq[p] ?? 0) + 1;
    n.id = `${p}${String(seq[p]).padStart(3, '0')}`;
    if (!n.name) n.name = n.id;
  }
  edges.forEach((e, i) => {
    const x = e as unknown as { _a: NodeDef; _b: NodeDef };
    e.id = `E${String(i + 1).padStart(3, '0')}`;
    e.from = x._a.id;
    e.to = x._b.id;
    if (!e.name) e.name = `${x._a.name}〜${x._b.name}`;
    if (e.kind === 'false') {
      // 廃道は行き止まりの偽の道として扱う（作者が確認する）
      const pts = [[x._a.x, x._a.z], ...e.waypoints, [x._b.x, x._b.z]] as [number, number][];
      let len = 0;
      for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      e.waypoints = pts.slice(1);
      delete e.to;
      e.fadeOutM = Math.round(len);
      e.attractiveness = 0.5;
    }
    delete (e as unknown as Record<string, unknown>)['_a'];
    delete (e as unknown as Record<string, unknown>)['_b'];
  });
  if (edges.length === 0) warnings.push('エリア内に登山道が見つかりませんでした');
  return { nodes: keep, edges, hazards, draftEdgeIds: edges.map((e) => e.id), warnings };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** 線分 a（内）→ b（外）が箱の境界と交わる点 */
function clipToBox(a: { x: number; z: number }, b: { x: number; z: number }, half: number): { x: number; z: number } {
  let t = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx !== 0) t = Math.min(t, Math.max(0, ((dx > 0 ? half : -half) - a.x) / dx));
  if (dz !== 0) t = Math.min(t, Math.max(0, ((dz > 0 ? half : -half) - a.z) / dz));
  // 外の点から内へ（a が外）の場合にも使えるよう、近い方の交点を返す
  const ins = (p: { x: number; z: number }): boolean => Math.abs(p.x) <= half + 1e-6 && Math.abs(p.z) <= half + 1e-6;
  const p = { x: a.x + dx * t, z: a.z + dz * t };
  if (ins(p)) return p;
  return clipToBox(b, a, half);
}

function meanSlope(seg: { x: number; z: number }[], elevAt: (x: number, z: number) => number): number {
  let h = 0;
  let v = 0;
  for (let i = 1; i < seg.length; i += 1) {
    h += Math.hypot(seg[i]!.x - seg[i - 1]!.x, seg[i]!.z - seg[i - 1]!.z);
    v += Math.abs(elevAt(seg[i]!.x, seg[i]!.z) - elevAt(seg[i - 1]!.x, seg[i - 1]!.z));
  }
  return h > 0 ? (Math.atan(v / h) * 180) / Math.PI : 0;
}

/** 折れ線を一定間隔で再サンプル（端点は保つ） */
export function resample(pts: readonly { x: number; z: number }[], stepM: number): { x: number; z: number }[] {
  if (pts.length < 2) return [...pts];
  const out = [{ x: pts[0]!.x, z: pts[0]!.z }];
  let carry = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = stepM - carry;
    while (d < len) {
      out.push({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len });
      d += stepM;
    }
    carry = len - (d - stepM);
  }
  const last = pts[pts.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(tail.x - last.x, tail.z - last.z) < stepM * 0.3 && out.length > 1) out.pop();
  out.push({ x: last.x, z: last.z });
  return out;
}

/** 紛らわしい分岐の自動提案（docs/16 §4.5） */
export function suggestConfusers(nodes: NodeDef[], edges: EdgeDef[]): number {
  let n = 0;
  for (const nd of nodes) {
    const out = edges.filter((e) => e.from === nd.id || e.to === nd.id);
    if (out.length < 3 && !out.some((e) => e.kind === 'false')) continue;
    const dir = (e: EdgeDef): number => {
      const pts = e.from === nd.id ? e.waypoints : [...e.waypoints].reverse();
      const p = pts[Math.min(2, pts.length - 1)];
      const far = p ?? (() => {
        const other = nodes.find((x) => x.id === (e.from === nd.id ? e.to : e.from));
        return other ? ([other.x, other.z] as [number, number]) : ([nd.x + 1, nd.z] as [number, number]);
      })();
      return Math.atan2(far[0] - nd.x, -(far[1] - nd.z));
    };
    const conf: NonNullable<NodeDef['confusers']> = [];
    for (const wrong of out) {
      const intending: string[] = [];
      let amb = 0;
      for (const right of out) {
        if (right === wrong || right.kind === 'false') continue;
        let d = Math.abs(dir(right) - dir(wrong)) * (180 / Math.PI);
        if (d > 180) d = 360 - d;
        const weak = wrong.kind === 'false' || wrong.markers <= 0.3;
        if (d < 40 || weak) {
          intending.push(right.id);
          amb = Math.max(amb, 0.15 + 0.4 * Math.max(0, 1 - d / 40) + (wrong.kind === 'false' ? 0.2 : 0));
        }
      }
      if (intending.length > 0) conf.push({ edge: wrong.id, whenIntending: intending, ambiguity: Math.round(Math.min(0.9, amb) * 100) / 100 });
    }
    if (conf.length > 0) {
      nd.confusers = conf;
      n += conf.length;
    }
  }
  return n;
}

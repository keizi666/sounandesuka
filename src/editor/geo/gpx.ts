/**
 * GPX の取り込み（docs/16 §4.2）。<trkpt>・<rtept>・<wpt> を読む。
 * DOMParser のない Node でもテストできるよう、要素と属性だけを読む小さな解析にしている。
 */
import type { EdgeDef, MapRuntime, NodeDef } from '../../sim/types';
import { shortestPath } from '../../sim/terrain/trails';
import { toXZ } from './projection';
import { resample } from './overpass';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
}
export interface GpxData {
  tracks: { name: string; points: GpxPoint[] }[];
  waypoints: (GpxPoint & { name: string })[];
}

// 正規表現は String.raw で組み立てる（テンプレート文字列の \s が s になるのを避ける）
const attr = (tag: string, name: string): number => Number(new RegExp(name + String.raw`\s*=\s*["']([^"']+)["']`).exec(tag)?.[1] ?? NaN);
const inner = (body: string, name: string): string | null => new RegExp(`<${name}[^>]*>` + String.raw`([\s\S]*?)` + `</${name}>`).exec(body)?.[1]?.trim() ?? null;
const unescape = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function points(xml: string, tag: string): GpxPoint[] {
  const out: GpxPoint[] = [];
  const re = new RegExp(`<${tag}` + String.raw`\b([^>]*?)(?:/>|>([\s\S]*?)` + `</${tag}>)`, 'g');
  for (const m of xml.matchAll(re)) {
    const lat = attr(m[1]!, 'lat');
    const lon = attr(m[1]!, 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = m[2] ? Number(inner(m[2], 'ele')) : NaN;
    out.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return out;
}

export function parseGpx(xml: string): GpxData {
  if (!/<gpx[\s>]/.test(xml)) throw new Error('GPX ではありません');
  const tracks: GpxData['tracks'] = [];
  for (const m of xml.matchAll(/<(trk|rte)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const body = m[2]!;
    const name = unescape(inner(body.replace(/<(trkseg|rtept)[\s\S]*/, ''), 'name') ?? '');
    if (m[1] === 'rte') {
      const pts = points(body, 'rtept');
      if (pts.length >= 2) tracks.push({ name, points: pts });
      continue;
    }
    // トラックはセグメント（<trkseg>）ごとに別の軌跡にする（切れ目を直線でつながない。ユーザーの指摘: 最初のセグメントしか読まれなかった）
    const segs = [...body.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)].map((s) => points(s[1]!, 'trkpt')).filter((p) => p.length >= 2);
    if (segs.length === 0) {
      const pts = points(body, 'trkpt');
      if (pts.length >= 2) tracks.push({ name, points: pts });
    }
    segs.forEach((pts, i) => tracks.push({ name: segs.length > 1 ? `${name || '軌跡'}（${i + 1}）` : name, points: pts }));
  }
  const waypoints: GpxData['waypoints'] = [];
  for (const m of xml.matchAll(/<wpt\b([^>]*?)>([\s\S]*?)<\/wpt>/g)) {
    const lat = attr(m[1]!, 'lat');
    const lon = attr(m[1]!, 'lon');
    const ele = Number(inner(m[2]!, 'ele'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) waypoints.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null, name: unescape(inner(m[2]!, 'name') ?? '') });
  }
  return { tracks, waypoints };
}

/** 軌跡を箱庭座標の折れ線へ（エリア外の点は落とす）、10 m 間隔に再サンプル */
export function trackToXZ(points: GpxPoint[], lat0: number, lon0: number, size: number): { x: number; z: number }[] {
  const half = size / 2;
  const xz = points.map((p) => toXZ(lat0, lon0, p)).filter((p) => Math.abs(p.x) <= half && Math.abs(p.z) <= half);
  return resample(xz, 10);
}

function nearestNode(nodes: readonly NodeDef[], p: { x: number; z: number }, maxM: number): NodeDef | null {
  let best: NodeDef | null = null;
  let bd = maxM;
  for (const n of nodes) {
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/**
 * 「登山道として追加」: 既存の道から 15 m 以内の部分は既存を優先し、離れている区間だけを新しいエッジにする。
 * 区間の端は既存ノード（20 m 以内）か新しい分岐ノード。
 */
export function trackAsTrails(track: { x: number; z: number }[], existing: { nodes: NodeDef[]; edges: EdgeDef[] }, nextId: (p: string) => string): { nodes: NodeDef[]; edges: EdgeDef[] } {
  const segs = existing.edges.flatMap((e) => {
    const a = existing.nodes.find((n) => n.id === e.from);
    const b = existing.nodes.find((n) => n.id === e.to);
    return [...(a ? [[a.x, a.z]] : []), ...e.waypoints, ...(b ? [[b.x, b.z]] : [])] as [number, number][];
  });
  const near = (p: { x: number; z: number }): boolean => segs.some((q) => Math.hypot(q[0] - p.x, q[1] - p.z) < 15);
  const nodes: NodeDef[] = [];
  const edges: EdgeDef[] = [];
  let run: { x: number; z: number }[] = [];
  const all = (): NodeDef[] => [...existing.nodes, ...nodes];
  const endNode = (p: { x: number; z: number }): NodeDef => {
    const n = nearestNode(all(), p, 20);
    if (n) return n;
    const nd: NodeDef = { id: nextId('J'), name: '', type: 'junction', x: p.x, z: p.z, snap: false, source: 'gpx' };
    nd.name = nd.id;
    nodes.push(nd);
    return nd;
  };
  const flush = (): void => {
    if (run.length >= 3) {
      const a = endNode(run[0]!);
      const b = endNode(run[run.length - 1]!);
      if (a !== b)
        edges.push({ id: nextId('E'), name: `${a.name}〜${b.name}`, kind: 'trail', from: a.id, to: b.id, class: 'T2', markers: 0.6, drift: 0.02, sinuosity: 1, smooth: false, source: 'gpx', waypoints: run.slice(1, -1).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]) });
    }
    run = [];
  };
  for (const p of track) {
    if (near(p)) {
      if (run.length > 0) {
        run.push(p);
        flush();
      }
    } else {
      if (run.length === 0 && track.indexOf(p) > 0) run.push(track[track.indexOf(p) - 1]!);
      run.push(p);
    }
  }
  flush();
  return { nodes, edges };
}

/** 「計画ルートとして使う」: 軌跡の近くのノードを順に拾い、隣接していなければ最短経路で補う（マップマッチング） */
export function trackToRoute(track: { x: number; z: number }[], map: MapRuntime): string[] {
  const nodes = Object.values(map.nodes);
  const seq: string[] = [];
  for (const p of track) {
    const n = nearestNode(nodes, p, 40);
    if (n && seq[seq.length - 1] !== n.id) seq.push(n.id);
  }
  const out: string[] = [];
  for (const id of seq) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(id);
      continue;
    }
    const path = shortestPath(map, prev, id);
    if (path) out.push(...path.slice(1));
  }
  return out;
}

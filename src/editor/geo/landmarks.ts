/**
 * 地理院の最適化ベクトルタイル（z16）の地図記号から、施設（寺・神社・駅・交番など）と送電線を取り込み、送電線の上に鉄塔を置く。
 * - 地図記号は注記の層 Anno の点（vt_code）。名前は近くの施設名の注記（8xx）から。駅は線路の「駅部分」と駅名（422）から
 * - 送電線は層 PwrTrnsmL の線。タイルの境目で切れた線はつなぐ
 * - 鉄塔は送電線に沿って、間隔 TOWER_MIN_M〜TOWER_MAX_M の中でいちばん高い所（尾根）に置く（実際の鉄塔は尾根に立つことが多い）
 * 変換は Node でテストできる純粋関数。タイルの取得は gsiVector.ts。
 */
import type { LandmarkDef, LandmarkKind, MapRuntime, PowerLineDef } from '../../sim/types';
import type { VectorTile } from './gsiVector';
import { decodeMvtFeatures } from './mvt';
import { toXZ } from './projection';
import { tileToLonLat } from './tiles';
import { GSI_VECTOR_ZOOM } from './vegsym';

/** 地図記号の vt_code → 施設の種類（町の中のタイルで、名前の注記と照らし合わせて確かめた番号を含む） */
export const SYMBOL_KIND: Record<number, LandmarkKind> = {
  3201: 'office', 3202: 'office', 3203: 'office', 3204: 'office', 3205: 'office', 3206: 'office',
  3211: 'police', 3241: 'police',
  3212: 'school', 3213: 'school', 3214: 'school',
  3215: 'care',
  3217: 'library',
  3218: 'post',
  3231: 'shrine',
  3232: 'temple',
  3242: 'fire',
  3243: 'hospital',
};

export const LANDMARK_LABELS: Record<LandmarkKind, string> = {
  temple: '寺院', shrine: '神社', station: '駅', police: '交番・警察署', school: '学校', post: '郵便局', hospital: '病院',
  fire: '消防署', office: '役所', care: '老人ホーム', library: '図書館', tower: '送電線の鉄塔',
};

/** 2D の地図の記号（地形図に近い字） */
export const LANDMARK_GLYPH: Record<LandmarkKind, string> = {
  temple: '卍', shrine: '⛩', station: '駅', police: '×', school: '文', post: '〒', hospital: '✚', fire: 'Y', office: '◎', care: '⌂', library: '本', tower: '⚡',
};

/** 鉄塔の間隔（m）。山の送電線の径間はおおむね 200〜600 m（谷をまたぐ所は長い） */
export const TOWER_MIN_M = 200;
export const TOWER_MAX_M = 600;

const r1 = (v: number): number => Math.round(v * 10) / 10;

interface Label { x: number; z: number; code: number; text: string }

/** タイルから施設と送電線（鉄塔は placeTowers で置く） */
export function landmarksFromTiles(tiles: readonly VectorTile[], lat0: number, lon0: number, sizeM: number): { landmarks: LandmarkDef[]; powerLines: PowerLineDef[] } {
  const half = sizeM / 2;
  const items: Omit<LandmarkDef, 'id'>[] = [];
  const labels: Label[] = [];
  const stations: { x: number; z: number; deg: number }[] = [];
  const parts: [number, number][][] = [];
  for (const t of tiles) {
    if (!t.buf) continue;
    const xz = (p: [number, number], extent: number): { x: number; z: number } => toXZ(lat0, lon0, tileToLonLat(t.x + p[0] / extent, t.y + p[1] / extent, GSI_VECTOR_ZOOM));
    for (const f of decodeMvtFeatures(t.buf, ['Anno', 'RailCL', 'PwrTrnsmL'])) {
      const code = Number(f.props['vt_code']);
      if (f.layer === 'Anno' && f.type === 1) {
        const p = f.parts[0]?.[0];
        if (!p) continue;
        const q = xz(p, f.extent);
        const text = f.props['vt_text'];
        if (typeof text === 'string' && text) labels.push({ ...q, code, text });
        else if (SYMBOL_KIND[code] && Math.abs(q.x) < half && Math.abs(q.z) < half) items.push({ kind: SYMBOL_KIND[code]!, x: r1(q.x), z: r1(q.z) });
      } else if (f.layer === 'RailCL' && f.type === 2 && String(f.props['vt_sngldbl'] ?? '').includes('駅')) {
        for (const part of f.parts) {
          if (part.length < 2) continue;
          const a = xz(part[0]!, f.extent);
          const b = xz(part[part.length - 1]!, f.extent);
          stations.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, deg: (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI });
        }
      } else if (f.layer === 'PwrTrnsmL' && f.type === 2) {
        // タイルの「のりしろ」（隣のタイルと重なる外側）を切り落としてから使う（境目で端点がそろい、つなげられる）
        for (const part of f.parts) for (const piece of clipToTile(part, f.extent)) if (piece.length >= 2) parts.push(piece.map((p) => xz(p, f.extent)).map((q) => [r1(q.x), r1(q.z)] as [number, number]));
      }
    }
  }
  // 駅: 同じ駅の区間（150 m 以内）は 1 つに。名前は 400 m 以内の駅名の注記
  for (const s of stations) {
    if (Math.abs(s.x) >= half || Math.abs(s.z) >= half) continue;
    if (items.some((i) => i.kind === 'station' && Math.hypot(i.x - s.x, i.z - s.z) < 150)) continue;
    const name = nearestLabel(labels, s.x, s.z, 400, (l) => l.code === 422);
    items.push({ kind: 'station', x: r1(s.x), z: r1(s.z), rotDeg: Math.round(s.deg), ...(name ? { name } : {}) });
  }
  // 施設の名前: 150 m 以内の施設名の注記（8xx）
  for (const i of items) {
    if (i.name || i.kind === 'station') continue;
    const name = nearestLabel(labels, i.x, i.z, 150, (l) => l.code >= 800 && l.code < 900 && l.code !== 800);
    if (name) i.name = name;
  }
  const landmarks = items.map((it, k) => ({ id: `MK${String(k + 1).padStart(3, "0")}`, ...it }) as LandmarkDef);
  const lines = joinParts(parts)
    .filter((pts) => pts.some(([x, z]) => Math.abs(x) < half && Math.abs(z) < half))
    .map((pts, k) => ({ id: `PL${String(k + 1).padStart(2, '0')}`, pts }));
  return { landmarks, powerLines: lines };
}

/** 線をタイルの範囲 [0, extent] に切り取る（はみ出した所で分ける） */
export function clipToTile(pts: readonly [number, number][], extent: number): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const inside = (p: readonly [number, number]): boolean => p[0] >= 0 && p[0] <= extent && p[1] >= 0 && p[1] <= extent;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    // Liang–Barsky
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let ok = true;
    for (const [pp, q] of [[-dx, a[0]], [dx, extent - a[0]], [-dy, a[1]], [dy, extent - a[1]]] as const) {
      if (pp === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const r = q / pp;
      if (pp < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    const p0: [number, number] = [a[0] + dx * t0, a[1] + dy * t0];
    const p1: [number, number] = [a[0] + dx * t1, a[1] + dy * t1];
    if (cur.length === 0) cur.push(p0);
    cur.push(p1);
    if (!inside(b) || t1 < 1) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function nearestLabel(labels: readonly Label[], x: number, z: number, maxM: number, ok: (l: Label) => boolean): string | undefined {
  let best: Label | undefined;
  let bd = maxM;
  for (const l of labels) {
    if (!ok(l)) continue;
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best?.text;
}

/** 端が 3 m 以内で重なる線をつなぐ（タイルの境目で切れた送電線を 1 本にする） */
export function joinParts(parts: readonly [number, number][][]): [number, number][][] {
  const lines = parts.map((p) => [...p]);
  const near = (a: [number, number], b: [number, number]): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i += 1) {
      for (let j = 0; j < lines.length; j += 1) {
        if (i === j) continue;
        const a = lines[i]!;
        const b = lines[j]!;
        let joined: [number, number][] | null = null;
        if (near(a[a.length - 1]!, b[0]!)) joined = [...a, ...b.slice(1)];
        else if (near(a[a.length - 1]!, b[b.length - 1]!)) joined = [...a, ...[...b].reverse().slice(1)];
        else if (near(a[0]!, b[0]!)) joined = [...[...a].reverse(), ...b.slice(1)];
        if (joined) {
          lines[i] = joined;
          lines.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return lines;
}

/** 線に沿った点（間隔 stepM）。各点の沿った距離 s つき */
export function sampleLine(pts: readonly [number, number][], stepM: number): { x: number; z: number; s: number }[] {
  const out: { x: number; z: number; s: number }[] = [];
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += stepM) out.push({ x: ax + ((bx - ax) * d) / len, z: az + ((bz - az) * d) / len, s: s + d });
    s += len;
  }
  const last = pts[pts.length - 1];
  if (last) out.push({ x: last[0], z: last[1], s });
  return out;
}

/**
 * 送電線の上に鉄塔を置く。範囲の内側（縁から 30 m）で、前の鉄塔から TOWER_MIN_M〜TOWER_MAX_M 先のうち、いちばん標高の高い所（尾根）に置く。
 * elevAt は標高（m）
 */
export function placeTowers(line: PowerLineDef, half: number, elevAt: (x: number, z: number) => number): { x: number; z: number }[] {
  const inside = sampleLine(line.pts, 5).filter((p) => Math.abs(p.x) < half - 30 && Math.abs(p.z) < half - 30);
  if (inside.length < 2) return [];
  const out: { x: number; z: number }[] = [];
  // 最初の鉄塔: 範囲に入ってから TOWER_MIN_M までのうち高い所
  let from = inside[0]!.s;
  let pick = argmaxElev(inside.filter((p) => p.s <= from + TOWER_MIN_M), elevAt);
  while (pick) {
    out.push({ x: r1(pick.x), z: r1(pick.z) });
    from = pick.s;
    const win = inside.filter((p) => p.s >= from + TOWER_MIN_M && p.s <= from + TOWER_MAX_M);
    // 範囲の中で途切れた線（いったん外へ出てまた入る）は、次の区間の始まりから選ぶ
    pick = win.length ? argmaxElev(win, elevAt) : argmaxElev(inside.filter((p) => p.s > from + TOWER_MAX_M).slice(0, Math.round(TOWER_MIN_M / 5)), elevAt);
  }
  return out;
}

function argmaxElev<T extends { x: number; z: number }>(pts: readonly T[], elevAt: (x: number, z: number) => number): T | null {
  let best: T | null = null;
  let be = -Infinity;
  for (const p of pts) {
    const e = elevAt(p.x, p.z);
    if (e > be) {
      be = e;
      best = p;
    }
  }
  return best;
}

/** 送電線ごとに鉄塔を置き、施設とまとめる（鉄塔の ID は T001…） */
export function withTowers(map: MapRuntime, landmarks: readonly LandmarkDef[], lines: readonly PowerLineDef[], elevAt: (x: number, z: number) => number): LandmarkDef[] {
  const out = landmarks.filter((l) => l.kind !== 'tower');
  let k = 0;
  for (const line of lines) {
    for (const p of placeTowers(line, map.half, elevAt)) {
      k += 1;
      out.push({ id: `T${String(k).padStart(3, '0')}`, kind: 'tower', x: p.x, z: p.z, line: line.id });
    }
  }
  return out;
}

/** 線の上でいちばん近い点（鉄塔を線に載せるとき） */
export function nearestOnLine(pts: readonly [number, number][], x: number, z: number): { x: number; z: number; d: number } {
  let best = { x, z, d: Infinity };
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + t * dx;
    const pz = az + t * dz;
    const d = Math.hypot(px - x, pz - z);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

/** 線に沿った距離（鉄塔を線の順に並べて電線を張るとき） */
export function alongLine(pts: readonly [number, number][], x: number, z: number): number {
  let s = 0;
  let best = { d: Infinity, s: 0 };
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len || 1)));
    const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
    if (d < best.d) best = { d, s: s + t * len };
    s += len;
  }
  return best.s;
}

/**
 * 市街地（建物・道路・鉄道）を地理院の最適化ベクトルタイル（optimal_bvmap-v1、z16。docs/15 §4 の表の通信先）から作る。
 * - 建物（層 BldA の面）は向きのある長方形に単純化する（いちばん長い辺の向き）。vt_code で階の目安を決める
 * - 道路（層 RdCL の線）は幅の区分（vt_rnkwidth）から幅を決める。トンネル（vt_code の末尾 3）と徒歩道（272x。登山道は OSM で取り込む）は除く
 * - 鉄道（層 RailCL）はトンネルを除く
 * 植生の塗り（vegetation.overrides）は、建物の周りと道路のセルを「市街地」にする（沢・崖のセルは道路では塗らない）。
 * 変換は Node でテストできる純粋関数。取得（fetchUrban）だけが通信する。
 */
import { VegClass, type GridOverride, type MapRuntime, type UrbanDef } from '../../sim/types';
import { decodeGrid, encodeGrid } from '../../sim/terrain/codec';
import { decodeMvtFeatures } from './mvt';
import { bboxOf, toXZ } from './projection';
import { lonLatToTile, tileToLonLat } from './tiles';
import { GSI_VECTOR_ZOOM, vectorTileUrl } from './vegsym';

type Building = UrbanDef['buildings'][number];
type Line = UrbanDef['lines'][number];

/** 建物の vt_code → 階の目安 */
const FLOORS: Record<number, number> = { 3101: 2, 3102: 4, 3103: 10, 3111: 1, 3112: 1 };

/** 道路の幅の区分 → 幅（m） */
export function roadWidthM(rnk: unknown): number {
  const s = String(rnk ?? '');
  if (s.startsWith('19.5m')) return 21;
  if (s.startsWith('13m')) return 15;
  if (s.startsWith('5.5m')) return 7.5;
  if (s.startsWith('3m-')) return 4.5;
  return 2.6;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** 面の外周から、向きのある長方形 [中心 x, 中心 z, 幅, 奥行き, 向き（度）] を作る */
export function orientedRect(ring: readonly { x: number; z: number }[]): [number, number, number, number, number] | null {
  if (ring.length < 3) return null;
  let best = 0;
  let ang = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const dx = ring[i]!.x - ring[i - 1]!.x;
    const dz = ring[i]!.z - ring[i - 1]!.z;
    const l = dx * dx + dz * dz;
    if (l > best) {
      best = l;
      ang = Math.atan2(dz, dx);
    }
  }
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of ring) {
    const u = p.x * c + p.z * s;
    const v = -p.x * s + p.z * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const w = u1 - u0;
  const d = v1 - v0;
  if (w < 1 || d < 1) return null;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  let deg = (ang * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180;
  return [r1(uc * c - vc * s), r1(uc * s + vc * c), r1(w), r1(d), Math.round(deg)];
}

/** タイル 1 枚の建物・道路・鉄道（ワールド座標 m。範囲の外の建物は除く。線は範囲の少し外まで残す） */
export function urbanFromTile(buf: Uint8Array, z: number, tx: number, ty: number, lat0: number, lon0: number, sizeM: number): { buildings: Building[]; lines: Line[] } {
  const half = sizeM / 2;
  const buildings: Building[] = [];
  const lines: Line[] = [];
  const xz = (p: [number, number], extent: number): { x: number; z: number } => toXZ(lat0, lon0, tileToLonLat(tx + p[0] / extent, ty + p[1] / extent, z));
  for (const f of decodeMvtFeatures(buf, ['BldA', 'RdCL', 'RailCL'])) {
    const code = Number(f.props['vt_code']);
    if (f.layer === 'BldA' && f.type === 3) {
      const ring = f.parts[0];
      if (!ring) continue;
      const r = orientedRect(ring.map((p) => xz(p, f.extent)));
      if (!r || Math.abs(r[0]) > half || Math.abs(r[1]) > half) continue;
      buildings.push([...r, FLOORS[code] ?? 2]);
    } else if (f.layer === 'RdCL' && f.type === 2) {
      // 末尾 3 はトンネル、272x は徒歩道
      if (code % 10 === 3 || Math.floor(code / 10) === 272) continue;
      const cat = String(f.props['vt_rdctg'] ?? '');
      const widthM = code === 2711 ? 2.6 : roadWidthM(f.props['vt_rnkwidth']);
      const major = cat === '国道' || cat === '都道府県道' || cat === '高速自動車国道等' || widthM >= 7;
      for (const part of f.parts) {
        if (part.length < 2) continue;
        lines.push({ kind: 'road', widthM, ...(major ? { major } : {}), pts: part.map((p) => xz(p, f.extent)).map((q) => [r1(q.x), r1(q.z)] as [number, number]) });
      }
    } else if (f.layer === 'RailCL' && f.type === 2) {
      if (String(f.props['vt_railstate'] ?? '').includes('トンネル')) continue;
      const dbl = String(f.props['vt_sngldbl'] ?? '').includes('複');
      for (const part of f.parts) {
        if (part.length < 2) continue;
        lines.push({ kind: 'rail', widthM: dbl ? 7 : 4, pts: part.map((p) => xz(p, f.extent)).map((q) => [r1(q.x), r1(q.z)] as [number, number]) });
      }
    }
  }
  // 範囲から 200 m 以上離れた線は落とす（タイルは範囲より広い）
  const near = (l: Line): boolean => l.pts.some(([x, zz]) => Math.abs(x) < half + 200 && Math.abs(zz) < half + 200);
  return { buildings, lines: lines.filter(near) };
}

/** 範囲を覆う z16 のタイル */
export function urbanTiles(lat0: number, lon0: number, sizeM: number): { x: number; y: number }[] {
  const b = bboxOf(lat0, lon0, sizeM);
  const z = GSI_VECTOR_ZOOM;
  const a = lonLatToTile(b.west, b.north, z);
  const c = lonLatToTile(b.east, b.south, z);
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor(a.y); y <= Math.floor(c.y); y += 1) for (let x = Math.floor(a.x); x <= Math.floor(c.x); x += 1) out.push({ x, y });
  return out;
}

/** タイルをまとめて取得して市街地を作る。onProgress(済んだ枚数, 全部の枚数)。同時に 4 枚まで */
export async function fetchUrban(lat0: number, lon0: number, sizeM: number, onProgress?: (done: number, total: number) => void, headers?: Record<string, string>): Promise<UrbanDef> {
  const tiles = urbanTiles(lat0, lon0, sizeM);
  const buildings: Building[] = [];
  const lines: Line[] = [];
  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const t = tiles[next++];
      if (!t) return;
      const res = await fetch(vectorTileUrl(GSI_VECTOR_ZOOM, t.x, t.y), { headers });
      // 404 は地物のないタイル（海など）
      if (res.ok) {
        const r = urbanFromTile(new Uint8Array(await res.arrayBuffer()), GSI_VECTOR_ZOOM, t.x, t.y, lat0, lon0, sizeM);
        buildings.push(...r.buildings);
        lines.push(...r.lines);
      } else if (res.status !== 404) throw new Error(`地理院地図のタイルを取得できませんでした（${res.status}）`);
      done += 1;
      onProgress?.(done, tiles.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // タイルの境目で同じ建物が 2 つに割れることがあるので、中心がほぼ同じものは 1 つに
  const seen = new Set<string>();
  const uniq = buildings.filter((b) => {
    const k = `${Math.round(b[0] / 2)},${Math.round(b[1] / 2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { buildings: uniq, lines, source: { tiles: 'gsi-optimal_bvmap-v1', zoom: GSI_VECTOR_ZOOM, fetchedAt: new Date().toISOString() } };
}

/** 点から線分までの距離 */
function segDist(px: number, pz: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}

/**
 * 市街地のセル（0/1）。建物は、セルの中心から建物の長方形まで（建物の周りの庭・路地として）marginM 以内。
 * 道路・鉄道は中心線から幅の半分＋セルの 0.35 以内（沢・崖のセルは除く。橋や切り通しのため）
 */
export function urbanCells(map: MapRuntime, u: UrbanDef, marginM = 6): Uint8Array {
  const n = map.n;
  const cell = map.cell;
  const out = new Uint8Array(n * n);
  const idx = (x: number, z: number): [number, number] => [Math.round((x + map.half) / cell), Math.round((z + map.half) / cell)];
  for (const [cx, cz, w, d, deg] of u.buildings) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const R = Math.hypot(w, d) / 2 + marginM + cell;
    const [i0, j0] = idx(cx - R, cz - R);
    const [i1, j1] = idx(cx + R, cz + R);
    for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j += 1)
      for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i += 1) {
        const x = i * cell - map.half - cx;
        const z = j * cell - map.half - cz;
        // 長方形の座標系での、はみ出し量
        const du = Math.max(0, Math.abs(x * c + z * s) - w / 2);
        const dv = Math.max(0, Math.abs(-x * s + z * c) - d / 2);
        if (Math.hypot(du, dv) <= marginM + cell * 0.35) out[j * n + i] = 1;
      }
  }
  for (const l of u.lines) {
    const reach = l.widthM / 2 + cell * 0.35;
    for (let k = 1; k < l.pts.length; k += 1) {
      const a = l.pts[k - 1]!;
      const b = l.pts[k]!;
      const [i0, j0] = idx(Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach);
      const [i1, j1] = idx(Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach);
      for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j += 1)
        for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i += 1) {
          const gi = j * n + i;
          const v = map.veg[gi];
          if (v === VegClass.STREAM || v === VegClass.CLIFF) continue;
          if (segDist(i * cell - map.half, j * cell - map.half, a, b) <= reach) out[gi] = 1;
        }
    }
  }
  return out;
}

/** いまの塗りに市街地を重ねる（前に塗った市街地は消してから。ほかの塗りは残す） */
export function mergeUrbanOverrides(n: number, prev: GridOverride | undefined, cells: Uint8Array): { overrides: GridOverride; count: number } {
  const grid = prev ? decodeGrid(prev, n * n) : new Uint8Array(n * n);
  let count = 0;
  for (let i = 0; i < n * n; i += 1) {
    if (grid[i] === VegClass.URBAN + 1) grid[i] = 0;
    if (cells[i]) {
      grid[i] = VegClass.URBAN + 1;
      count += 1;
    }
  }
  return { overrides: encodeGrid(grid), count };
}

/** 市街地の塗りだけを消す */
export function clearUrbanOverrides(n: number, prev: GridOverride | undefined): GridOverride | undefined {
  if (!prev) return undefined;
  const grid = decodeGrid(prev, n * n);
  for (let i = 0; i < n * n; i += 1) if (grid[i] === VegClass.URBAN + 1) grid[i] = 0;
  return encodeGrid(grid);
}

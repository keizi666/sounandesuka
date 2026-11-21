/**
 * 地理院の最適化ベクトルタイル（z16）の取得をまとめる（森の種類の記号・建物・道路で同じタイルを使う）。
 * 一度取ったタイルは、エディターを開いているあいだ覚えておき、取り直さない（相手のサーバーに負担をかけない）。
 */
import { decodeGrid, encodeGrid } from '../../sim/terrain/codec';
import { VegClass, type GridOverride, type MapRuntime } from '../../sim/types';
import { bboxOf } from './projection';
import { lonLatToTile } from './tiles';
import { GSI_VECTOR_ZOOM, vectorTileUrl, vegOverridesFromSymbols, vegSymbolsFromTile, type VegSymbol } from './vegsym';

export interface VectorTile {
  x: number;
  y: number;
  /** 地物のないタイル（404）は null */
  buf: Uint8Array | null;
}

const cache = new Map<string, Uint8Array | null>();

/** 範囲を覆う z16 のタイル */
export function vectorTilesFor(lat0: number, lon0: number, sizeM: number): { x: number; y: number }[] {
  const b = bboxOf(lat0, lon0, sizeM);
  const z = GSI_VECTOR_ZOOM;
  const a = lonLatToTile(b.west, b.north, z);
  const c = lonLatToTile(b.east, b.south, z);
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor(a.y); y <= Math.floor(c.y); y += 1) for (let x = Math.floor(a.x); x <= Math.floor(c.x); x += 1) out.push({ x, y });
  return out;
}

/** 範囲のタイルをまとめて取る（同時に 4 枚まで）。onProgress(済んだ枚数, 全部の枚数) */
export async function fetchVectorTiles(lat0: number, lon0: number, sizeM: number, onProgress?: (done: number, total: number) => void, headers?: Record<string, string>): Promise<VectorTile[]> {
  const list = vectorTilesFor(lat0, lon0, sizeM);
  const out: VectorTile[] = [];
  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const t = list[next++];
      if (!t) return;
      const url = vectorTileUrl(GSI_VECTOR_ZOOM, t.x, t.y);
      let buf = cache.get(url);
      if (buf === undefined) {
        const res = await fetch(url, { headers });
        if (res.ok) buf = new Uint8Array(await res.arrayBuffer());
        else if (res.status === 404) buf = null;
        else throw new Error(`地理院地図のタイルを取得できませんでした（${res.status}）`);
        cache.set(url, buf);
      }
      out.push({ ...t, buf });
      done += 1;
      onProgress?.(done, list.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

/** タイルから森の種類の記号（広葉樹林・針葉樹林） */
export function forestSymbols(tiles: readonly VectorTile[]): VegSymbol[] {
  return tiles.flatMap((t) => (t.buf ? vegSymbolsFromTile(t.buf, GSI_VECTOR_ZOOM, t.x, t.y) : []));
}

/**
 * 記号から森の種類を塗り、いまの塗りに重ねる。塗り替えるのは、塗っていないセルと前に森の種類を塗ったセルだけ
 * （作者が塗った岩場・沢・市街地などは残す）。返り値の counts は森の種類ごとのセルの数
 */
export function mergeForestOverrides(map: MapRuntime, lat0: number, lon0: number, prev: GridOverride | undefined, symbols: readonly VegSymbol[], maxDistM?: number, jitterM?: number): { overrides: GridOverride; counts: Record<string, number> } {
  const n = map.n;
  const fresh = decodeGrid(vegOverridesFromSymbols(map, lat0, lon0, symbols, maxDistM, jitterM).overrides, n * n);
  const grid = prev ? decodeGrid(prev, n * n) : new Uint8Array(n * n);
  const forest = (v: number): boolean => v === VegClass.BROADLEAF + 1 || v === VegClass.CONIFER + 1;
  const counts: Record<string, number> = { broadleaf: 0, conifer: 0 };
  for (let i = 0; i < n * n; i += 1) {
    if (grid[i] !== 0 && !forest(grid[i]!)) continue;
    // 前に塗った森の種類は、いったん自動に戻してから塗り直す
    if (forest(grid[i]!)) grid[i] = 0;
    if (fresh[i]) {
      grid[i] = fresh[i]!;
      counts[fresh[i] === VegClass.CONIFER + 1 ? 'conifer' : 'broadleaf']! += 1;
    }
  }
  return { overrides: encodeGrid(grid), counts };
}

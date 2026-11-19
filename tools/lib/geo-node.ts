// tools 用: 地理院の標高タイルと Overpass を Node から取得する（通信先は docs/15 §4 の表のものだけ。src/editor/geo の定義を使う）。
// 応答は .scratch/geo-cache/ に保存し、同じ範囲を再取得しない（NFR-11）。タイルは同時 4 本まで。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEM_ZOOM, decodeDemRgba, fillInvalid, sampleGrid, smoothGauss, tileKey, type DemTile } from '../../src/editor/geo/dem';
import { fetchOsm, type OsmJson } from '../../src/editor/geo/overpass';
import { bboxOf } from '../../src/editor/geo/projection';
import { tilesCovering, tileUrl } from '../../src/editor/geo/tiles';
import { GSI_VECTOR_ZOOM, vectorTileUrl, vegSymbolsFromTile, type VegSymbol } from '../../src/editor/geo/vegsym';
import { ROOT } from './maps';
import { decodePng } from './png-decode';

const CACHE = resolve(ROOT, '.scratch', 'geo-cache');

async function demTile(x: number, y: number): Promise<DemTile | null> {
  mkdirSync(CACHE, { recursive: true });
  const file = resolve(CACHE, `dem_${DEM_ZOOM}_${x}_${y}.png`);
  let buf: Uint8Array;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const res = await fetch(tileUrl('dem_png', DEM_ZOOM, x, y));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`標高タイルを取得できませんでした（${res.status}）`);
    buf = new Uint8Array(await res.arrayBuffer());
    writeFileSync(file, buf);
  }
  return decodeDemRgba(decodePng(buf).rgba);
}

export async function fetchHeights(lat0: number, lon0: number, size: number, n: number, smoothing: number): Promise<{ heights: Float32Array; tiles: number; fallback: number }> {
  const list = tilesCovering(bboxOf(lat0, lon0, size), DEM_ZOOM);
  const tiles = new Map<string, DemTile>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const t = list[next++]!;
      const d = await demTile(t.x, t.y);
      if (d) tiles.set(tileKey(DEM_ZOOM, t.x, t.y), d);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const raw = sampleGrid(tiles, DEM_ZOOM, lat0, lon0, size, n);
  const f = fillInvalid(raw, n);
  return { heights: smoothGauss(raw, n, smoothing), tiles: list.length, fallback: f.fallback };
}

export async function fetchOsmCached(lat0: number, lon0: number, size: number): Promise<OsmJson> {
  mkdirSync(CACHE, { recursive: true });
  const file = resolve(CACHE, `osm_${lat0.toFixed(4)}_${lon0.toFixed(4)}_${size}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as OsmJson;
  const j = await fetchOsm(lat0, lon0, size, { 'User-Agent': 'hakoniwa-sim-tools/0.1' });
  writeFileSync(file, JSON.stringify(j));
  return j;
}

/** 地理院ベクトルタイルの植生記号（範囲のタイルを取り、.scratch/geo-cache/ に保存して再取得しない） */
export async function fetchVegSymbolsCached(lat0: number, lon0: number, size: number): Promise<{ symbols: VegSymbol[]; tiles: number }> {
  mkdirSync(CACHE, { recursive: true });
  const z = GSI_VECTOR_ZOOM;
  const list = tilesCovering(bboxOf(lat0, lon0, size), z);
  const symbols: VegSymbol[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const t = list[next++]!;
      const file = resolve(CACHE, `bv_${z}_${t.x}_${t.y}.pbf`);
      let buf: Uint8Array;
      if (existsSync(file)) buf = readFileSync(file);
      else {
        const res = await fetch(vectorTileUrl(z, t.x, t.y), { headers: { 'User-Agent': 'hakoniwa-sim-tools/0.1' } });
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`ベクトルタイルを取得できませんでした（${res.status}）`);
        buf = new Uint8Array(await res.arrayBuffer());
        writeFileSync(file, buf);
      }
      symbols.push(...vegSymbolsFromTile(buf, z, t.x, t.y));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { symbols, tiles: list.length };
}

/// <reference lib="webworker" />
/**
 * 標高タイルの取得とデコード（docs/16 §3.2）。同時 4 本まで（NFR-11）。
 * 地理院の dem_png（z14）を取り、箱庭の格子に補間し、穴埋めと平滑化をして返す。
 */
import { bboxOf } from './projection';
import { tilesCovering, tileUrl } from './tiles';
import { DEM_ZOOM, decodeDemRgba, fillInvalid, sampleGrid, smoothGauss, tileKey, TILE_PX, type DemTile } from './dem';

export interface DemRequest {
  lat0: number;
  lon0: number;
  size: number;
  n: number;
  smoothing: number;
}
export type DemMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; heights: Float32Array; filled: number; fallback: number; failedTiles: number }
  | { type: 'error'; message: string };

async function fetchTile(z: number, x: number, y: number): Promise<DemTile | null> {
  const res = await fetch(tileUrl('dem_png', z, x, y));
  if (res.status === 404) return null; // 海などタイルがない
  if (res.status === 429) throw new Error('標高タイルのサーバーが混雑しています（429）。しばらくしてからやり直してください。');
  if (!res.ok) throw new Error(`標高タイルを取得できませんでした（${res.status}）`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(TILE_PX, TILE_PX);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  return decodeDemRgba(g.getImageData(0, 0, TILE_PX, TILE_PX).data);
}

self.onmessage = async (ev: MessageEvent<DemRequest>) => {
  const { lat0, lon0, size, n, smoothing } = ev.data;
  const post = (m: DemMessage, t?: Transferable[]): void => (self as unknown as Worker).postMessage(m, t ?? []);
  try {
    const list = tilesCovering(bboxOf(lat0, lon0, size), DEM_ZOOM);
    const tiles = new Map<string, DemTile>();
    let done = 0;
    let failed = 0;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < list.length) {
        const t = list[next++]!;
        const d = await fetchTile(DEM_ZOOM, t.x, t.y);
        if (d) tiles.set(tileKey(DEM_ZOOM, t.x, t.y), d);
        else failed += 1;
        done += 1;
        post({ type: 'progress', done, total: list.length });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const raw = sampleGrid(tiles, DEM_ZOOM, lat0, lon0, size, n);
    const fill = fillInvalid(raw, n);
    const heights = smoothGauss(raw, n, smoothing);
    post({ type: 'done', heights, filled: fill.filled, fallback: fill.fallback, failedTiles: failed }, [heights.buffer]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

// npm run geo:smoke — 手動用。地理院タイル・Overpass・Open-Meteo に実際に 1 回ずつ問い合わせ、応答の形式を確かめる（テストでは通信しない）。
import { decodeDemRgba, TILE_PX } from '../src/editor/geo/dem';
import { convertOpenMeteo, fetchOpenMeteo } from '../src/editor/geo/openmeteo';
import { fetchOsm, osmToGraph } from '../src/editor/geo/overpass';
import { lonLatToTile, tileUrl } from '../src/editor/geo/tiles';
import { decodePng } from './lib/png-decode';

const LAT = 36.4;
const LON = 137.71;
let ok = true;
const step = async (name: string, f: () => Promise<string>): Promise<void> => {
  try {
    console.log(`✔ ${name}: ${await f()}`);
  } catch (e) {
    ok = false;
    console.log(`✖ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

await step('地理院 標高タイル（dem_png z14）', async () => {
  const t = lonLatToTile(LON, LAT, 14);
  const res = await fetch(tileUrl('dem_png', 14, Math.floor(t.x), Math.floor(t.y)));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const png = decodePng(new Uint8Array(await res.arrayBuffer()));
  if (png.width !== TILE_PX || png.height !== TILE_PX) throw new Error(`大きさ ${png.width}×${png.height}`);
  const h = decodeDemRgba(png.rgba).filter((v) => !Number.isNaN(v));
  return `${png.width}×${png.height}、標高 ${Math.round(Math.min(...h))}〜${Math.round(Math.max(...h))} m`;
});
await step('Overpass（登山道・地点、一辺 2 km）', async () => {
  const j = await fetchOsm(LAT, LON, 2048, { 'User-Agent': 'sounan-sim-tools/0.1' });
  const g = osmToGraph(j, LAT, LON, 2048, () => 2000);
  return `要素 ${j.elements.length}、道 ${g.edges.length} 本、地点 ${g.nodes.length}`;
});
await step('Open-Meteo Historical（1 日分）', async () => {
  const r = await fetchOpenMeteo(LAT, LON, '2025-10-12', '2025-10-12');
  const k = convertOpenMeteo(r, { refElevM: 1000, lapseRateCPer100m: 0.65, startDate: '2025-10-12' });
  return `格子の標高 ${r.elevation} m、${k.length} 時間、00 時の基準気温 ${k[0]?.tempC}℃`;
});
process.exit(ok ? 0 : 1);

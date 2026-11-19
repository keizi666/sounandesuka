// npm run thumbs [-- <scenarioId> ...] — シナリオ選択の画面に出す絵を作る。
//   1) 2D の地図（陰影・植生・沢・登山道・計画ルート・小屋）: Node で地形から描く（通信しない）
//   2) 3D の地形の画: 開発サーバー（npm run dev）の shots.html を Chrome で開いて撮る（playwright-core。ブラウザは手元の Chrome）
// 箱庭岳のシナリオは public/scenarios/thumbs/ に、実在の山のシナリオは public/scenarios/real/thumbs/ に書く
// （実在の山の絵は地理院・OSM のデータから作るので、バンドルと同じく .gitignore に入れている）。
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { resolveRoute } from '../src/sim/terrain/trails';
import { buildMapRuntime } from '../src/sim/terrain/map';
import { VegClass, type SounanBundle, type MapDef, type ScenarioDef, type ScenarioIndexEntry } from '../src/sim/types';
import { writePng } from './lib/image';
import { loadMapDef, ROOT } from './lib/maps';

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const skip3d = process.argv.includes('--no-3d');
const url = process.env['THUMBS_URL'] ?? 'http://localhost:5281';
const index = JSON.parse(readFileSync(resolve(ROOT, 'public/scenarios/index.json'), 'utf8')) as ScenarioIndexEntry[];
const entries = index.filter((e) => ids.length === 0 || ids.includes(e.id));

function load(e: ScenarioIndexEntry): { map: MapDef; scenario: ScenarioDef } | null {
  if (e.bundle) {
    const f = resolve(ROOT, 'public/scenarios', e.bundle);
    if (!existsSync(f)) return null;
    const b = JSON.parse(readFileSync(f, 'utf8')) as SounanBundle;
    return { map: b.map, scenario: b.scenario };
  }
  const scenario = JSON.parse(readFileSync(resolve(ROOT, 'public/scenarios', e.file ?? `${e.id}.json`), 'utf8')) as ScenarioDef;
  return { map: loadMapDef(scenario.mapId), scenario };
}
const outDirOf = (e: ScenarioIndexEntry): string => resolve(ROOT, e.region?.real ? 'public/scenarios/real/thumbs' : 'public/scenarios/thumbs');

/** 2D の地図（S×S）。北が上 */
function drawMap(def: MapDef, s: ScenarioDef, file: string, S = 320): void {
  const rt = buildMapRuntime(def, { radio: false }).map;
  const n = rt.n;
  const px = new Uint8Array(S * S * 3);
  const col: Record<number, [number, number, number]> = {
    [VegClass.BROADLEAF]: [128, 168, 96],
    [VegClass.CONIFER]: [62, 112, 78],
    [VegClass.KRUMMHOLZ]: [110, 140, 90],
    [VegClass.ALPINE]: [170, 168, 130],
    [VegClass.ROCK]: [150, 144, 136],
    [VegClass.STREAM]: [90, 150, 210],
    [VegClass.CLIFF]: [120, 110, 100],
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of rt.heights) (lo = Math.min(lo, h)), (hi = Math.max(hi, h));
  for (let y = 0; y < S; y += 1)
    for (let x = 0; x < S; x += 1) {
      const gx = Math.min(n - 1, Math.floor((x / S) * n));
      const gz = Math.min(n - 1, Math.floor((y / S) * n));
      const i = gz * n + gx;
      const shade = 0.72 + 0.28 * Math.cos((rt.aspect[i] ?? 0) - Math.PI * 1.25) * Math.min(1, (rt.slopeDeg[i] ?? 0) / 35);
      const tint = 0.85 + 0.25 * ((rt.heights[i]! - lo) / Math.max(1, hi - lo));
      const c = col[rt.veg[i]!] ?? [180, 180, 180];
      for (let k = 0; k < 3; k += 1) px[(y * S + x) * 3 + k] = Math.max(0, Math.min(255, c[k]! * shade * tint));
    }
  const put = (xm: number, zm: number, rgb: [number, number, number], r: number): void => {
    const cx = ((xm + rt.half) / def.size) * S;
    const cy = ((zm + rt.half) / def.size) * S;
    for (let dy = -r; dy <= r; dy += 1)
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        for (let k = 0; k < 3; k += 1) px[(y * S + x) * 3 + k] = rgb[k]!;
      }
  };
  for (const t of Object.values(rt.trails)) if (t.def.kind === 'trail') for (const p of t.samples) put(p.x, p.z, [236, 232, 220], 0);
  for (const leg of resolveRoute(rt, s.plan.route)) for (const p of rt.trails[leg.edgeId]!.samples) put(p.x, p.z, [232, 92, 40], 1);
  for (const nd of Object.values(rt.nodes)) if (nd.shelter || nd.type === 'trailhead' || nd.type === 'peak') put(nd.x, nd.z, nd.shelter ? [250, 220, 90] : nd.type === 'peak' ? [40, 40, 40] : [255, 255, 255], 2);
  writePng(file, S, S, px, 3);
}

const todo: { e: ScenarioIndexEntry; out: string }[] = [];
for (const e of entries) {
  const got = load(e);
  if (!got) {
    console.log(`- ${e.id}: 実地形のバンドルがないので飛ばす`);
    continue;
  }
  const out = outDirOf(e);
  mkdirSync(out, { recursive: true });
  drawMap(got.map, got.scenario, resolve(out, `${e.id}.map.png`));
  console.log(`✔ ${e.id}: 2D の地図`);
  todo.push({ e, out });
}

if (!skip3d && todo.length > 0) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
  for (const { e, out } of todo) {
    await page.goto(`${url}/shots.html?scenario=${e.id}&quality=high`);
    await page.waitForFunction('window.__shots && (window.__shots.ready || window.__shots.error)', undefined, { timeout: 120000 });
    const err = await page.evaluate('window.__shots.error');
    if (err) {
      console.log(`✖ ${e.id}: ${String(err)}`);
      continue;
    }
    await page.evaluate("window.__shots.setPreset('overview')");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(out, `${e.id}.jpg`), type: 'jpeg', quality: 78 });
    console.log(`✔ ${e.id}: 3D の地形`);
  }
  await browser.close();
}

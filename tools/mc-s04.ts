// npm run mc:s04 -- [--n 200] — 史実シナリオ s04 の受け入れ基準（docs/13 P19）を確かめる。
// 実地形のバンドル（npm run make:s04 で作る）が必要。方針 historical / recommended / bias で回し、
// 死亡者数の中央値、発症（35℃ 到達）の中央時刻、死亡者 1 人以上の割合を出す。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatTimeRef } from '../src/sim/core/clock';
import { deriveSeed } from '../src/sim/core/rng';
import { runHeadless } from '../src/sim/headless';
import { buildMapRuntime } from '../src/sim/terrain/map';
import type { SounanBundle, PolicyName } from '../src/sim/types';
import { ROOT } from './lib/maps';

const { values } = parseArgs({ options: { n: { type: 'string', default: '200' }, policy: { type: 'string' } } });
const file = resolve(ROOT, 'public/scenarios/historical/s04_tomuraushi_2009.sounan.json');
if (!existsSync(file)) {
  console.log('バンドルがありません。先に npm run make:s04 を実行してください。');
  process.exit(1);
}
const b = JSON.parse(readFileSync(file, 'utf8')) as SounanBundle;
const rt = buildMapRuntime(b.map).map;
const n = Number(values.n);
const med = (a: number[]): number => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
let ok = true;
for (const policy of (values.policy ? [values.policy] : ['historical', 'recommended', 'bias']) as PolicyName[]) {
  const deaths: number[] = [];
  const onset: number[] = [];
  const kinds: Record<string, number> = {};
  const t0 = performance.now();
  for (let i = 0; i < n; i += 1) {
    const first: Record<string, number> = {};
    const r = runHeadless(rt, b.scenario, {
      policy,
      seed: deriveSeed(b.scenario.seed, i),
      record: false,
      onTick(w) {
        for (const c of w.climbers) if (first[c.id] === undefined && c.body.coreC < 35) first[c.id] = w.tMin;
      },
    });
    deaths.push(r.world.climbers.filter((c) => !c.body.alive).length);
    // その回の「発症」= 最初の 5 人が 35℃ を下回った時刻の中央（報告書: 北沼分岐の前後で次々に発症）
    const ts = Object.values(first).sort((x, y) => x - y);
    if (ts.length > 0) onset.push(med(ts.slice(0, 5)));
    kinds[r.ending.kind] = (kinds[r.ending.kind] ?? 0) + 1;
  }
  const withDeath = deaths.filter((d) => d >= 1).length / n;
  const dm = med(deaths);
  const om = med(onset);
  const t = b.scenario.balanceTargets?.[policy];
  const checks: string[] = [];
  if (t?.deathCountMedian) checks.push(`${dm >= t.deathCountMedian[0] && dm <= t.deathCountMedian[1] ? '✔' : ((ok = false), '✖')} 死亡者数の中央値 ${dm} ∈ [${t.deathCountMedian.join(', ')}]`);
  if (t?.fatalMin !== undefined) checks.push(`${withDeath >= t.fatalMin ? '✔' : ((ok = false), '✖')} 死亡者 1 人以上 ${(withDeath * 100).toFixed(1)}% ≥ ${t.fatalMin * 100}%`);
  if (t?.fatalMax !== undefined) checks.push(`${withDeath <= t.fatalMax ? '✔' : ((ok = false), '✖')} 死亡者 1 人以上 ${(withDeath * 100).toFixed(1)}% ≤ ${t.fatalMax * 100}%`);
  if (policy === 'historical') checks.push(`${om >= 600 && om <= 720 ? '✔' : ((ok = false), '✖')} 発症の中央時刻 ${Number.isNaN(om) ? '—' : formatTimeRef(om)} ∈ [D0 10:00, D0 12:00]`);
  console.log(`${policy}  n=${n}  ${((performance.now() - t0) / n).toFixed(0)} ms/run  死亡者数 中央値 ${dm}（最小 ${Math.min(...deaths)}・最大 ${Math.max(...deaths)}）  結末 ${JSON.stringify(kinds)}`);
  for (const c of checks) console.log(`  ${c}`);
}
process.exit(ok ? 0 : 1);

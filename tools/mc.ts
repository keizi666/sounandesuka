// npm run mc — モンテカルロ集計（docs/14 §4）
//   npm run mc -- <scenarioId> --policy <p> --n 500 [--seed 1]
//   npm run mc -- --all [--n 200]   全シナリオを balanceTargets にある方針で回し、合否を表示（失敗があれば exit 1）
import { parseArgs } from 'node:util';
import { checkTargets, runMonteCarlo, type McSummary } from '../src/sim/mc';
import type { PolicyName } from '../src/sim/types';
import { loadIndex, loadScenarioById, mapRuntimeFor } from './lib/scenarios';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { policy: { type: 'string', default: 'bias' }, n: { type: 'string', default: '200' }, seed: { type: 'string' }, all: { type: 'boolean' } },
});

const pctS = (v: number): string => `${(v * 100).toFixed(1)}%`;

function print(s: McSummary, targets: ReturnType<typeof checkTargets>): boolean {
  console.log(`${s.scenarioId}  policy=${s.policy}  n=${s.n}  avg ${s.msPerRun.toFixed(0)}ms/run`);
  for (const [k, v] of Object.entries(s.counts)) {
    if (v === 0) continue;
    const causes = k === 'FATAL' ? `   (${Object.entries(s.deathCauses).map(([c, x]) => `${c} ${x}`).join(', ')})` : '';
    console.log(`  ${k.padEnd(17)} ${String(v).padStart(4)}  ${pctS(v / s.n).padStart(6)}${causes}`);
  }
  console.log(`  minCoreC p10/p50/p90: ${s.minCore.p10.toFixed(1)} / ${s.minCore.p50.toFixed(1)} / ${s.minCore.p90.toFixed(1)}   道迷い ${pctS(s.lostRate)}   死亡者数の中央値 ${s.deathCountMedian}`);
  console.log(`  choices: ${Object.entries(s.choices).map(([cp, m]) => `${cp} {${Object.entries(m).map(([o, c]) => `${o}:${c}`).join(', ')}}`).join(' ')}`);
  if (targets.length === 0) return true;
  const ok = targets.every((t) => t.ok);
  const detail = targets.map((t) => `${t.ok ? '✔' : '✖'} ${t.key} ${t.key === 'deathCountMedian' ? t.value : pctS(t.value)} ${Array.isArray(t.limit) ? `∈ [${t.limit.join(', ')}]` : (t.key.endsWith('Min') ? '≥ ' : '≤ ') + pctS(t.limit)}`).join('  ');
  console.log(`  balanceTargets: ${ok ? 'OK' : 'NG'}  ${detail}`);
  return ok;
}

const n = Number(values.n);
const seed = values.seed !== undefined ? Number(values.seed) : undefined;
let allOk = true;
if (values.all) {
  for (const e of loadIndex()) {
    if (!e.file) continue;
    const s = loadScenarioById(e.id);
    const map = mapRuntimeFor(s.mapId);
    for (const [policy, target] of Object.entries(s.balanceTargets ?? {})) {
      const sum = runMonteCarlo(map, s, policy as PolicyName, n, { seed, now: () => performance.now() });
      allOk = print(sum, checkTargets(sum, target)) && allOk;
    }
  }
} else {
  const id = positionals[0];
  if (!id) {
    console.error('使い方: npm run mc -- <scenarioId> --policy bias --n 500  /  npm run mc -- --all');
    process.exit(1);
  }
  const s = loadScenarioById(id);
  const sum = runMonteCarlo(mapRuntimeFor(s.mapId), s, values.policy as PolicyName, n, { seed, now: () => performance.now() });
  allOk = print(sum, checkTargets(sum, s.balanceTargets?.[values.policy as PolicyName]));
}
process.exit(allOk ? 0 : 1);

// npm run mc — モンテカルロ集計（docs/14 §4）
//   npm run mc -- <scenarioId> --policy <p> --n 500 [--seed 1]
//   npm run mc -- --all [--n 200]   全シナリオを balanceTargets にある方針で回し、合否を表示（失敗があれば exit 1）
//   --json を付けると、結果を 1 行の JSON（{ summary, checks }）で出す（npm run balance が使う）
//   判定は ✔ 合格・△ 境目（揺れの幅が目標をまたぐ。回数を増やして測り直す）・✖ 不合格。exit 1 になるのは不合格だけ
import { parseArgs } from 'node:util';
import { checkTargets, runMonteCarlo, type McSummary, type TargetCheck, type TargetVerdict } from '../src/sim/mc';
import type { PolicyName } from '../src/sim/types';
import { loadEntryRuntime, loadIndex } from './lib/scenarios';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { policy: { type: 'string', default: 'bias' }, n: { type: 'string', default: '200' }, seed: { type: 'string' }, all: { type: 'boolean' }, json: { type: 'boolean' } },
});

const pctS = (v: number): string => `${(v * 100).toFixed(1)}%`;

const MARK = { ok: '✔', border: '△', ng: '✖' } as const;
const LABEL = { ok: 'OK', border: '境目', ng: 'NG' } as const;

/** 判定のまとめ: 不合格が 1 つでもあれば ng、境目があれば border */
function overall(targets: TargetCheck[]): TargetVerdict {
  return targets.some((t) => t.verdict === 'ng') ? 'ng' : targets.some((t) => t.verdict === 'border') ? 'border' : 'ok';
}

function print(s: McSummary, targets: TargetCheck[]): boolean {
  if (values.json) {
    console.log(JSON.stringify({ summary: s, checks: targets }));
    return overall(targets) !== 'ng';
  }
  console.log(`${s.scenarioId}  policy=${s.policy}  n=${s.n}  avg ${s.msPerRun.toFixed(0)}ms/run`);
  for (const [k, v] of Object.entries(s.counts)) {
    if (v === 0) continue;
    const causes = k === 'FATAL' ? `   (${Object.entries(s.deathCauses).map(([c, x]) => `${c} ${x}`).join(', ')})` : '';
    console.log(`  ${k.padEnd(17)} ${String(v).padStart(4)}  ${pctS(v / s.n).padStart(6)}${causes}`);
  }
  console.log(`  minCoreC p10/p50/p90: ${s.minCore.p10.toFixed(1)} / ${s.minCore.p50.toFixed(1)} / ${s.minCore.p90.toFixed(1)}   道迷い ${pctS(s.lostRate)}   死亡者数の中央値 ${s.deathCountMedian}`);
  console.log(`  choices: ${Object.entries(s.choices).map(([cp, m]) => `${cp} {${Object.entries(m).map(([o, c]) => `${o}:${c}`).join(', ')}}`).join(' ')}`);
  if (targets.length === 0) return true;
  const v = overall(targets);
  const val = (t: TargetCheck, x: number): string => (t.key === 'deathCountMedian' ? String(x) : pctS(x));
  const detail = targets.map((t) => `${MARK[t.verdict]} ${t.key} ${val(t, t.value)}（${val(t, t.lo)}〜${val(t, t.hi)}） ${Array.isArray(t.limit) ? `∈ [${t.limit.join(', ')}]` : (t.key.endsWith('Min') ? '≥ ' : '≤ ') + pctS(t.limit)}`).join('  ');
  console.log(`  balanceTargets: ${LABEL[v]}  ${detail}`);
  return v !== 'ng';
}

const n = Number(values.n);
const seed = values.seed !== undefined ? Number(values.seed) : undefined;
let allOk = true;
if (values.all) {
  for (const e of loadIndex()) {
    const got = loadEntryRuntime(e);
    if (!got) {
      console.log(`${e.id}  （実地形のバンドルがないので飛ばす: ${e.bundle}）`);
      continue;
    }
    const { scenario: s, map } = got;
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
  const e = loadIndex().find((x) => x.id === id) ?? { id, file: `${id}.json`, title: id, theme: 'mixed' as const, difficulty: 1 as const, season: 'summer' as const, estMinutes: 0 };
  const got = loadEntryRuntime(e);
  if (!got) {
    console.error(`実地形のバンドルがありません: ${e.bundle}（npm run make:s05 などで作る）`);
    process.exit(1);
  }
  const s = got.scenario;
  const sum = runMonteCarlo(got.map, s, values.policy as PolicyName, n, { seed, now: () => performance.now() });
  allOk = print(sum, checkTargets(sum, s.balanceTargets?.[values.policy as PolicyName]));
}
process.exit(allOk ? 0 : 1);

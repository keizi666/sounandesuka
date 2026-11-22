// npm run balance — 全シナリオの成績（balanceTargets）を、シナリオ×方針ごとに並行で測る
//   npm run balance [-- --n 100] [--jobs 8] [--only s04,s16] [--policy bias] [--quick] [--out <dir>]
//   - 1 件ずつ別のプロセスで npm run mc を回す（直列だと 40 分以上かかる。並べれば 10 分ほど）
//   - 判定は ✔ 合格・△ 境目（揺れの幅が目標をまたぐ）・✖ 不合格。境目のものは回数を 4 倍にして測り直す（--quick で省く）
//   - --out を付けると、1 件ごとの結果（JSON）をそのフォルダに書く
//   - 不合格が 1 件でもあれば exit 1
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { McSummary, TargetCheck, TargetVerdict } from '../src/sim/mc';
import type { ScenarioDef } from '../src/sim/types';
import { ROOT } from './lib/maps';
import { loadIndex } from './lib/scenarios';

const { values } = parseArgs({
  options: {
    n: { type: 'string', default: '100' },
    jobs: { type: 'string' },
    only: { type: 'string' },
    policy: { type: 'string' },
    quick: { type: 'boolean' },
    out: { type: 'string' },
  },
});

interface Job {
  id: string;
  policy: string;
  n: number;
  /** 重さの目安（人数）。重いものから先に回す */
  weight: number;
}
interface Result {
  job: Job;
  summary?: McSummary;
  checks: TargetCheck[];
  verdict: TargetVerdict | 'error';
  error?: string;
  sec: number;
}

const N = Number(values.n);
const JOBS = Math.max(1, Number(values.jobs ?? Math.max(1, availableParallelism() - 2)));
const only = values.only?.split(',').map((x) => x.trim()).filter(Boolean);
const dir = resolve(ROOT, 'public', 'scenarios');

function jobsOf(): { jobs: Job[]; skipped: string[] } {
  const jobs: Job[] = [];
  const skipped: string[] = [];
  for (const e of loadIndex()) {
    if (only && !only.some((o) => e.id === o || e.id.startsWith(`${o}_`))) continue;
    if (e.bundle && !existsSync(resolve(dir, e.bundle))) {
      skipped.push(`${e.id}（実地形のバンドル ${e.bundle} がない）`);
      continue;
    }
    const file = e.file ?? e.bundle!.replace(/\.sounan\.json$/, '.json');
    const s = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as ScenarioDef;
    for (const p of Object.keys(s.balanceTargets ?? {})) {
      if (values.policy && p !== values.policy) continue;
      jobs.push({ id: e.id, policy: p, n: N, weight: s.party.length });
    }
  }
  return { jobs, skipped };
}

function runJob(job: Job): Promise<Result> {
  const t0 = performance.now();
  return new Promise((done) => {
    const args = ['--import', 'tsx', resolve(ROOT, 'tools', 'mc.ts'), job.id, '--policy', job.policy, '--n', String(job.n), '--json'];
    const ch = spawn(process.execPath, args, { cwd: ROOT });
    let out = '';
    let err = '';
    ch.stdout.on('data', (d: Buffer) => (out += d.toString()));
    ch.stderr.on('data', (d: Buffer) => (err += d.toString()));
    ch.on('close', () => {
      const sec = (performance.now() - t0) / 1000;
      const line = out.split('\n').find((l) => l.startsWith('{"summary"'));
      if (!line) return done({ job, checks: [], verdict: 'error', error: (err || out).trim().split('\n').slice(-3).join(' / '), sec });
      const { summary, checks } = JSON.parse(line) as { summary: McSummary; checks: TargetCheck[] };
      const verdict: TargetVerdict = checks.some((c) => c.verdict === 'ng') ? 'ng' : checks.some((c) => c.verdict === 'border') ? 'border' : 'ok';
      done({ job, summary, checks, verdict, sec });
    });
  });
}

/** 並べて回す。終わるたびに 1 行ずつ進み具合を出す */
async function runAll(jobs: Job[], label: string): Promise<Result[]> {
  const queue = [...jobs].sort((a, b) => b.weight * b.n - a.weight * a.n);
  const results: Result[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const job = queue[next++]!;
      const r = await runJob(job);
      results.push(r);
      process.stderr.write(`\r${label} ${results.length}/${queue.length}  `);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, worker));
  process.stderr.write('\n');
  return results;
}

const MARK = { ok: '✔', border: '△', ng: '✖', error: '!' } as const;
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const val = (c: TargetCheck, x: number): string => (c.key === 'deathCountMedian' ? String(x) : pct(x));

function line(r: Result): string {
  const head = `${MARK[r.verdict]} ${r.job.id.padEnd(22)} ${r.job.policy.padEnd(11)} n=${String(r.job.n).padEnd(4)}`;
  if (r.verdict === 'error') return `${head} エラー: ${r.error}`;
  const lim = (c: TargetCheck): string => (Array.isArray(c.limit) ? `∈ [${c.limit.join(', ')}]` : `${c.key.endsWith('Min') ? '≥' : '≤'} ${pct(c.limit)}`);
  return `${head} ${r.checks.map((c) => `${MARK[c.verdict]} ${c.key} ${val(c, c.value)}（${val(c, c.lo)}〜${val(c, c.hi)}）${lim(c)}`).join('  ')}`;
}

const t0 = performance.now();
const { jobs, skipped } = jobsOf();
if (jobs.length === 0) {
  console.error('測るものがありません（--only・--policy の指定を確かめてください）');
  process.exit(1);
}
console.log(`成績を測る: ${jobs.length} 件 × ${N} 回、${JOBS} 並列`);
let results = await runAll(jobs, '測定');

// 境目のものは回数を 4 倍にして測り直す（同じ種の並びを伸ばすので、最初の N 回も含む）
const border = results.filter((r) => r.verdict === 'border');
if (border.length > 0 && !values.quick) {
  console.log(`境目 ${border.length} 件を ${N * 4} 回で測り直す`);
  const again = await runAll(border.map((r) => ({ ...r.job, n: r.job.n * 4 })), '測り直し');
  const key = (j: Job): string => `${j.id}/${j.policy}`;
  const byKey = new Map(again.map((r) => [key(r.job), r]));
  results = results.map((r) => byKey.get(key(r.job)) ?? r);
}

if (values.out) {
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  for (const r of results) writeFileSync(resolve(out, `${r.job.id}__${r.job.policy}.json`), JSON.stringify(r, null, 1));
}

const order = new Map(loadIndex().map((e, i) => [e.id, i]));
results.sort((a, b) => (order.get(a.job.id) ?? 0) - (order.get(b.job.id) ?? 0) || a.job.policy.localeCompare(b.job.policy));
for (const r of results) console.log(line(r));
for (const s of skipped) console.log(`- ${s}: 飛ばした`);
const count = (v: Result['verdict']): number => results.filter((r) => r.verdict === v).length;
console.log(
  `\n合格 ${count('ok')}・境目 ${count('border')}・不合格 ${count('ng')}${count('error') ? `・エラー ${count('error')}` : ''}（${Math.round((performance.now() - t0) / 1000)} 秒）`,
);
if (count('border') > 0) console.log('△ 境目: 揺れの幅（80%）が目標をまたぐ。--n を増やすと、はっきりする');
process.exit(count('ng') + count('error') > 0 ? 1 : 0);

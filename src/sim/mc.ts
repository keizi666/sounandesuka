/**
 * モンテカルロ（docs/14 §4〜5）: 方針ごとに N 回実行して結末の分布を集計し、balanceTargets と比べる。
 * ツール（npm run mc）とエディターの試走（Worker）が使う。
 */
import { deriveSeed } from './core/rng';
import { runHeadless } from './headless';
import type { BalanceTarget, EndingKind, MapRuntime, PolicyName, ScenarioDef } from './types';
import type { Tuning } from './tuning';

export interface McSummary {
  scenarioId: string;
  policy: PolicyName;
  n: number;
  counts: Record<EndingKind, number>;
  deathCauses: Record<string, number>;
  minCore: { p10: number; p50: number; p90: number };
  lostRate: number;
  deathCountMedian: number;
  /** 死亡者数の中央値の揺れの幅（順序統計による区間。BALANCE_Z の幅） */
  deathCountCi: [number, number];
  choices: Record<string, Record<string, number>>;
  msPerRun: number;
}

const KINDS: EndingKind[] = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function runMonteCarlo(
  map: MapRuntime,
  scenario: ScenarioDef,
  policy: PolicyName,
  n: number,
  opts: { seed?: number; tuning?: Tuning; now?: () => number; onProgress?: (i: number) => void } = {},
): McSummary {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<EndingKind, number>;
  const deathCauses: Record<string, number> = {};
  const mins: number[] = [];
  const deaths: number[] = [];
  const choices: Record<string, Record<string, number>> = {};
  let lost = 0;
  const base = opts.seed ?? scenario.seed;
  const t0 = opts.now?.() ?? 0;
  for (let i = 0; i < n; i += 1) {
    const r = runHeadless(map, scenario, { policy, seed: deriveSeed(base, i), tuning: opts.tuning });
    counts[r.ending.kind] += 1;
    const st = r.record!.stats;
    mins.push(st.minCoreC);
    if (st.wasLost) lost += 1;
    let d = 0;
    for (const c of r.world.climbers) {
      if (!c.body.alive) {
        d += 1;
        const cause = c.body.deathCause ?? 'unknown';
        deathCauses[cause] = (deathCauses[cause] ?? 0) + 1;
      }
    }
    deaths.push(d);
    for (const dec of r.world.decisions) {
      const m = (choices[dec.cpId] ??= {});
      m[dec.optionId] = (m[dec.optionId] ?? 0) + 1;
    }
    opts.onProgress?.(i + 1);
  }
  mins.sort((a, b) => a - b);
  deaths.sort((a, b) => a - b);
  const t1 = opts.now?.() ?? 0;
  return {
    scenarioId: scenario.id,
    policy,
    n,
    counts,
    deathCauses,
    minCore: { p10: pct(mins, 0.1), p50: pct(mins, 0.5), p90: pct(mins, 0.9) },
    lostRate: n > 0 ? lost / n : 0,
    deathCountMedian: pct(deaths, 0.5),
    deathCountCi: medianCi(deaths),
    choices,
    msPerRun: n > 0 ? (t1 - t0) / n : 0,
  };
}

/**
 * 判定の揺れの幅に使う z（80% の区間）。回数が少ないと種によって数 % 揺れるので、
 * 区間が目標をまたぐものは「境目」として、はっきり外れたもの（不合格）と分ける（DECISIONS）
 */
export const BALANCE_Z = 1.28;

/** 判定: ok 合格（区間ごと目標の内）・border 境目（区間が目標をまたぐ。回数を増やして測り直す）・ng 不合格（区間ごと目標の外） */
export type TargetVerdict = 'ok' | 'border' | 'ng';

export interface TargetCheck {
  key: string;
  value: number;
  limit: number | [number, number];
  /** 点の値で目標を満たすか */
  ok: boolean;
  /** 揺れの幅（率は Wilson の区間、死亡者数の中央値は順序統計の区間） */
  lo: number;
  hi: number;
  verdict: TargetVerdict;
}

/** 二項の率 k/n の Wilson 区間 */
export function wilson(k: number, n: number, z = BALANCE_Z): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

/** 並べた値の中央値の区間（二項の正規近似による順序統計） */
export function medianCi(sorted: number[], z = BALANCE_Z): [number, number] {
  const n = sorted.length;
  if (n === 0) return [0, 0];
  const half = (z * Math.sqrt(n)) / 2;
  const lo = Math.max(0, Math.floor(n / 2 - half));
  const hi = Math.min(n - 1, Math.ceil(n / 2 + half));
  return [sorted[lo]!, sorted[hi]!];
}

/** 区間 [lo, hi] が [a, b] の内なら ok、まったく重ならなければ ng、またげば border */
function verdictOf(lo: number, hi: number, a: number, b: number): TargetVerdict {
  if (lo >= a && hi <= b) return 'ok';
  if (hi < a || lo > b) return 'ng';
  return 'border';
}

/** balanceTargets と比べる（docs/14 §5） */
export function checkTargets(s: McSummary, t: BalanceTarget | undefined): TargetCheck[] {
  if (!t) return [];
  const n = s.n || 1;
  const c = s.counts;
  const good = (c.SAFE_RETURN + c.SAFE_SHELTER + c.ABORTED) / n;
  const bad = (c.RESCUED_CRITICAL + c.MISSING + c.FATAL) / n;
  const fatal = c.FATAL / n;
  const rescued = (c.RESCUED + c.RESCUED_CRITICAL) / n;
  const out: TargetCheck[] = [];
  const add = (key: string, v: number, lim: number | undefined, isMin: boolean): void => {
    if (lim === undefined) return;
    const [lo, hi] = wilson(Math.round(v * n), n);
    const verdict = isMin ? verdictOf(lo, hi, lim, 1) : verdictOf(lo, hi, 0, lim);
    out.push({ key, value: v, limit: lim, ok: isMin ? v >= lim : v <= lim, lo, hi, verdict });
  };
  const min = (key: string, v: number, lim: number | undefined): void => add(key, v, lim, true);
  const max = (key: string, v: number, lim: number | undefined): void => add(key, v, lim, false);
  min('goodMin', good, t.goodMin);
  max('goodMax', good, t.goodMax);
  min('badMin', bad, t.badMin);
  max('badMax', bad, t.badMax);
  min('fatalMin', fatal, t.fatalMin);
  max('fatalMax', fatal, t.fatalMax);
  min('rescuedMin', rescued, t.rescuedMin);
  max('rescuedMax', rescued, t.rescuedMax);
  min('lostMin', s.lostRate, t.lostMin);
  max('lostMax', s.lostRate, t.lostMax);
  if (t.deathCountMedian) {
    const [a, b] = t.deathCountMedian;
    const [lo, hi] = s.deathCountCi ?? [s.deathCountMedian, s.deathCountMedian];
    out.push({ key: 'deathCountMedian', value: s.deathCountMedian, limit: [a, b], ok: s.deathCountMedian >= a && s.deathCountMedian <= b, lo, hi, verdict: verdictOf(lo, hi, a, b) });
  }
  return out;
}

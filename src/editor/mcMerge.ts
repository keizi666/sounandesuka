/**
 * まとめて試す（docs/18 §6.2）の集計: Worker が返した 1 回ごとの結果を McSummary にまとめる（sim/mc.ts と同じ定義）。
 * balanceTargets の提案もここ。
 */
import type { McSummary } from '../sim/mc';
import type { BalanceTarget, EndingKind, PolicyName } from '../sim/types';
import type { McRun } from '../workers/editorRun.worker';

const KINDS: EndingKind[] = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE', 'RESCUED', 'RESCUED_CRITICAL', 'MISSING', 'FATAL'];

function pct(sorted: number[], p: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function mergeRuns(scenarioId: string, policy: PolicyName, runs: McRun[], ms: number): McSummary {
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<EndingKind, number>;
  const deathCauses: Record<string, number> = {};
  const choices: Record<string, Record<string, number>> = {};
  let lost = 0;
  for (const r of [...runs].sort((a, b) => a.i - b.i)) {
    counts[r.kind] += 1;
    if (r.wasLost) lost += 1;
    for (const c of r.causes) deathCauses[c] = (deathCauses[c] ?? 0) + 1;
    for (const d of r.decisions) {
      const m = (choices[d.cpId] ??= {});
      m[d.optionId] = (m[d.optionId] ?? 0) + 1;
    }
  }
  const mins = runs.map((r) => r.minCoreC).sort((a, b) => a - b);
  const deaths = runs.map((r) => r.deaths).sort((a, b) => a - b);
  const n = runs.length;
  return { scenarioId, policy, n, counts, deathCauses, minCore: { p10: pct(mins, 0.1), p50: pct(mins, 0.5), p90: pct(mins, 0.9) }, lostRate: n ? lost / n : 0, deathCountMedian: pct(deaths, 0.5), choices, msPerRun: n ? ms / n : 0 };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 現在の分布から目標を提案する（推奨は good 率 −5%・fatal +2%、傾向どおりは幅を持たせ、危険は fatal の下限） */
export function suggestTarget(policy: PolicyName, s: McSummary): BalanceTarget {
  const n = s.n || 1;
  const good = (s.counts.SAFE_RETURN + s.counts.SAFE_SHELTER + s.counts.ABORTED) / n;
  const fatal = s.counts.FATAL / n;
  if (policy === 'recommended') return { goodMin: r2(Math.max(0, good - 0.05)), fatalMax: r2(Math.min(1, fatal + 0.02)) };
  if (policy === 'risky') return { fatalMin: r2(Math.max(0, fatal - 0.1)) };
  return { goodMax: r2(Math.min(1, good + 0.1)), fatalMin: r2(Math.max(0, fatal - 0.08)), fatalMax: r2(Math.min(1, fatal + 0.08)) };
}

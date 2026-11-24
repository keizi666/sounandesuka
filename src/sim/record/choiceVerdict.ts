/**
 * 選択の振り返り（ユーザーの指定: 結果の画面で、どれが良かった・悪かった・意味がなかったかを知りたい）。
 * 分岐点の場面から選択肢ごとに乱数を変えて走らせた What-if の結果を比べ、選んだ選択肢を判定する純粋な処理。
 * 悪さ = 結末ごとの重み（tuning.choices.verdictWeight）の平均。差が試算の揺れの幅に収まるなら、差とみなさない。
 */
import type { EndingKind } from '../types';
import type { Tuning } from '../tuning';
import type { WhatIfResult } from './whatif';

/**
 * good 良い判断・fair まずまず・bad 悪い判断・same どれを選んでもほとんど変わらない・
 * late 手遅れ（どれを選んでも変わらず、いちばん良い選択肢でも結末が悪い。それより前の判断で決まっていた。ユーザーの指定）
 */
export type ChoiceVerdict = 'good' | 'fair' | 'bad' | 'same' | 'late';

export interface OptionScore {
  optionId: string;
  /** 悪さの平均（0 が最良、1 が最悪） */
  mean: number;
  /** 平均の標準誤差 */
  se: number;
  /** 無事（途中でやめた・下山・小屋）の割合 */
  safe: number;
  /** 行方不明・死亡の割合 */
  lost: number;
  n: number;
}

export interface ChoiceJudgement {
  verdict: ChoiceVerdict;
  chosen: OptionScore;
  /** いちばん良い選択肢（同じくらい良いものが複数あれば、選んだものを優先） */
  best: OptionScore;
  worst: OptionScore;
  scores: OptionScore[];
}

const SAFE: readonly EndingKind[] = ['ABORTED', 'SAFE_RETURN', 'SAFE_SHELTER'];
const LOST: readonly EndingKind[] = ['MISSING', 'FATAL'];

export function scoreOf(r: WhatIfResult, tuning: Tuning): OptionScore {
  const w = tuning.choices.verdictWeight;
  const n = Math.max(1, r.n);
  let sum = 0;
  let sum2 = 0;
  let safe = 0;
  let lost = 0;
  for (const [k, c] of Object.entries(r.counts) as [EndingKind, number][]) {
    const x = w[k] ?? 1;
    sum += x * c;
    sum2 += x * x * c;
    if (SAFE.includes(k)) safe += c;
    if (LOST.includes(k)) lost += c;
  }
  const mean = sum / n;
  const variance = Math.max(0, sum2 / n - mean * mean);
  return { optionId: r.optionId, mean, se: Math.sqrt(variance / n), safe: safe / n, lost: lost / n, n: r.n };
}

/** 選択肢が 2 つ以上あり、選んだ選択肢の結果があるときだけ判定する（ないときは null） */
export function judgeChoice(results: readonly WhatIfResult[], chosenId: string, tuning: Tuning): ChoiceJudgement | null {
  if (results.length < 2) return null;
  const t = tuning.choices;
  const scores = results.map((r) => scoreOf(r, tuning));
  const chosen = scores.find((s) => s.optionId === chosenId);
  if (!chosen) return null;
  const minMean = Math.min(...scores.map((s) => s.mean));
  // いちばん良いもの: 同じ悪さなら選んだものを優先
  const best = chosen.mean <= minMean ? chosen : scores.reduce((a, b) => (b.mean < a.mean ? b : a));
  const worst = scores.reduce((a, b) => (b.mean > a.mean ? b : a));
  const clearly = (a: OptionScore, b: OptionScore, margin: number): boolean => a.mean - b.mean >= margin && a.mean - b.mean > t.verdictZ * Math.sqrt(a.se * a.se + b.se * b.se);
  let verdict: ChoiceVerdict;
  if (worst.mean - best.mean < t.verdictSameSpread || !clearly(worst, best, t.verdictSameSpread)) verdict = best.mean >= t.verdictLateMean ? 'late' : 'same';
  else if (chosen.mean - best.mean < t.verdictGoodMargin || !clearly(chosen, best, t.verdictGoodMargin)) verdict = 'good';
  else if (clearly(chosen, best, t.verdictBadMargin)) verdict = 'bad';
  else verdict = 'fair';
  // 行方不明・死亡がはっきり多いなら、悪さの平均の差が小さくても「悪い判断」。比べる相手は、全体でも悪くない（平均が選んだもの以下の）選択肢
  let bestOut = best;
  if (verdict !== 'good' && verdict !== 'bad') {
    const safer = scores.filter((s) => s.mean <= chosen.mean && s !== chosen).reduce<OptionScore | null>((a, b) => (a === null || b.lost < a.lost ? b : a), null);
    if (safer) {
      const d = chosen.lost - safer.lost;
      const se = Math.sqrt((chosen.lost * (1 - chosen.lost)) / Math.max(1, chosen.n) + (safer.lost * (1 - safer.lost)) / Math.max(1, safer.n));
      if (d >= t.verdictBadLost && d > t.verdictZ * se) {
        verdict = 'bad';
        bestOut = safer;
      }
    }
  }
  return { verdict, chosen, best: bestOut, worst, scores };
}

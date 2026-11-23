/**
 * 結果の画面の「選択の振り返り」（ユーザーの指定: どれが良かった・悪かった・意味がなかったかを知りたい）。
 * 分岐点ごとに、その場面から選べた選択肢を What-if で試算し（whatIfPool）、選んだ選択肢を判定して（choiceVerdict）、
 * 判定・数字・選択肢の意味（シナリオの explain、汎用分岐点は ja.ts、なければ推奨・危険の札から）を出す。
 */
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { fill } from '../i18n/format';
import { judgeChoice, type ChoiceJudgement } from '../sim/record/choiceVerdict';
import { evaluateOptions, findChoicePoint } from '../sim/scenario/choices';
import { TUNING } from '../sim/tuning';
import type { ChoiceOptionDef, StaticContext, World } from '../sim/types';
import { el } from './dom';
import { optionLabel, type SimResult } from './simScreen';
import { whatIfFor, WHATIF_N } from './whatIfPool';

const pct = (x: number): number => Math.round(x * 100);

/** 選択肢の意味: シナリオに書いた explain → 汎用分岐点の文 → 推奨・危険の札 */
export function optionMeaning(cpId: string, opt: ChoiceOptionDef | undefined): string {
  if (opt?.explain) return opt.explain;
  if (cpId.startsWith('generic:')) {
    const g = JA.generic[cpId.slice(8)]?.explain?.[opt?.id ?? ''];
    if (g) return g;
  }
  if (opt?.tags?.includes('recommended')) return JA.choiceReview.tagRecommended;
  if (opt?.tags?.includes('risky')) return JA.choiceReview.tagRisky;
  return '';
}

/** 判定の文（数字入り） */
function verdictText(loaded: LoadedScenario, cpId: string, j: ChoiceJudgement): string {
  const R = JA.choiceReview;
  const best = optionLabel(loaded, cpId, j.best.optionId);
  if (j.verdict === 'good') return R.good;
  if (j.verdict === 'fair') return fill(R.fair, { best, a: pct(j.chosen.safe), b: pct(j.best.safe) });
  if (j.verdict === 'bad') return fill(R.bad, { best, a: pct(j.chosen.safe), b: pct(j.best.safe), c: pct(j.chosen.lost), d: pct(j.best.lost) });
  const safes = j.scores.map((s) => pct(s.safe));
  const lo = Math.min(...safes);
  const hi = Math.max(...safes);
  return fill(R.same, { range: lo === hi ? `${lo}%` : `${lo}〜${hi}%` });
}

export interface ReviewItem {
  /** 判定の札（分岐の行の右） */
  badge: HTMLElement;
  /** 判定の文・数字・意味（分岐の行の下） */
  body: HTMLElement;
  /** 試算が終わったら（成功でも失敗でも）解ける */
  done: Promise<void>;
}

/** 1 つの分岐での選択の振り返り。snapshot はその分岐点の場面の写し（なければ試算しない） */
export function reviewDecision(loaded: LoadedScenario, result: SimResult, ctx: StaticContext, d: { cpId: string; optionId: string }, snapshot: World | undefined): ReviewItem {
  const R = JA.choiceReview;
  const badge = el('span', { class: 'cr-badge wait' }, R.computing);
  const body = el('div', { class: 'cr-body' });
  const found = findChoicePoint(ctx, d.cpId);
  const options = snapshot && found ? evaluateOptions(snapshot, { ...ctx }, found.cp, found.key).available.map((a) => a.option) : [];
  const chosenOpt = options.find((o) => o.id === d.optionId) ?? found?.cp.options.find((o) => o.id === d.optionId);
  const meaning = optionMeaning(d.cpId, chosenOpt);
  const meaningEl = meaning ? el('p', { class: 'cr-meaning' }, [el('strong', {}, `${R.meaning}: `), meaning]) : null;
  if (!snapshot || options.length < 2 || !options.some((o) => o.id === d.optionId)) {
    badge.remove();
    body.replaceChildren(...(meaningEl ? [meaningEl] : []));
    return { badge: el('span'), body, done: Promise.resolve() };
  }
  body.replaceChildren(...(meaningEl ? [meaningEl] : []));
  const done = Promise.all(options.map((o) => whatIfFor(loaded, result, d.cpId, o.id, snapshot)))
    .then((results) => {
      const j = judgeChoice(results, d.optionId, TUNING);
      if (!j) {
        badge.remove();
        return;
      }
      badge.className = `cr-badge v-${j.verdict}`;
      badge.textContent = R.verdict[j.verdict] ?? j.verdict;
      const bestOpt = options.find((o) => o.id === j.best.optionId);
      const bestMeaning = j.verdict === 'bad' || j.verdict === 'fair' ? optionMeaning(d.cpId, bestOpt) : '';
      const parts: (HTMLElement | null)[] = [
        el('p', { class: `cr-verdict v-${j.verdict}` }, verdictText(loaded, d.cpId, j)),
        el('p', { class: 'cr-numbers' }, fill(R.numbers, { safe: pct(j.chosen.safe), lost: pct(j.chosen.lost) })),
        meaningEl,
        // 一般の考え方と、この場面での試算が食い違うとき（危険を取る判断がたまたま良かった・安全側の判断が裏目に出た）
        chosenOpt?.tags?.includes('risky') && j.verdict === 'good' ? el('p', { class: 'cr-caveat' }, R.riskyButGood) : null,
        chosenOpt?.tags?.includes('recommended') && (j.verdict === 'bad' || j.verdict === 'fair') ? el('p', { class: 'cr-caveat' }, R.safeButWorse) : null,
        bestMeaning ? el('p', { class: 'cr-meaning' }, [el('strong', {}, `${fill(R.bestMeaning, { best: optionLabel(loaded, d.cpId, j.best.optionId) })}: `), bestMeaning]) : null,
      ];
      body.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
    })
    .catch((e: unknown) => {
      if (String(e).includes('canceled')) return;
      badge.className = 'cr-badge wait';
      badge.textContent = R.failed;
    });
  return { badge, body, done };
}

/** 振り返りの説明の一文（何回ずつ試算したか） */
export function reviewLead(): string {
  return fill(JA.choiceReview.lead, { n: WHATIF_N });
}

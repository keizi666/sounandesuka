/**
 * 結果の画面の「選択の振り返り」（ユーザーの指定: どれが良かった・悪かった・意味がなかったかを知りたい）。
 * 分岐点ごとに、その場面から選べた選択肢を What-if で試算し（whatIfPool）、選んだ選択肢を判定して（choiceVerdict）、
 * 判定・数字・選択肢の意味（シナリオの explain、汎用分岐点は ja.ts、なければ推奨・危険の札から）を出す。
 */
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { fill, formatDateTime } from '../i18n/format';
import { parseTimeRef } from '../sim/core/clock';
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

/** 条件の中で、旗 flag を「立っている」（pos）・「立っていない」（neg）として使っているか */
function flagUse(cond: unknown, flag: string, negated = false, out = { pos: false, neg: false }): { pos: boolean; neg: boolean } {
  if (Array.isArray(cond)) for (const c of cond) flagUse(c, flag, negated, out);
  else if (cond && typeof cond === 'object') {
    const o = cond as Record<string, unknown>;
    if (o['flag'] === flag) {
      if (negated) out.neg = true;
      else out.pos = true;
    }
    for (const [k, v] of Object.entries(o)) if (k !== 'flag') flagUse(v, flag, negated !== (k === 'not'), out);
  }
  return out;
}

/**
 * もしもの備えの分岐点（ユーザーの指定: 家族に行き先を伝えると、行方不明になったときに見つかりやすい。その大切さを強調する）。
 * 選択肢の旗のうち、捜索の手がかり（plan.searchLeads の when）に使われているものがあれば、その旗と、立てる選択肢を返す
 */
function searchPrep(loaded: LoadedScenario, options: readonly ChoiceOptionDef[]): { flag: string; setter: ChoiceOptionDef } | null {
  const leads = loaded.scenario.plan.searchLeads ?? [];
  if (leads.length === 0) return null;
  for (const o of options) for (const flag of o.flags ?? []) if (leads.some((l) => l.when !== undefined && flagUse(l.when, flag).pos !== flagUse(l.when, flag).neg)) return { flag, setter: o };
  return null;
}

/** 「もし帰れなかったら」: 旗を立てたとき・立てなかったときの、捜索の始まり方（手がかりの文を時刻順に） */
function searchPrepBlock(loaded: LoadedScenario, cpId: string, prep: { flag: string; setter: ChoiceOptionDef }): HTMLElement {
  const R = JA.choiceReview;
  const s = loaded.scenario;
  const leads = [...(s.plan.searchLeads ?? [])].filter((l) => l.text).sort((a, b) => parseTimeRef(a.at) - parseTimeRef(b.at));
  const list = (pos: boolean): HTMLElement =>
    el('ol', {}, leads.filter((l) => {
      const u = flagUse(l.when, prep.flag);
      return l.when === undefined || (pos ? !u.neg : !u.pos);
    }).map((l) => el('li', {}, [el('time', {}, formatDateTime(s, parseTimeRef(l.at))), ' ', l.text ?? ''])));
  return el('div', { class: 'cr-prep' }, [
    el('p', { class: 'cr-prep-title' }, R.prepTitle),
    el('div', { class: 'cr-prep-cols' }, [
      el('div', { class: 'cr-prep-col yes' }, [el('strong', {}, fill(R.prepYes, { label: optionLabel(loaded, cpId, prep.setter.id) })), list(true)]),
      el('div', { class: 'cr-prep-col no' }, [el('strong', {}, R.prepNo), list(false)]),
    ]),
  ]);
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
      // もしもの備え（行き先を伝える など）は、帰れた回では差が出ない。差が出ないときは「もしもの備え」として、帰れなくなったときの違いを見せる
      const prep = searchPrep(loaded, options);
      const prepSame = prep !== null && j.verdict === 'same';
      badge.className = prepSame ? 'cr-badge v-prep' : `cr-badge v-${j.verdict}`;
      badge.textContent = prepSame ? R.verdict['prep'] ?? '' : (R.verdict[j.verdict] ?? j.verdict);
      const bestOpt = options.find((o) => o.id === j.best.optionId);
      const bestMeaning = j.verdict === 'bad' || j.verdict === 'fair' ? optionMeaning(d.cpId, bestOpt) : '';
      const parts: (HTMLElement | null)[] = [
        prepSame
          ? el('p', { class: 'cr-verdict v-prep' }, (chosenOpt?.flags ?? []).includes(prep.flag) ? R.prepGood : fill(R.prepBad, { label: optionLabel(loaded, d.cpId, prep.setter.id) }))
          : el('p', { class: `cr-verdict v-${j.verdict}` }, verdictText(loaded, d.cpId, j)),
        el('p', { class: 'cr-numbers' }, fill(R.numbers, { safe: pct(j.chosen.safe), lost: pct(j.chosen.lost) })),
        meaningEl,
        prep ? searchPrepBlock(loaded, d.cpId, prep) : null,
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

/**
 * 結果の画面の選択の振り返りに、分岐ごとの「みんなの選択」を添える（ユーザーの指定: リピーターを増やす）。
 * 「みんなの遭難記録」に載った記録の、自分で選んだ選択（自動で決まったものは数えない）の割合。選ぶ前には見せない（判断が引きずられないように）。
 * 分岐の鍵は cpId、選択肢の鍵は optionId。ID を入れる前の古い記録は、分岐の題と選んだ文で数える（サーバーは "t:" と "l:" を付けて返す）。
 * 週替わりのお題で遊んだときは、その週の記録だけで数える。
 */
import type { LoadedScenario } from '../../app/data';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ChoicesResponse } from '../../net/communityTypes';
import { findChoicePoint } from '../../sim/scenario/choices';
import type { StaticContext } from '../../sim/types';
import { el } from '../dom';
import { optionLabel } from '../simCommon';

/** これより少ない件数の分岐には出さない */
const MIN_TOTAL = 3;
/** 名前を出す選択肢の数（残りは「そのほか」） */
const TOP = 3;

export interface ShareSlot {
  cpId: string;
  optionId: string;
  /** 割合を入れる場所（読めるまで隠れている） */
  el: HTMLElement;
}

/** 分岐の題（載せた記録の題と同じ決め方） */
function cpTitle(loaded: LoadedScenario, cpId: string): string {
  const s = loaded.scenario;
  return cpId.startsWith('generic:') ? (JA.generic[cpId.slice(8)]?.title ?? cpId) : (s.choices.find((c) => c.id === cpId)?.title ?? cpId);
}

/** 1 つの分岐の割合の行 */
function render(slot: ShareSlot, loaded: LoadedScenario, ctx: StaticContext, res: ChoicesResponse): void {
  const S = JA.social;
  const entries = [res.cps[slot.cpId], res.cps[`t:${cpTitle(loaded, slot.cpId)}`]].filter((x) => x !== undefined);
  const total = entries.reduce((a, x) => a + x.total, 0);
  if (total < MIN_TOTAL) return;
  const optIds = findChoicePoint(ctx, slot.cpId)?.cp.options.map((o) => o.id) ?? [slot.optionId];
  if (!optIds.includes(slot.optionId)) optIds.push(slot.optionId);
  const rows = optIds
    .map((id) => {
      const label = optionLabel(loaded, slot.cpId, id);
      const n = entries.reduce((a, x) => a + (x.opts[id] ?? 0) + (x.opts[`l:${label}`] ?? 0), 0);
      return { id, label, n };
    })
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const pct = (n: number): number => Math.round((n / total) * 100);
  const shown = rows.slice(0, TOP);
  // 自分の選択は、上位に入っていなくても出す
  const mine = rows.find((r) => r.id === slot.optionId);
  if (mine && !shown.includes(mine)) shown.push(mine);
  const rest = total - shown.reduce((a, r) => a + r.n, 0);
  const bar = el('span', { class: 'cs-bar', 'aria-hidden': 'true' }, shown.map((r) => el('i', { class: r.id === slot.optionId ? 'me' : '', style: `width:${(r.n / total) * 100}%` })));
  const parts = shown.map((r) => el('span', { class: `cs-opt${r.id === slot.optionId ? ' me' : ''}` }, [`${r.label} ${pct(r.n)}%`, r.id === slot.optionId ? el('small', {}, `（${S.choicesYou}）`) : null]));
  if (rest > 0) parts.push(el('span', { class: 'cs-opt' }, `${S.choicesOther} ${pct(rest)}%`));
  slot.el.replaceChildren(el('strong', {}, fill(S.choicesLine, { n: total })), bar, el('span', { class: 'cs-opts' }, parts));
  slot.el.hidden = false;
}

/** みんなの選択を読み、それぞれの場所に入れる（公開のシナリオだけ。読めなければ何も出さない） */
export function fillChoiceShares(loaded: LoadedScenario, ctx: StaticContext, slots: readonly ShareSlot[]): void {
  if (!loaded.listed || slots.length === 0) return;
  void communityApi
    .choices(loaded.scenario.id, loaded.week ?? 0)
    .then((res) => {
      for (const s of slots) render(s, loaded, ctx, res);
    })
    .catch(() => undefined);
}

/** 分岐の行に入れる、空の場所 */
export function shareSlot(cpId: string, optionId: string): ShareSlot {
  return { cpId, optionId, el: el('p', { class: 'cs-line', hidden: true }) };
}

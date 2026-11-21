/**
 * これまでのあらすじ（ユーザーの指定: 途中の場面のリンクから始めると、ここまでの状況が分からない）。
 * 場面の URL・みんなの遭難記録の「この分岐から」で作り直したとき、最初に出す。
 * 作り直しで出たログのうち、分岐で選んだこと・大きな出来事（重要な行）を時刻の順に並べ、いま一人ひとりがどうしているかを添える
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { ClimberState, ScenarioDef } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { icon } from './icons';
import type { LogLine } from './simHud';

/** あらすじに並べる行の上限（多ければ古い方を省く） */
const MAX_LINES = 36;

export interface SynopsisInput {
  scenario: ScenarioDef;
  lines: readonly LogLine[];
  climbers: readonly ClimberState[];
  /** 時刻の表示（D1 05:30 など） */
  time: (tMin: number) => string;
  nowMin: number;
  onClose: () => void;
}

export function openSynopsis(o: SynopsisInput): () => void {
  const S = JA.synopsis;
  // 分岐点が出た行（「この場面へ」の付く行）は、選んだ行と重なるので除く。セリフ・心の声も除く
  const all = o.lines.filter((l) => l.important && l.jumpTo === undefined && l.kind !== 'speech' && l.kind !== 'thought');
  const skipped = Math.max(0, all.length - MAX_LINES);
  const lines = all.slice(skipped);
  const party = o.climbers.map((c) => {
    const st = c.body.alive ? (JA.labels.state[c.state] ?? c.state) : JA.labels.state['DEAD'] ?? '';
    return el('li', { class: `syn-who${c.body.alive ? '' : ' dead'}` }, [avatar(c.def, 28), el('strong', {}, c.def.name), el('span', {}, c.offMap ? `${st}・${c.offMap}` : st)]);
  });
  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    dlg.close();
    dlg.remove();
    o.onClose();
  };
  const dlg = el('dialog', { class: 'synopsis', 'aria-label': S.title }, [
    el('header', {}, [el('h2', {}, [icon('history'), S.title]), el('span', { class: 'syn-now' }, fill(S.now, { time: o.time(o.nowMin) }))]),
    el('p', { class: 'syn-lead' }, fill(S.lead, { title: o.scenario.title })),
    el('ol', { class: 'syn-list' }, [
      skipped > 0 ? el('li', { class: 'syn-skip' }, fill(S.skipped, { n: skipped })) : null,
      ...lines.map((l) => el('li', { class: l.text.startsWith('◆') ? 'syn-choice' : '' }, [el('time', {}, o.time(l.tMin)), el('span', {}, l.text)])),
    ]),
    el('h3', {}, S.party),
    el('ul', { class: 'syn-party' }, party),
    el('div', { class: 'syn-actions' }, [el('button', { class: 'primary big', type: 'button', onclick: close }, [S.go, icon('chevronRight')])]),
  ]);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dlg);
  dlg.showModal();
  // 最新の出来事が見えるよう、いちばん下へ
  const list = dlg.querySelector('.syn-list');
  if (list) list.scrollTop = list.scrollHeight;
  return close;
}

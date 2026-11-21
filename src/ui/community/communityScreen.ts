/**
 * 「みんなの遭難記録」の一覧（docs/20_community.md §1）。シナリオと結末で絞り込み、カードを開くと詳細へ。
 * 絞り込みは画面を離れても覚えておく（詳細から戻ったとき用）。
 */
import type { AppContext } from '../../app/App';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi, refreshProfile } from '../../net/communityApi';
import type { ListResponse, RunSummary } from '../../net/communityTypes';
import { loadProfile } from '../../net/profile';
import { ENDING_SEVERITY } from '../../sim/scenario/endings';
import { el } from '../dom';
import { icon } from '../icons';
import { cIcon, dateText, errorText, hm, sexAgeText, userAvatar } from './common';
import { ENDING_COLOR } from './endingColors';
import { openProfileDialog } from './profileDialog';

const PAGE = 24;
const state: { scenario: string; ending: string; user: number; userName: string; scrollY: number } = { scenario: '', ending: '', user: 0, userName: '', scrollY: 0 };

/** 利用者の記録だけを見る（詳細の画面から） */
export function showUserRuns(app: AppContext, id: number, name: string): void {
  Object.assign(state, { user: id, userName: name, scenario: '', ending: '', scrollY: 0 });
  app.go({ name: 'community' });
}

/** 戻ってきたときにスクロールの位置を戻すため */
export function rememberCommunityScroll(): void {
  state.scrollY = window.scrollY;
}

function runCard(app: AppContext, r: RunSummary): HTMLElement {
  const C = JA.community;
  const color = ENDING_COLOR[r.ending] ?? '#6b7280';
  const open = (): void => {
    rememberCommunityScroll();
    app.go({ name: 'communityRun', id: r.id });
  };
  return el('article', { class: 'cm-card', style: `--end:${color}`, role: 'link', tabindex: 0, onclick: open, onkeydown: (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') open();
  } }, [
    el('div', { class: 'cm-card-user' }, [
      userAvatar(r.user, 44),
      el('span', { class: 'cm-card-name' }, [el('strong', {}, r.user.nickname), el('small', {}, [sexAgeText(r.user), sexAgeText(r.user) ? ' ・ ' : '', dateText(r.createdAt)])]),
      r.mine ? el('span', { class: 'cm-mine' }, C.mine) : null,
    ]),
    el('div', { class: 'cm-card-scn' }, [icon('landscape'), el('span', {}, r.scenarioTitle)]),
    el('div', { class: 'cm-card-end' }, [el('span', { class: 'cm-end-badge' }, r.endingTitle || (JA.endings[r.ending]?.title ?? r.ending)), r.difficulty ? el('span', { class: `df-tag df-${r.difficulty}` }, JA.difficulty.label[r.difficulty] ?? r.difficulty) : null, r.conditions ? el('span', { class: 'cm-tag' }, C.conditionsTried) : null]),
    el('div', { class: 'cm-card-facts' }, [
      el('span', {}, [icon('timer'), hm(r.durationMin)]),
      el('span', {}, [icon('thermostat'), `${r.minCoreC.toFixed(1)}℃`]),
      el('span', {}, [icon('route'), `${(r.distanceM / 1000).toFixed(1)} km`]),
      el('span', {}, [icon('callSplit'), `${r.decisions.length}`]),
    ]),
    r.comment ? el('p', { class: 'cm-card-comment' }, r.comment) : null,
  ]);
}

/** 結末の割合の帯 */
function distribution(counts: Record<string, number>, total: number, onPick: (k: string) => void, cur: string): HTMLElement {
  const kinds = Object.keys(counts).sort((a, b) => (ENDING_SEVERITY[a as keyof typeof ENDING_SEVERITY] ?? 9) - (ENDING_SEVERITY[b as keyof typeof ENDING_SEVERITY] ?? 9));
  const sum = Math.max(1, kinds.reduce((s, k) => s + (counts[k] ?? 0), 0));
  return el('div', { class: 'cm-dist' }, [
    el('div', { class: 'cm-dist-bar', role: 'img', 'aria-label': kinds.map((k) => `${JA.endings[k]?.title ?? k} ${counts[k]}`).join('、') }, kinds.map((k) => el('span', { style: `flex:${counts[k] ?? 0};background:${ENDING_COLOR[k] ?? '#6b7280'}` }))),
    el('div', { class: 'cm-dist-chips' }, [
      el('button', { type: 'button', class: cur === '' ? 'on' : '', onclick: () => onPick('') }, [JA.community.allEndings, el('small', {}, `${sum}`)]),
      ...kinds.map((k) => el('button', { type: 'button', class: cur === k ? 'on' : '', style: `--end:${ENDING_COLOR[k] ?? '#6b7280'}`, onclick: () => onPick(k) }, [el('i', {}), JA.endings[k]?.title ?? k, el('small', {}, `${counts[k]} ・ ${Math.round(((counts[k] ?? 0) / sum) * 100)}%`)])),
    ]),
  ]);
}

export function showCommunity(app: AppContext): () => void {
  const C = JA.community;
  let gone = false;
  let offset = 0;
  const profBtn = el('button', { class: 'cap cm-prof-cap', type: 'button' });
  const paintProf = (): void => {
    const p = loadProfile();
    profBtn.replaceChildren(...(p ? [userAvatar(p.user, 26), el('span', { class: 'cm-cap-t' }, p.user.nickname)] : [cIcon('personEdit'), el('span', { class: 'cm-cap-t' }, C.makeProfile)]));
  };
  profBtn.addEventListener('click', () => openProfileDialog(() => {
    paintProf();
    reload();
  }));
  paintProf();
  void refreshProfile().then((changed) => changed && !gone && paintProf());

  const select = el('select', { class: 'cm-select', 'aria-label': C.scenarioLabel }) as HTMLSelectElement;
  select.addEventListener('change', () => {
    state.scenario = select.value;
    state.ending = '';
    reload();
  });
  const distBox = el('div');
  const userChip = el('div', { class: 'cm-userchip' });
  const totalEl = el('span', { class: 'cm-total' });
  const grid = el('div', { class: 'cm-grid' });
  const more = el('button', { class: 'cm-more', type: 'button', hidden: true, onclick: () => void page(false) }, C.more);
  const msg = el('p', { class: 'cm-msg' }, C.loading);

  const paintFilters = (res: ListResponse): void => {
    const opts = res.scenarios.some((x) => x.id === state.scenario) || state.scenario === '' ? res.scenarios : [...res.scenarios, { id: state.scenario, title: state.scenario, n: 0 }];
    select.replaceChildren(el('option', { value: '' }, C.allScenarios), ...opts.map((x) => el('option', { value: x.id, selected: x.id === state.scenario }, `${x.title}（${x.n}）`)));
    distBox.replaceChildren(Object.keys(res.counts).length > 0 ? distribution(res.counts, res.total, (k) => {
      state.ending = k;
      reload();
    }, state.ending) : '');
    totalEl.textContent = fill(C.total, { n: res.total });
    userChip.replaceChildren(...(state.user > 0 ? [el('span', {}, fill(C.userRuns, { name: state.userName })), el('button', { type: 'button', class: 'small', onclick: () => {
      state.user = 0;
      reload();
    } }, [icon('close'), C.clearUser])] : []));
    userChip.hidden = state.user === 0;
  };

  const page = async (first: boolean): Promise<void> => {
    if (first) offset = 0;
    more.disabled = true;
    try {
      const res = await communityApi.list({ scenario: state.scenario, ending: state.ending, user: state.user, offset, limit: PAGE });
      if (gone) return;
      if (first) {
        grid.replaceChildren();
        paintFilters(res);
      }
      grid.append(...res.items.map((r) => runCard(app, r)));
      offset += res.items.length;
      more.hidden = offset >= res.total;
      msg.textContent = res.total === 0 ? (state.scenario || state.ending || state.user ? C.emptyFilter : C.empty) : '';
      msg.hidden = res.total > 0;
      if (first && state.scrollY > 0) {
        window.scrollTo(0, state.scrollY);
        state.scrollY = 0;
      }
    } catch (e) {
      if (gone) return;
      msg.hidden = false;
      msg.textContent = errorText(e);
    } finally {
      more.disabled = false;
    }
  };
  const reload = (): void => void page(true);

  app.root.append(
    el('main', { class: 'cm-screen' }, [
      el('header', { class: 'cm-bar' }, [
        el('div', { class: 'cm-bar-in' }, [
          el('button', { class: 'cap', type: 'button', onclick: () => app.go({ name: 'select' }) }, [cIcon('arrowBack'), el('span', { class: 'cm-cap-t' }, C.back)]),
          el('h1', {}, [cIcon('forum'), C.title]),
          profBtn,
        ]),
      ]),
      el('div', { class: 'cm-wrap' }, [
        el('p', { class: 'cm-lead' }, C.lead),
        el('div', { class: 'cm-filters' }, [select, totalEl]),
        userChip,
        distBox,
        msg,
        grid,
        more,
        el('p', { class: 'note' }, JA.disclaimer.endingNote),
      ]),
    ]),
  );
  reload();
  return () => {
    gone = true;
  };
}

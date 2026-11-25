/**
 * トップの「今週のお題」（ユーザーの指定: リピーターを増やす。src/app/weekly.ts）。
 * 今週のシナリオと日付、参加人数と無事に終えた割合（載せた記録だけ）、「挑戦する」。先週のお題の結果も添える。
 * 遊んでいないシナリオは、題名とテーマを伏せる一覧と同じく、山の名前だけを出す。
 */
import type { AppContext } from '../../app/App';
import { loadEntry } from '../../app/data';
import { playCounts } from '../../app/playStats';
import { weekOf, weekRange, weekSeed, weeklyPick } from '../../app/weekly';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ScenarioIndexEntry } from '../../sim/types';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { progressTo, showLoading } from '../loading';
import { mountainName } from '../spoiler';
import { endingShares } from './stats';

/** 遊んだことがあれば題名、なければ山の名前 */
function nameOf(e: ScenarioIndexEntry): string {
  if ((playCounts()[e.id] ?? 0) > 0) return e.title;
  const { area, main } = mountainName(e.region);
  return area ? `${area}・${main}` : main;
}

export function weeklyBanner(app: AppContext, index: readonly ScenarioIndexEntry[]): HTMLElement | null {
  const S = JA.social;
  const week = weekOf(Date.now());
  const e = weeklyPick(index, week);
  if (!e) return null;
  const last = weeklyPick(index, week - 1);
  const range = weekRange(week);
  const stats = el('p', { class: 'wk-stats' }, '');
  const lastLine = last ? el('p', { class: 'wk-last' }, fill(S.weeklyLastNone, { title: nameOf(last) })) : null;
  let busy = false;
  const go = el('button', { class: 'primary wk-go', type: 'button', tabindex: -1 }, [icon('playArrow'), S.weeklyGo]);
  /** 挑戦する（カード全体を押しても開く。ユーザーの指定） */
  const start = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    const ld = showLoading(JA.ui.loadingTitle);
    try {
      const loaded = await loadEntry(e, progressTo(ld, { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain }));
      ld.done();
      app.go({ name: 'briefing', loaded: { ...loaded, listed: true, week, seed: weekSeed(week) } });
    } catch (err) {
      ld.done();
      busy = false;
      toast(String(err), 6000);
    }
  };
  // 参加人数と無事に終えた割合（読めなければ出さない）
  void communityApi
    .stats(e.id, week)
    .then((r) => {
      const st = r.scenarios.find((x) => x.id === e.id);
      stats.textContent = st && st.n > 0 ? fill(S.weeklyStats, { players: st.players, safe: endingShares(st).safe }) : S.weeklyNone;
    })
    .catch(() => stats.remove());
  if (last && lastLine)
    void communityApi
      .stats(last.id, week - 1)
      .then((r) => {
        const st = r.scenarios.find((x) => x.id === last.id);
        if (st && st.n > 0) lastLine.textContent = fill(S.weeklyLast, { title: nameOf(last), players: st.players, safe: endingShares(st).safe });
      })
      .catch(() => undefined);
  return el('section', {
    class: 'wk-banner',
    role: 'button',
    tabindex: 0,
    'aria-label': `${S.weeklyTitle}: ${nameOf(e)}（${S.weeklyGo}）`,
    onclick: () => void start(),
    onkeydown: (ev: Event) => {
      const k = (ev as KeyboardEvent).key;
      if (k !== 'Enter' && k !== ' ') return;
      ev.preventDefault();
      void start();
    },
  }, [
    el('div', { class: 'wk-icon' }, icon('campaign')),
    el('div', { class: 'wk-main' }, [
      el('p', { class: 'wk-kicker' }, [S.weeklyTitle, el('span', {}, fill(S.weeklyRange, range))]),
      el('h2', {}, nameOf(e)),
      el('p', { class: 'wk-lead' }, S.weeklyLead),
      stats,
      lastLine,
    ]),
    go,
  ]);
}

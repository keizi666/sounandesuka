/**
 * トップの「シナリオを選ぶ」の絞り込み（ユーザーの指定: 地域名・季節・未プレイ・単独・お気に入り。前の「お気に入りだけ」に代わる）。
 * 地域は地域名の「・」か空白の前（奥多摩・北アルプス・富士山 など。北八ヶ岳は八ヶ岳、日高山脈は北海道にまとめる）。
 * テーマでは絞らない（遊んでいないカードはテーマを伏せているため）。選んだ条件は端末に覚える。
 */
import { currentSeason } from '../app/season';
import { JA } from '../i18n/ja';
import type { ScenarioIndexEntry } from '../sim/types';
import { el } from './dom';
import { icon, type IconName } from './icons';

const KEY = 'hks.v1.selFilter';
/** 前の「お気に入りだけ」の覚え（あれば引き継ぐ） */
const OLD_FAV_KEY = 'hks.v1.favOnly';
const AREA_ALIAS: Record<string, string> = { 北八ヶ岳: '八ヶ岳', 日高山脈: '北海道' };
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

export interface FilterState {
  region: string;
  season: string;
  unplayed: boolean;
  solo: boolean;
  fav: boolean;
}

/** 一覧の地域（まとめた名前） */
export function areaOf(e: ScenarioIndexEntry): string {
  const name = (e.region?.real ? e.region.name : JA.filter.hakoniwa).replace(/（[^）]*）/g, '').trim();
  const head = name.split(/[・\s]/)[0] ?? name;
  return AREA_ALIAS[head] ?? head;
}

function load(): FilterState {
  const def: FilterState = { region: '', season: '', unplayed: false, solo: false, fav: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<FilterState>) };
    if (localStorage.getItem(OLD_FAV_KEY) === '1') return { ...def, fav: true };
  } catch {
    // 読めなければ条件なし
  }
  return def;
}

function save(s: FilterState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 覚えられなくても絞り込める
  }
}

export interface FilterBar {
  el: HTMLElement;
  state: FilterState;
  /** 条件に合うか。party は人数（シナリオ本体を読むまで分からなければ undefined） */
  matches(e: ScenarioIndexEntry, opts: { plays: number; fav: boolean; party: number | undefined }): boolean;
  active(): boolean;
}

export function createFilterBar(index: readonly ScenarioIndexEntry[], onChange: () => void): FilterBar {
  const F = JA.filter;
  const state = load();
  // 地域は一覧に出てくる順（件数つき）
  const areas = new Map<string, number>();
  for (const e of index) areas.set(areaOf(e), (areas.get(areaOf(e)) ?? 0) + 1);
  if (state.region && !areas.has(state.region)) state.region = '';
  const now = currentSeason();
  const region = el('select', { class: 'sf-select', 'aria-label': F.region }, [
    el('option', { value: '' }, `${F.region}: ${F.all}`),
    ...[...areas].map(([a, n]) => el('option', { value: a }, `${a}（${n}）`)),
  ]) as HTMLSelectElement;
  const season = el('select', { class: 'sf-select', 'aria-label': F.season }, [
    el('option', { value: '' }, `${F.season}: ${F.all}`),
    ...SEASONS.map((s) => el('option', { value: s }, `${JA.labels.season[s] ?? s}${s === now ? F.now : ''}`)),
  ]) as HTMLSelectElement;
  region.value = state.region;
  season.value = state.season;
  const toggle = (key: 'unplayed' | 'solo' | 'fav', ic: IconName, label: string): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: `sf-toggle sf-${key}` }, [icon(ic), label]) as HTMLButtonElement;
    const paint = (): void => {
      b.classList.toggle('on', state[key]);
      b.setAttribute('aria-pressed', String(state[key]));
    };
    b.addEventListener('click', () => {
      state[key] = !state[key];
      paint();
      changed();
    });
    paint();
    return b;
  };
  const clear = el('button', { type: 'button', class: 'sf-clear', title: F.clear, 'aria-label': F.clear }, [icon('close'), F.clear]) as HTMLButtonElement;
  const toggles = [toggle('unplayed', 'hiking', F.unplayed), toggle('solo', 'person', F.solo), toggle('fav', 'favorite', F.fav)];
  const bar: FilterBar = {
    el: el('div', { class: 'sf-bar', role: 'group', 'aria-label': F.title }, [region, season, ...toggles, clear]),
    state,
    matches(e, o) {
      if (state.region && areaOf(e) !== state.region) return false;
      if (state.season && e.season !== state.season) return false;
      if (state.unplayed && o.plays > 0) return false;
      if (state.fav && !o.fav) return false;
      if (state.solo && o.party !== 1) return false;
      return true;
    },
    active: () => !!state.region || !!state.season || state.unplayed || state.solo || state.fav,
  };
  function changed(): void {
    clear.hidden = !bar.active();
    save(state);
    onChange();
  }
  region.addEventListener('change', () => ((state.region = region.value), changed()));
  season.addEventListener('change', () => ((state.season = season.value), changed()));
  clear.addEventListener('click', () => {
    Object.assign(state, { region: '', season: '', unplayed: false, solo: false, fav: false });
    region.value = '';
    season.value = '';
    for (const t of toggles) {
      t.classList.remove('on');
      t.setAttribute('aria-pressed', 'false');
    }
    changed();
  });
  clear.hidden = !bar.active();
  return bar;
}

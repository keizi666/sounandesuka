/**
 * シナリオの始まりに出す題の札（ユーザーの指定）。上に日付と天気、真ん中に大きな題、下に登山者の顔・名前・年齢。
 * 数秒で消える（クリック・キーでもすぐ消える）。消えるまでシミュレーションは進めない。
 */
import { dateAt, scenarioStartMin } from '../sim/core/clock';
import { updateGlobal } from '../sim/weather/global';
import { updateClimberLocal } from '../sim/weather/local';
import type { LocalWeather, ScenarioDef, StaticContext, World } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { icon, type IconName } from './icons';

const SHOW_MS = 4200;
const FADE_MS = 700;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 出発地点の天気（いまの世界を写して 1 回だけ計算する。世界と出来事は変えない） */
function startWeather(world: World, ctx: StaticContext): { l: LocalWeather; cloud: number } | null {
  try {
    const w = structuredClone(world);
    const c2: StaticContext = { ...ctx, events: [] };
    updateGlobal(w, c2);
    updateClimberLocal(w, c2);
    const l = w.climbers[0]?.local;
    return l ? { l, cloud: w.weather.cloudCover } : null;
  } catch {
    return null;
  }
}

function weatherOf(l: LocalWeather, cloud: number): { ic: IconName; text: string } {
  if (l.precipMmH >= 0.3) {
    if (l.precipType === 'snow') return { ic: 'acUnit', text: '雪' };
    return { ic: 'rainy', text: '雨' };
  }
  if (l.visibilityM < 1000) return { ic: 'foggy', text: '霧' };
  if (cloud > 0.75) return { ic: 'cloud', text: 'くもり' };
  if (cloud > 0.35) return { ic: 'partlyCloudyDay', text: '晴れ時々くもり' };
  return { ic: 'wbSunny', text: '晴れ' };
}

/** hiddenTitle: 題名を隠すときに代わりに出す名前（山名。まだ 1 回も結末まで遊んでいないシナリオ。ユーザーの指定） */
export function showTitleCard(host: HTMLElement, scenario: ScenarioDef, world: World, ctx: StaticContext, onDone: () => void, hiddenTitle?: string): () => void {
  const t0 = scenarioStartMin(scenario);
  const d = dateAt(scenario.startDate, t0);
  const wd = WEEK[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()] ?? '';
  // 史実のシナリオは年も出す（架空の年は出さない）
  const dateText = `${scenario.historical ? `${d.year}年` : ''}${d.month}月${d.day}日（${wd}）`;
  const sw = startWeather(world, ctx);
  const lw = sw?.l ?? null;
  const wx = sw ? weatherOf(sw.l, sw.cloud) : null;
  const wind = lw && lw.windMs >= 8 ? `　風 ${Math.round(lw.windMs)} m/s` : '';
  const card = el('div', { class: 'title-card', role: 'dialog', 'aria-label': hiddenTitle ?? scenario.title }, [
    el('div', { class: 'tc-in' }, [
      el('p', { class: 'tc-date' }, [
        el('span', {}, dateText),
        wx && lw ? el('span', { class: 'tc-wx' }, [icon(wx.ic), `${wx.text}　${Math.round(lw.tempC)}℃${wind}`]) : null,
      ]),
      el('h1', { class: 'tc-title' }, hiddenTitle ?? scenario.title),
      scenario.region?.name && hiddenTitle === undefined ? el('p', { class: 'tc-region' }, scenario.region.name) : null,
      el('ul', { class: 'tc-party' }, scenario.party.map((p) => el('li', { style: `--c:${p.color}` }, [avatar(p, 76), el('strong', {}, p.name), el('span', {}, `${p.age}歳`)]))),
    ]),
  ]);
  host.append(card);
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    document.removeEventListener('keydown', onKey, true);
    card.classList.add('out');
    window.setTimeout(() => card.remove(), FADE_MS);
    onDone();
  };
  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    finish();
  };
  // 3D の準備（最初の描画）が終わってから数え始める。準備の間に消えてしまわないように
  let timer = 0;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (done) return;
      card.classList.add('in');
      timer = window.setTimeout(finish, SHOW_MS);
    }),
  );
  card.addEventListener('pointerdown', finish);
  document.addEventListener('keydown', onKey, true);
  return finish;
}

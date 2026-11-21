/**
 * ブリーフィング（FR-02）: 山行の概要、計画ルートの地図と行程表、パーティと装備、出発前の予報、注記・出典。
 * レイアウト: 写真つきの見出し（題名と要点）→ 左に地図と行程表、右に物語・パーティ・予報 → 下に固定した「出発する」。
 */
import { historicalSources } from './historicalLinks';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { fill, formatClock, formatDateTime } from '../i18n/format';
import { parseTimeRef } from '../sim/core/clock';
import { scenarioStartMin } from '../sim/core/clock';
import { legCourseTimeMin, resolveRoute } from '../sim/terrain/trails';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { drawMap2d } from './map2d';
import { audio } from './audio';
import { applyConditions, DEFAULT_CONDITIONS, isDefaultConditions, type StartConditions } from '../sim/scenario/startConditions';
import { climberCard, weatherCard } from './briefingConditions';
import { shareButtons } from './shareButtons';
import { briefUrl } from '../app/shareState';
import { saveSettings, type Difficulty } from '../app/settings';
import { shortTarget } from '../net/shareLink';
import { maskSpoiler, unplayed } from './spoiler';

/** 予報の文から、天気のアイコンを選ぶ */
function forecastIcon(label: string, text: string): IconName {
  if (/注意報|警報/.test(label + text)) return 'warning';
  if (text.includes('雷')) return 'thunderstorm';
  if (text.includes('雪')) return 'acUnit';
  if (text.includes('雨')) return 'rainy';
  if (/くもり|曇|霧|ガス/.test(text)) return text.includes('晴') ? 'partlyCloudyDay' : 'cloud';
  if (text.includes('風')) return 'air';
  return 'wbSunny';
}

function hoursMinutes(min: number): string {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

/** 難しさを選ぶ（出発の前。選んだものは設定に覚える。ユーザーの指定） */
function difficultyPicker(app: AppContext): HTMLElement {
  const D = JA.difficulty;
  const opts: Difficulty[] = ['easy', 'normal', 'hard'];
  const note = el('small', { class: 'df-note' }, D.note[app.settings.difficulty]);
  const btns = opts.map((d) => {
    const b = el('button', { type: 'button', class: `df-btn df-${d}${app.settings.difficulty === d ? ' on' : ''}`, 'aria-pressed': app.settings.difficulty === d, title: D.note[d] }, D.label[d]);
    b.addEventListener('click', () => {
      app.settings.difficulty = d;
      saveSettings(app.settings);
      for (const x of btns) {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      }
      note.textContent = D.note[d] ?? '';
    });
    return b;
  });
  return el('div', { class: 'df-pick' }, [el('div', { class: 'df-row', role: 'group', 'aria-label': D.title }, [el('span', { class: 'df-title' }, D.title), ...btns]), note]);
}

export function showBriefing(app: AppContext, loaded: LoadedScenario): () => void {
  const { scenario: s, map } = loaded;
  const B = JA.briefing;
  // 一覧にあるシナリオで、まだ 1 回も遊んでいなければ、題名・テーマ・史実の注記・出典など結末の手がかりを伏せる（ユーザーの指定）。押すと見える
  const hide = loaded.listed === true && unplayed(s.id);
  const veil = <T extends HTMLElement>(n: T): T => (hide ? maskSpoiler(n, true) : n);
  audio().music(s.music?.briefing ?? 'ambient-mist-lake');
  const canvas = el('canvas', { width: 640, height: 640, class: 'map2d', 'aria-label': JA.ui.plan });
  drawMap2d(canvas, map, { route: s.plan.route });

  // 行程: 区間ごとのコースタイムと、計画上の通過時刻（休憩を含まない）
  const legs = (() => {
    try {
      return resolveRoute(map, s.plan.route);
    } catch {
      return [];
    }
  })();
  const startMin = scenarioStartMin(s);
  let total = 0;
  let distM = 0;
  let ascentM = 0;
  const stop = (id: string, tMin: number, first: boolean, last: boolean): HTMLElement => {
    const n = map.nodes[id];
    return el('li', { class: `bf-stop${first ? ' first' : ''}${last ? ' last' : ''}${n?.shelter ? ' hut' : ''}` }, [
      el('time', {}, formatClock(tMin)),
      el('span', { class: 'dot' }, first ? icon('hiking') : last ? icon('flag') : n?.shelter ? icon('home') : null),
      el('span', { class: 'place' }, [el('strong', {}, n?.name ?? id), n ? el('small', {}, `${Math.round(n.elevM).toLocaleString()} m`) : null]),
    ]);
  };
  // 名前のない地点（道の途中の分岐など）は行程に載せず、前後の区間をまとめる（ユーザーの指定）。出発と到着は名前がなくても載せる
  const steps: HTMLElement[] = [];
  let sinceShown = 0;
  legs.forEach((l, i) => {
    if (i === 0) steps.push(stop(l.from, startMin, true, false));
    const t = legCourseTimeMin(map, l);
    total += t;
    sinceShown += t;
    distM += map.trails[l.edgeId]?.lengthM ?? 0;
    ascentM += Math.max(0, (map.nodes[l.to]?.elevM ?? 0) - (map.nodes[l.from]?.elevM ?? 0));
    const last = i === legs.length - 1;
    if (!last && !map.nodes[l.to]?.name) return;
    steps.push(el('li', { class: 'bf-leg' }, [el('span', {}), el('span', { class: 'line' }), el('span', { class: 'dur' }, hoursMinutes(sinceShown))]));
    steps.push(stop(l.to, startMin + total, false, last));
    sinceShown = 0;
  });

  const fact = (ic: IconName, label: string, value: string): HTMLElement => el('div', { class: 'bf-fact' }, [icon(ic), el('span', {}, [el('small', {}, label), el('strong', {}, value)])]);
  const facts = el('div', { class: 'bf-facts' }, [
    fact('calendarToday', B.departure, formatDateTime(s, startMin)),
    fact('flag', JA.ui.plannedFinish, formatClock(parseTimeRef(s.plan.plannedFinish))),
    fact('timer', JA.ui.courseTime, hoursMinutes(total)),
    distM > 0 ? fact('route', B.distance, `${(distM / 1000).toFixed(1)} km`) : null,
    ascentM > 0 ? fact('trendingUp', B.ascent, `${Math.round(ascentM).toLocaleString()} m`) : null,
    fact('groups', B.partySize, `${s.party.length}${B.people}`),
  ]);

  const notes = el('div', { class: 'bf-notes' }, [
    el('p', { class: 'note' }, JA.disclaimer.fictional),
    s.region?.real ? el('p', { class: 'note' }, JA.disclaimer.realMountain) : null,
    loaded.attribution.length > 0 ? el('p', { class: 'note' }, `${JA.ui.attribution}: ${loaded.attribution.map((a) => a.text).join(' / ')}`) : null,
    s.sources && s.sources.length > 0 ? el('p', { class: 'note' }, [`${JA.ui.sources}: `, veil(el('span', {}, s.sources.join(' / ')))]) : null,
  ]);
  // 始まりの条件を変えて試す（気象条件はカード、体調・装備・体力・持ち物は登場人物のカードで人ごとに。ユーザーの指定）
  const cond: StartConditions = structuredClone(loaded.conditions ?? DEFAULT_CONDITIONS);
  const condCard = weatherCard(cond);
  const depart = (): void => {
    const changed = !isDefaultConditions(cond);
    const next: LoadedScenario = changed ? { ...loaded, scenario: applyConditions(loaded.scenario, cond), conditions: structuredClone(cond) } : { ...loaded, conditions: undefined };
    app.go({ name: 'sim', loaded: next, observe: app.settings.observe });
  };

  app.root.append(
    el('main', { class: 'briefing' }, [
      // 見出し: 写真の上に、題名と山行の要点
      el('header', { class: 'bf-hero' }, [
        el('div', { class: 'bf-hero-in' }, [
          el('button', { class: 'bf-back', onclick: () => app.go({ name: 'select' }) }, [icon('arrowBack'), JA.ui.back]),
          el('p', { class: 'bf-kicker' }, [JA.ui.briefing, veil(el('span', { class: 'tag' }, JA.labels.theme[s.theme] ?? s.theme)), s.region?.name ? el('span', { class: 'tag plain' }, s.region.name) : null]),
          // 題と共有（ユーザーの指定: 共有は題の右、狭い画面では題の下）。一覧にあるシナリオだけ（エディターで作った物は出さない）
          el('div', { class: 'bf-title-row' }, [
            veil(el('h1', {}, s.title)),
            loaded.listed
              ? el('details', { class: 'bf-share' }, [
                  el('summary', { title: JA.share.scenarioTitle }, [icon('share'), JA.share.scenarioButton]),
                  el('div', { class: 'bf-share-pop' }, [
                    el('p', { class: 'bf-share-h' }, JA.share.scenarioTitle),
                    shareButtons(shortTarget({ text: fill(JA.share.scenarioText, { title: s.title }), url: briefUrl(s.id) }), { note: JA.share.scenarioNote }),
                  ]),
                ])
              : null,
          ]),
          s.subtitle ? veil(el('p', { class: 'bf-sub' }, s.subtitle)) : null,
          hide ? el('p', { class: 'bf-spoiler-note' }, [icon('visibilityOff'), JA.spoiler.note]) : null,
          facts,
        ]),
      ]),
      el('div', { class: 'bf-body' }, [
        // 史実シナリオでは、最初に注記と出典を出す（docs/09 §11）
        s.historical
          ? el('section', { class: 'bf-card bf-historical' }, [
              el('p', { class: 'strong' }, [icon('warning'), veil(el('span', {}, s.historical.disclaimer))]),
              veil(historicalSources(s.historical)),
              el('p', {}, s.historical.labelsNote),
              el('p', {}, '※印のセリフは架空です。記録に残る発言には「記録」と表示しています。'),
            ])
          : null,
        el('div', { class: 'bf-grid' }, [
          el('div', { class: 'bf-col' }, [
            el('section', { class: 'bf-card bf-map' }, [el('h2', {}, [icon('map'), JA.ui.plan]), canvas]),
            el('section', { class: 'bf-card' }, [el('h2', {}, [icon('route'), B.itinerary]), el('ol', { class: 'bf-route' }, steps), el('p', { class: 'hint' }, B.itineraryNote)]),
          ]),
          el('div', { class: 'bf-col' }, [
            el('section', { class: 'bf-card bf-story' }, [el('p', {}, s.briefing.text)]),
            el('section', { class: 'bf-card' }, [el('h2', {}, [icon('groups'), JA.ui.party]), el('ul', { class: 'bf-party' }, s.party.map((p) => climberCard(p, s, cond, true)))]),
            el('section', { class: 'bf-card' }, [
              el('h2', {}, [icon('partlyCloudyDay'), JA.ui.forecast]),
              el('ul', { class: 'bf-forecast' }, s.briefing.forecast.map((f) => {
                const ic = forecastIcon(f.label, f.text);
                return el('li', { class: ic === 'warning' ? 'warn' : '' }, [icon(ic), el('span', { class: 'when' }, f.label), el('span', { class: 'what' }, f.text)]);
              })),
            ]),
            condCard,
            notes,
          ]),
        ]),
      ]),
      // 下に固定: 出発
      el('footer', { class: 'bf-bar' }, [
        el('div', { class: 'bf-bar-in' }, [
          el('span', { class: 'bf-bar-info' }, [veil(el('strong', {}, s.title)), el('small', {}, `${formatDateTime(s, startMin)} ${B.departure} ・ ${s.party.length}${B.people}`)]),
          difficultyPicker(app),
          el('button', { class: 'primary big', onclick: depart }, [icon('hiking'), JA.ui.depart]),
        ]),
      ]),
    ]),
  );
  return () => {};
}

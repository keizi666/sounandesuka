/**
 * ブリーフィング（FR-02）: 山行の概要、計画ルートの地図と行程表、パーティと装備、出発前の予報、注記・出典。
 * レイアウト: 写真つきの見出し（題名と要点）→ 左に地図と行程表、右に物語・パーティ・予報 → 下に固定した「出発する」。
 */
import { historicalSources } from './historicalLinks';
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { formatClock, formatDateTime } from '../i18n/format';
import { parseTimeRef } from '../sim/core/clock';
import { scenarioStartMin } from '../sim/core/clock';
import { legCourseTimeMin, resolveRoute } from '../sim/terrain/trails';
import type { ClimberDef } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { icon, type IconName } from './icons';
import { drawMap2d } from './map2d';
import { audio } from './audio';
import { applyConditions, DEFAULT_CONDITIONS, isDefaultConditions, type Health, type SeasonOverride, type StartConditions, type WeatherOverride } from '../sim/scenario/startConditions';

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

/** 装備の 1 項目（アイコン＋文）。持っていないものは薄く出す */
function gearChip(ic: IconName, text: string, has = true): HTMLElement {
  return el('span', { class: `gear${has ? '' : ' none'}` }, [icon(ic), text]);
}

function climberCard(p: ClimberDef): HTMLElement {
  const B = JA.briefing;
  const g = p.gear;
  return el('li', { class: 'bf-climber', style: `--c:${p.color}` }, [
    avatar(p, 64),
    el('div', { class: 'bf-who' }, [
      el('div', { class: 'bf-name' }, [el('strong', {}, p.name), el('span', {}, `${p.age}${B.yearsOld}`), p.leader ? el('span', { class: 'badge' }, B.leader) : null, p.role ? el('span', { class: 'role' }, p.role) : null]),
      el('div', { class: 'bf-gear' }, [
        gearChip('checkroom', `${B.rainwear} ${B.rainwearKind[g.rainwear] ?? g.rainwear}`, g.rainwear !== 'none'),
        gearChip('acUnit', g.cloPack > 0 ? B.warmSpare : B.warmNone, g.cloPack > 0),
        gearChip('flashlightOn', g.headlamp.has ? B.headlamp : B.noHeadlamp, g.headlamp.has),
        gearChip('map', g.phone.gpsApp ? B.mapApp : g.map ? B.paperMap : B.noMap, g.phone.gpsApp || g.map),
        gearChip('camping', g.tent ? B.tent : g.bivy !== 'none' ? B.bivy : B.noBivy, Boolean(g.tent) || g.bivy !== 'none'),
        gearChip('restaurant', `${g.foodKcal} kcal`),
        gearChip('waterDrop', `${g.waterL} L`),
        g.trekkingPoles ? gearChip('hiking', B.poles) : null,
      ]),
      p.estimated?.length ? el('small', { class: 'estimated' }, `${JA.ui.estimated}: ${p.estimated.join(', ')}`) : null,
    ]),
  ]);
}

/** 始まりの条件のカード（選ぶと cond を書き換える） */
function conditionsCard(s: LoadedScenario['scenario'], cond: StartConditions): HTMLElement {
  const C = JA.conditions;
  const select = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void): HTMLSelectElement => {
    const sel = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
    sel.addEventListener('change', () => {
      set(sel.value as T);
      refresh();
    });
    return sel;
  };
  const summary = el('p', { class: 'hint' });
  const refresh = (): void => {
    summary.textContent = isDefaultConditions(cond) ? C.asScenario : C.changedNote;
    card.classList.toggle('changed', !isDefaultConditions(cond));
  };
  const temp = el('input', { type: 'range', min: -10, max: 10, step: 1, value: cond.tempOffsetC }) as HTMLInputElement;
  const tempLabel = el('output', {}, '');
  const showTemp = (): void => {
    tempLabel.textContent = `${cond.tempOffsetC > 0 ? '+' : ''}${cond.tempOffsetC}℃`;
  };
  temp.addEventListener('input', () => {
    cond.tempOffsetC = Number(temp.value);
    showTemp();
    refresh();
  });
  showTemp();
  const row = (label: string, ctrl: HTMLElement | HTMLElement[]): HTMLElement => el('label', { class: 'bf-cond-row' }, [el('span', {}, label), ...(Array.isArray(ctrl) ? ctrl : [ctrl])]);
  const healthOpts: [Health, string][] = [['good', C.health.good], ['sleepy', C.health.sleepy], ['tired', C.health.tired], ['cold', C.health.cold]];
  const card = el('section', { class: 'bf-card bf-cond' }, [
    el('h2', {}, [icon('thermostat'), C.title]),
    row(C.weather, select<WeatherOverride>(cond.weather, [['asIs', C.asIs], ['clear', C.w.clear], ['rain', C.w.rain], ['fog', C.w.fog], ['snow', C.w.snow], ['storm', C.w.storm]], (v) => (cond.weather = v))),
    row(C.temp, [temp, tempLabel]),
    row(C.season, select<SeasonOverride>(cond.season, [['asIs', C.asIs], ['spring', JA.labels.season['spring'] ?? '春'], ['summer', JA.labels.season['summer'] ?? '夏'], ['autumn', JA.labels.season['autumn'] ?? '秋'], ['winter', JA.labels.season['winter'] ?? '冬']], (v) => (cond.season = v))),
    ...s.party.map((p) => row(`${p.name}${C.healthOf}`, select<Health>(cond.health[p.id] ?? 'good', healthOpts, (v) => (cond.health[p.id] = v)))),
    summary,
  ]);
  refresh();
  return card;
}

export function showBriefing(app: AppContext, loaded: LoadedScenario): () => void {
  const { scenario: s, map } = loaded;
  const B = JA.briefing;
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
  const steps: HTMLElement[] = [];
  legs.forEach((l, i) => {
    if (i === 0) steps.push(stop(l.from, startMin, true, false));
    const t = legCourseTimeMin(map, l);
    total += t;
    distM += map.trails[l.edgeId]?.lengthM ?? 0;
    ascentM += Math.max(0, (map.nodes[l.to]?.elevM ?? 0) - (map.nodes[l.from]?.elevM ?? 0));
    steps.push(el('li', { class: 'bf-leg' }, [el('span', {}), el('span', { class: 'line' }), el('span', { class: 'dur' }, hoursMinutes(t))]));
    steps.push(stop(l.to, startMin + total, false, i === legs.length - 1));
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
    s.sources && s.sources.length > 0 ? el('p', { class: 'note' }, `${JA.ui.sources}: ${s.sources.join(' / ')}`) : null,
  ]);
  // 始まりの条件を変えて試す（天気・気温・季節・体調）
  const cond: StartConditions = structuredClone(loaded.conditions ?? DEFAULT_CONDITIONS);
  const condCard = conditionsCard(s, cond);
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
          el('p', { class: 'bf-kicker' }, [JA.ui.briefing, el('span', { class: 'tag' }, JA.labels.theme[s.theme] ?? s.theme), s.region?.name ? el('span', { class: 'tag plain' }, s.region.name) : null]),
          el('h1', {}, s.title),
          s.subtitle ? el('p', { class: 'bf-sub' }, s.subtitle) : null,
          facts,
        ]),
      ]),
      el('div', { class: 'bf-body' }, [
        // 史実シナリオでは、最初に注記と出典を出す（docs/09 §11）
        s.historical
          ? el('section', { class: 'bf-card bf-historical' }, [
              el('p', { class: 'strong' }, [icon('warning'), s.historical.disclaimer]),
              historicalSources(s.historical),
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
            el('section', { class: 'bf-card' }, [el('h2', {}, [icon('groups'), JA.ui.party]), el('ul', { class: 'bf-party' }, s.party.map(climberCard))]),
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
          el('span', { class: 'bf-bar-info' }, [el('strong', {}, s.title), el('small', {}, `${formatDateTime(s, startMin)} ${B.departure} ・ ${s.party.length}${B.people}`)]),
          el('button', { class: 'primary big', onclick: depart }, [icon('hiking'), JA.ui.depart]),
        ]),
      ]),
    ]),
  );
  return () => {};
}

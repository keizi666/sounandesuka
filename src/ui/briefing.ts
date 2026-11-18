/** ブリーフィング（FR-02）: 計画ルートの 2D 地図、パーティと装備、出発前の予報、コースタイム、注記・出典 */
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { formatClock } from '../i18n/format';
import { parseTimeRef } from '../sim/core/clock';
import { legCourseTimeMin, resolveRoute } from '../sim/terrain/trails';
import { el } from './dom';
import { drawMap2d } from './map2d';

export function showBriefing(app: AppContext, loaded: LoadedScenario): () => void {
  const { scenario: s, map } = loaded;
  const canvas = el('canvas', { width: 512, height: 512, class: 'map2d', 'aria-label': JA.ui.plan });
  drawMap2d(canvas, map, { route: s.plan.route });
  let total = 0;
  const legs = (() => {
    try {
      return resolveRoute(map, s.plan.route);
    } catch {
      return [];
    }
  })();
  const rows = legs.map((l) => {
    const t = legCourseTimeMin(map, l);
    total += t;
    return el('li', {}, `${map.nodes[l.from]?.name ?? l.from} → ${map.nodes[l.to]?.name ?? l.to}　${Math.round(t)} 分`);
  });
  const notes = [
    el('p', { class: 'note' }, JA.disclaimer.fictional),
    s.region?.real ? el('p', { class: 'note' }, JA.disclaimer.realMountain) : null,
    s.historical ? el('p', { class: 'note strong' }, s.historical.disclaimer) : null,
    s.historical ? el('p', { class: 'note' }, `出典: ${s.historical.sources.map((x) => `${x.title}（${x.publisher ?? ''} ${x.year ?? ''}）`).join(' / ')}`) : null,
    s.historical ? el('p', { class: 'note' }, '※印のセリフは架空です。記録に残る発言には「記録」と表示しています。') : null,
    loaded.attribution.length > 0 ? el('p', { class: 'note' }, `${JA.ui.attribution}: ${loaded.attribution.map((a) => a.text).join(' / ')}`) : null,
  ];
  const party = s.party.map((p) =>
    el('li', { class: 'climber-card' }, [
      el('strong', { style: `color:${p.color}` }, `● ${p.name}`),
      ` ${p.age}歳 ${p.role ?? ''}`,
      el('br'),
      el('small', {}, `雨具 ${p.gear.rainwear} / 防寒 ${p.gear.cloWorn}+${p.gear.cloPack} clo / ヘッドランプ ${p.gear.headlamp.has ? 'あり' : 'なし'} / 地図アプリ ${p.gear.phone.gpsApp ? 'あり' : 'なし'} / ツェルト ${p.gear.bivy === 'none' ? 'なし' : 'あり'} / 食料 ${p.gear.foodKcal} kcal`),
      p.estimated?.length ? el('small', { class: 'estimated' }, ` （${JA.ui.estimated}: ${p.estimated.join(', ')}）`) : null,
    ]),
  );
  app.root.append(
    el('main', { class: 'briefing' }, [
      el('header', {}, [el('button', { onclick: () => app.go({ name: 'select' }) }, JA.ui.back), el('h1', {}, `${JA.ui.briefing}: ${s.title}`)]),
      el('div', { class: 'cols' }, [
        el('section', {}, [el('h2', {}, JA.ui.plan), canvas, el('ol', {}, rows), el('p', {}, `${JA.ui.courseTime} ${Math.round(total)} 分 ・ ${JA.ui.plannedFinish} ${formatClock(parseTimeRef(s.plan.plannedFinish))}`)]),
        el('section', {}, [
          el('p', { class: 'story' }, s.briefing.text),
          el('h2', {}, JA.ui.party),
          el('ul', {}, party),
          el('h2', {}, JA.ui.forecast),
          el('ul', { class: 'forecast' }, s.briefing.forecast.map((f) => el('li', {}, `${f.label}: ${f.text}`))),
          ...notes,
          el('button', { class: 'primary big', onclick: () => app.go({ name: 'sim', loaded, observe: app.settings.observe }) }, JA.ui.depart),
        ]),
      ]),
    ]),
  );
  return () => {};
}

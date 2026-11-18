/** 結末画面（docs/11 §5、FR-30〜31） */
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { formatDateTime } from '../i18n/format';
import { createStaticContext } from '../sim/core/world';
import { ENDING_SEVERITY, resolveEnding } from '../sim/scenario/endings';
import { recVars } from '../sim/record/recorder';
import { el } from './dom';
import { optionLabel, type SimResult } from './simScreen';

export function endingTone(kind: string): 'good' | 'mid' | 'bad' {
  const s = ENDING_SEVERITY[kind as keyof typeof ENDING_SEVERITY] ?? 0;
  return s <= 1 ? 'good' : s <= 3 ? 'mid' : 'bad';
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  return `${h} 時間 ${Math.round(min - h * 60)} 分`;
}

export function showEnding(app: AppContext, loaded: LoadedScenario, result: SimResult): () => void {
  const { scenario: s } = loaded;
  const w = result.world;
  const ctx = createStaticContext(loaded.map, s);
  const e = resolveEnding(w, ctx, recVars(result.recorder, w))!;
  const def = JA.endings[e.kind];
  const r = result.recorder.record;
  const start = r.samples[0]?.t ?? w.tMin;
  const decisions = r.decisions.filter((d) => d.by === 'user' || d.by === 'bias');
  app.root.append(
    el('main', { class: `ending tone-${endingTone(e.kind)}` }, [
      el('div', { class: 'band' }, [el('p', {}, JA.ui.endingTitle), el('h1', {}, e.title ?? def?.title ?? e.kind)]),
      el('p', { class: 'story' }, e.text ?? def?.text ?? ''),
      el('section', { class: 'summary' }, [
        el('h2', {}, JA.ui.summary),
        el('dl', {}, [
          el('dt', {}, JA.ui.duration),
          el('dd', {}, hm((w.ended?.atMin ?? w.tMin) - start)),
          el('dt', {}, JA.ui.distance),
          el('dd', {}, `${(r.stats.distanceM / 1000).toFixed(1)} km`),
          el('dt', {}, JA.ui.minCore),
          el('dd', {}, `${r.stats.minCoreC.toFixed(1)}℃`),
          r.stats.rescueCalledAt !== null ? el('dt', {}, JA.ui.rescueAt) : null,
          r.stats.rescueCalledAt !== null ? el('dd', {}, formatDateTime(s, r.stats.rescueCalledAt)) : null,
        ]),
        decisions.length > 0
          ? el('div', {}, [el('h3', {}, JA.ui.decisions), el('ul', {}, decisions.map((d) => el('li', {}, `${formatDateTime(s, d.tMin)} ${optionLabel(loaded, d.cpId, d.optionId)}`)))])
          : null,
      ]),
      w.climbers.length > 1
        ? el('section', {}, [
            el('h2', {}, JA.ui.perClimber),
            el('ul', { class: 'per' }, e.perClimber.map((p) => {
              const c = w.climbers.find((x) => x.id === p.id)!;
              return el('li', {}, [el('span', { style: `color:${c.def.color}` }, '● '), `${c.def.name}: ${JA.endings[p.outcome]?.title ?? p.outcome}（${JA.labels.state[p.state] ?? p.state}）`]);
            })),
          ])
        : null,
      el('p', { class: 'note' }, JA.disclaimer.endingNote),
      s.region?.real ? el('p', { class: 'note' }, JA.disclaimer.realMountain) : null,
      s.historical ? el('p', { class: 'note strong' }, s.historical.disclaimer) : null,
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', onclick: () => app.go({ name: 'debrief', loaded, result }) }, JA.ui.debrief),
        el('button', { onclick: () => app.go({ name: 'briefing', loaded }) }, JA.ui.again),
        el('button', { onclick: () => app.go({ name: 'select' }) }, JA.ui.toSelect),
      ]),
    ]),
  );
  return () => {};
}

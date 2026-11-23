/**
 * 結果の画面の「遭難対策のまとめ」（ユーザーの指定: 遭難対策の教材になるように。例: 雷の回なら、落雷を避ける方法・真上で鳴っているときの対処・金属の誤解・側撃雷）。
 * シナリオのテーマと、この回に起きたこと（落雷・道迷い・転落・低体温・熱中症・暗闇・熊・急病・高山病・分かれた）から話題を選び、
 * 最後に「計画と連絡」を必ず添える。文は src/i18n/safety.ts。
 */
import type { LoadedScenario } from '../app/data';
import { SAFETY, type SafetyTopicId } from '../i18n/safety';
import type { RunRecord, Theme, World } from '../sim/types';
import { el } from './dom';
import { icon } from './icons';

const THEME_TOPIC: Partial<Record<Theme, SafetyTopicId>> = { lightning: 'lightning', hypothermia: 'hypothermia', lost: 'lost', fall: 'fall', heat: 'heat' };

/** この回に合う話題（テーマ → 起きたこと の順。重なりは除く。最後は必ず「計画と連絡」） */
export function safetyTopics(loaded: LoadedScenario, world: World, rec: RunRecord): SafetyTopicId[] {
  const s = loaded.scenario;
  const ev = new Set(rec.events.map((e) => e.type));
  const stages = new Set(rec.events.filter((e) => e.type === 'STAGE_CHANGE').map((e) => String(e.data?.['stage'] ?? e.data?.['to'] ?? '')));
  const out: SafetyTopicId[] = [];
  const add = (t: SafetyTopicId, when: boolean): void => {
    if (when && !out.includes(t)) out.push(t);
  };
  const theme = THEME_TOPIC[s.theme];
  if (theme) add(theme, true);
  add('lightning', ev.has('LIGHTNING_STRIKE') || s.weather.thunderCells !== undefined && s.weather.thunderCells.length > 0);
  add('lost', ev.has('LOST_AWARE') || rec.stats.wasLost);
  add('fall', ev.has('FALL'));
  add('hypothermia', rec.stats.minCoreC < 35.5 || stages.has('mild') || stages.has('moderate') || stages.has('severe'));
  add('heat', stages.has('heatExhaustion') || stages.has('heatStroke') || world.climbers.some((c) => c.body.deathCause === 'heat'));
  add('bear', (world.animals ?? []).some((a) => /bear/i.test(a.species)));
  add('illness', world.climbers.some((c) => c.body.illness !== undefined) || ev.has('CARDIAC_ARREST'));
  add('altitude', world.climbers.some((c) => (c.body.ams ?? 0) > 0.3));
  add('night', ev.has('DARK') || ev.has('BIVOUAC_START'));
  add('group', s.party.length >= 3 && world.groups.length > 1);
  // 長くなりすぎないよう、計画と連絡のほかに 4 つまで
  return [...out.slice(0, 4), 'plan'];
}

export function safetyCard(loaded: LoadedScenario, world: World, rec: RunRecord): HTMLElement {
  const topics = safetyTopics(loaded, world, rec);
  return el('section', { class: 'bf-card sf-card' }, [
    el('h2', {}, [icon('shield'), SAFETY.title]),
    el('p', { class: 'hint' }, SAFETY.lead),
    ...topics.map((id, i) => {
      const t = SAFETY.topics[id];
      return el('details', { class: 'sf-topic', open: i === 0 }, [
        el('summary', {}, t.title),
        el('p', { class: 'sf-lead' }, t.lead),
        ...t.sections.map((sec) =>
          el('div', { class: 'sf-sec' }, [
            el('h4', {}, sec.title),
            el('ul', {}, sec.points.map((p) => el('li', {}, [el('strong', {}, p.head), el('span', {}, p.text)]))),
          ]),
        ),
      ]);
    }),
    el('p', { class: 'hint' }, SAFETY.note),
  ]);
}

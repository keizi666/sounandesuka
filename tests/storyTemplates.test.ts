/**
 * 物語のテンプレート（エディターの物語のタブ）: どのテンプレートを足しても検証のエラーが増えず、
 * 2 回足しても ID が重ならず、「いつ」をやさしい言葉で言えること。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_PRESETS, plainWhen, RECORD_PRESETS } from '../src/editor/forms/whenPicker';
import { createFictionalProject } from '../src/editor/store/project';
import { applyNewProjectTemplates } from '../src/editor/templates/apply';
import { applyStory, tplCtx } from '../src/editor/templates/story';
import { STORY_TEMPLATES } from '../src/editor/templates/storyParts2';
import { validateScenario } from '../src/sim/scenario/validate';
import type { EditorProject, MapDef } from '../src/sim/types';

const map = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/maps/sounan.json'), 'utf8')) as MapDef;

function project(): EditorProject {
  const p = createFictionalProject('t', structuredClone(map));
  let k = 0;
  applyNewProjectTemplates(p, { season: 'autumn', weather: 'fair3', stage: 'day_ridge', party: { count: 2, sex: 'mix', age: 'mix', level: 'mix', season: 'autumn' } }, null, () => ((k += 0.37) % 1));
  return p;
}
const errors = (p: EditorProject): string[] => validateScenario(p.scenario, p.map).filter((i) => i.level === 'error').map((i) => `${i.code} ${i.path} ${i.message}`);

describe('物語のテンプレート', () => {
  it('テンプレートの ID は重ならない', () => {
    const ids = STORY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  for (const t of STORY_TEMPLATES) {
    it(`「${t.name}」を足しても検証のエラーが増えない（2 回足しても）`, () => {
      const p = project();
      const before = errors(p);
      const sel = applyStory(p.scenario, t.make(tplCtx(p)));
      expect(sel).not.toBeNull();
      applyStory(p.scenario, t.make(tplCtx(p)));
      expect(errors(p)).toEqual(before);
      const s = p.scenario;
      for (const ids of [s.choices.map((c) => c.id), s.events.map((e) => e.id), s.lessons.map((l) => l.id), (s.speech ?? []).map((x) => x.key), (s.thoughts ?? []).map((x) => x.key)]) expect(new Set(ids).size).toBe(ids.length);
    });
  }
  it('「いつ」をやさしい言葉で言える（記号や変数名を出さない）', () => {
    const p = project();
    for (const t of STORY_TEMPLATES) applyStory(p.scenario, t.make(tplCtx(p)));
    const ctx = { scenario: p.scenario, map: p.map };
    const texts = [
      ...p.scenario.choices.map((c) => plainWhen(c.trigger, ctx)),
      ...p.scenario.events.map((e) => plainWhen(e.trigger, ctx)),
      ...(p.scenario.speech ?? []).map((x) => plainWhen(x.when, ctx)),
      ...p.scenario.lessons.map((l) => plainWhen(l.when, ctx, RECORD_PRESETS)),
    ];
    for (const x of texts) expect(x).not.toMatch(/[A-Z]{3,}_|leader\.|rec\.|party\./);
    expect(LIVE_PRESETS.length).toBeGreaterThan(5);
  });
  it('部品の中の参照は、ID を付け替えても合う', () => {
    const p = project();
    const add = { choices: [{ id: 'cp_x', title: 't', trigger: { after: 'D0 08:00' }, situation: '', options: [{ id: 'a', label: 'a', actions: [{ type: 'continueRoute' as const }], bias: { base: 1 } }] }], lessons: [{ id: 'l_x', when: { chose: { cp: 'cp_x', option: 'a' } }, title: 't', text: 't' }] };
    applyStory(p.scenario, structuredClone(add));
    applyStory(p.scenario, structuredClone(add));
    expect(p.scenario.lessons.map((l) => (l.when as { chose: { cp: string } }).chose.cp)).toEqual(['cp_x', 'cp_x2']);
  });
});

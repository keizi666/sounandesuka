/** 幻覚・幻聴（ユーザーの指定。src/sim/climber/hallucination.ts） */
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { computeJ } from '../src/sim/climber/capacity';
import { hallucTarget, stepHallucination } from '../src/sim/climber/hallucination';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup() {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  s.party = [structuredClone(s.party[0]!)];
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'headless', policy: 'recommended' });
  for (let i = 0; i < 3; i += 1) stepWorld(w, ctx);
  return { w, ctx, c: w.climbers[0]! };
}

describe('幻覚・幻聴', () => {
  it('ふつうの体では出ない。シャリバテだけでも出ない', () => {
    const { ctx, c } = setup();
    expect(hallucTarget(c, ctx).target).toBeLessThan(0.05);
    c.body.glycogenKcal = 0;
    expect(hallucTarget(c, ctx).target).toBeLessThan(ctx.tuning.hallucination.onset);
  });

  it('体が冷えきると出はじめ、記録に出て、判断力が下がる', () => {
    const { w, ctx, c } = setup();
    const j0 = computeJ(c, ctx.tuning);
    c.body.coreC = 33;
    ctx.events.length = 0;
    for (let i = 0; i < 180; i += 1) {
      w.tMin += 1;
      stepHallucination(w, ctx, c, 1);
    }
    expect(c.body.halluc!.level).toBeGreaterThan(ctx.tuning.hallucination.onset);
    expect(ctx.events.some((e) => e.type === 'SCRIPT_LOG' && e.data?.['halluc'] === 'onset' && e.data?.['cause'] === 'cold')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'THOUGHT' && String(e.data?.['key']).startsWith('halluc_')) || ctx.events.some((e) => e.type === 'SPEECH' && String(e.data?.['key']).startsWith('halluc_'))).toBe(true);
    c.body.coreC = 37;
    const jNow = computeJ(c, ctx.tuning);
    expect(jNow).toBeLessThan(j0);
  });

  it('眠れていない時間が長いと出る。小屋でよく眠ると戻る', () => {
    const { w, ctx, c } = setup();
    c.body.awakeMin = 60 * 60;
    expect(hallucTarget(c, ctx)).toMatchObject({ cause: 'sleep' });
    expect(hallucTarget(c, ctx).target).toBeGreaterThan(ctx.tuning.hallucination.onset);
    // 夜の小屋で 8 時間寝る
    w.tMin = Math.floor(w.tMin / 1440) * 1440 + 23 * 60;
    c.state = 'SHELTERED';
    c.body.shelterNodeId = Object.keys(ctx.map.nodes)[0]!;
    for (let i = 0; i < 8 * 60; i += 1) {
      w.tMin += 1;
      stepHallucination(w, ctx, c, 1);
    }
    expect(c.body.awakeMin!).toBeLessThan(24 * 60);
  });

  it('強い症状で、ひとりでビバークしていると、立ち上がって歩き回り、風よけを失う', () => {
    const { w, ctx, c } = setup();
    c.state = 'BIVOUAC';
    c.body.leeShelter = 0.6;
    c.body.groundInsulation = true;
    c.body.coreC = 32.5;
    c.body.awakeMin = 10 * 60;
    let wandered = false;
    for (let i = 0; i < 12 * 60 && !wandered; i += 1) {
      w.tMin += 1;
      stepHallucination(w, ctx, c, 1);
      if (c.body.halluc?.wanderUntilMin != null) wandered = true;
    }
    expect(wandered).toBe(true);
    expect(c.body.leeShelter).toBe(0);
    expect(c.body.groundInsulation).toBe(false);
    // やめたら元に戻る
    for (let i = 0; i < 60; i += 1) {
      w.tMin += 1;
      stepHallucination(w, ctx, c, 1);
    }
    if (c.body.halluc?.wanderUntilMin == null) expect(c.body.leeShelter).toBe(0.6);
  });
});

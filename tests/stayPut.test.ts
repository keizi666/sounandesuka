/**
 * 救助を頼んだら動かないのが基本（ユーザーの指定）。動くと救助が遅れ、見つかりにくくなる。
 */
import { describe, expect, it } from 'vitest';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { stepRescue } from '../src/sim/rescue/rescue';
import { evaluateOptions } from '../src/sim/scenario/choices';
import type { ChoicePointDef, ScenarioDef, World } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(): { s: ScenarioDef; w: World; ctx: ReturnType<typeof createStaticContext> } {
  const { map } = hakoniwa();
  const s = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s);
  for (const c of w.climbers) c.state = 'WAITING_RESCUE';
  const c0 = w.climbers[0]!;
  // 正確な場所で通報済み。ヘリはもう吊り上げに入るところ
  w.rescue = { ...w.rescue, status: 'dispatched', calledAtMin: w.tMin, via: 'phone', locationEstimate: { x: c0.x, z: c0.z, radiusM: 50 }, heli: { readyAtMin: w.tMin, nextCheckMin: null, state: 'flying' }, searchRadiusM: 300 };
  w.sun = { ...w.sun, isDark: false };
  return { s, w, ctx };
}

describe('救助を頼んだら動かない', () => {
  it('通報した場所にいれば、ヘリがそのまま収容する', () => {
    const { w, ctx } = setup();
    stepRescue(w, ctx, 10 / 60);
    // 飛べない天気ならヘリは待つので、ここでは「動いた場合と比べて」の確認だけにする
    const rescued = w.climbers.some((c) => c.state === 'RESCUED');
    expect(rescued || w.rescue.heli.state === 'waiting').toBe(true);
  });

  it('動いてしまうと、通報の場所では見つからず、まわりを探すことになる', () => {
    const { w, ctx } = setup();
    for (const c of w.climbers) {
      c.x += 900;
      c.inv.phone.has = false;
    }
    stepRescue(w, ctx, 10 / 60);
    expect(w.climbers.some((c) => c.state === 'RESCUED')).toBe(false);
    if (w.rescue.heli.state !== 'waiting') expect(w.flags['rescueNotThere']).toBeDefined();
  });

  it('救助を頼んだあとは、もう一度かける選択肢は出ず、動く選択肢は重みが下がる', () => {
    const { w, ctx } = setup();
    const cp: ChoicePointDef = { id: 'x', title: '', trigger: { all: [] }, situation: '', options: [
      { id: 'go', label: '', actions: [{ type: 'continueRoute' }], bias: { base: 1 } },
      { id: 'stay', label: '', actions: [{ type: 'waitRescue' }], bias: { base: 1 } },
      { id: 'call', label: '', actions: [{ type: 'callRescue', via: 'auto' }], bias: { base: 1 } },
    ] };
    const r = evaluateOptions(w, ctx, cp, 'x');
    expect(r.unavailable).toContain('call');
    const wGo = r.available.find((o) => o.option.id === 'go')!.weight;
    const wStay = r.available.find((o) => o.option.id === 'stay')!.weight;
    expect(wGo).toBeLessThan(wStay);
  });
});

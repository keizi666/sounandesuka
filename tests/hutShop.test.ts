/** 営業小屋の前を通るときに水を買う（src/sim/climber/hutShop.ts。ユーザーの指摘: 小屋で水が買えるのに水筒が増えない） */
import { describe, expect, it } from 'vitest';
import { stepHutShop } from '../src/sim/climber/hutShop';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(clockMin: number) {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'headless', policy: 'recommended' });
  const c = w.climbers[0]!;
  const hut = map.nodes['HUT_RIDGE']!;
  c.x = hut.x + 5;
  c.z = hut.z;
  c.inv.waterL = 0.1;
  c.body.waterDeficitL = 1.2;
  w.tMin = Math.floor(w.tMin / 1440) * 1440 + clockMin;
  return { w, ctx, c, hut };
}

describe('営業小屋で水を買う', () => {
  it('着いたあと、昼に小屋のそばを通ると水筒を満たし、その場で飲む。記録に 1 行。同じ小屋では 1 回だけ', () => {
    const { w, ctx, c, hut } = setup(12 * 60);
    stepHutShop(w, ctx, c);
    expect(c.inv.waterL).toBeCloseTo(0.1); // まだ着いていない
    w.visitedNodes[hut.id] = w.tMin;
    stepHutShop(w, ctx, c);
    expect(c.inv.waterL).toBeCloseTo(c.def.gear.waterL);
    expect(c.body.waterDeficitL).toBeCloseTo(1.2 - ctx.tuning.behavior.hutShopDrinkL);
    expect(ctx.events.filter((e) => e.type === 'SCRIPT_LOG' && e.data?.['hutShop'] === hut.id)).toHaveLength(1);
    c.inv.waterL = 0.2;
    stepHutShop(w, ctx, c);
    expect(c.inv.waterL).toBeCloseTo(0.2);
  });
  it('夜は小屋の売店が閉まっているので買わない', () => {
    const { w, ctx, c, hut } = setup(22 * 60);
    w.visitedNodes[hut.id] = w.tMin;
    stepHutShop(w, ctx, c);
    expect(c.inv.waterL).toBeCloseTo(0.1);
  });
});

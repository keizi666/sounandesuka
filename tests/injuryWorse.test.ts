/** けがを重ねたとき: 頭をけがしたあとに足を折ったら這う。より重いけがになったら、けがの分岐をもう一度出す */
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { crawlCapMs } from '../src/sim/climber/movement';
import { injure } from '../src/sim/hazards/slip';
import { genericTrigger } from '../src/sim/scenario/generic';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup() {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'headless', policy: 'recommended' });
  for (let i = 0; i < 3; i += 1) stepWorld(w, ctx);
  return { w, ctx, c: w.climbers[0]! };
}

describe('けがを重ねたとき', () => {
  it('頭のけがのあとに足を骨折したら、足の骨折になり這う速さになる', () => {
    const { w, ctx, c } = setup();
    injure(w, ctx, c, 'headInjury', 'fall');
    expect(c.body.injury).toBe('headInjury');
    expect(crawlCapMs(c, 0, ctx.tuning)).toBe(Infinity);
    injure(w, ctx, c, 'legFracture', 'fall');
    expect(c.body.injury).toBe('legFracture');
    expect(crawlCapMs(c, 0, ctx.tuning)).toBeLessThan(0.05);
    // 骨折のあとに頭をけがしても、骨折のまま（歩き出さない）
    injure(w, ctx, c, 'headInjury', 'fall');
    expect(c.body.injury).toBe('legFracture');
  });

  it('より重いけがになったら、けがの分岐がもう一度出る（同じけがでは出ない）', () => {
    const { w, ctx, c } = setup();
    c.body.conscious = true;
    injure(w, ctx, c, 'sprain', 'fall');
    expect(genericTrigger(w, ctx, 'injured', c)).toBe(true);
    expect(genericTrigger(w, ctx, 'injured', c)).toBe(false);
    injure(w, ctx, c, 'sprain', 'fall');
    expect(genericTrigger(w, ctx, 'injured', c)).toBe(false);
    injure(w, ctx, c, 'legFracture', 'fall');
    expect(genericTrigger(w, ctx, 'injured', c)).toBe(true);
    expect(genericTrigger(w, ctx, 'injured', c)).toBe(false);
  });
});

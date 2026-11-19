/**
 * 足を骨折したら這って動く（ユーザーの指定）: 1 時間に 100 m も進めず、急な斜面では滑り落ちることがある。
 */
import { describe, expect, it } from 'vitest';
import { crawlCapMs } from '../src/sim/climber/movement';
import { piecewise } from '../src/sim/climber/capacity';
import { stepWorld } from '../src/sim/core/step';
import { evaluateOptions, findChoicePoint, resolveChoice } from '../src/sim/scenario/choices';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { TUNING } from '../src/sim/tuning';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

describe('足の骨折で這う', () => {
  it('速さは 1 時間に 100 m 未満で、急な所ほど遅い', () => {
    const { map } = sounanMap();
    const s = loadScenario('s01_cold_front');
    const c = createWorld(map, s).climbers[0]!;
    expect(crawlCapMs(c, 0)).toBe(Infinity);
    c.body.injury = 'legFracture';
    expect(crawlCapMs(c, 0) * 3600).toBeLessThan(100);
    expect(crawlCapMs(c, 30)).toBeLessThan(crawlCapMs(c, 5));
  });

  it('登山道を這っても、1 時間で 100 m も進まない', () => {
    const { map } = sounanMap();
    const s = structuredClone(loadScenario('s01_cold_front'));
    s.choices = [];
    s.events = [];
    s.party = [s.party[0]!];
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s, { mode: 'interactive' });
    const c = w.climbers[0]!;
    stepWorld(w, ctx);
    c.body.injury = 'legFracture';
    const x0 = c.x;
    const z0 = c.z;
    for (let i = 0; i < 360; i += 1) {
      stepWorld(w, ctx); // 1 時間
      // 汎用の「けが」の分岐では、這ってでも進むを選ぶ
      if (w.pendingChoice) resolveChoice(w, ctx, w.pendingChoice.cpId === 'generic:injured' ? 'crawl' : (evaluateOptions(w, ctx, findChoicePoint(ctx, w.pendingChoice.cpId)!.cp, w.pendingChoice.cpId).available[0]!.option.id), 'user');
    }
    const d = Math.hypot(c.x - x0, c.z - z0);
    expect(d).toBeLessThan(100);
    // 這ってでも少しは進む（0 で止まらない）
    expect(d).toBeGreaterThan(10);
  });

  it('這っているときの滑落の確率は、斜面が急なほど高い', () => {
    const t = TUNING.slip.crawlP10;
    expect(piecewise(t, 40)).toBeGreaterThan(piecewise(t, 25) * 3);
    expect(piecewise(t, 10)).toBeLessThan(0.001);
  });
});

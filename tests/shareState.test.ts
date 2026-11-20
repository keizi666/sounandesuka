import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, stateOf, type PlayMode } from '../src/app/shareState';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { autoResolve, evaluateOptions, findChoicePoint, resolveChoice } from '../src/sim/scenario/choices';
import { replayTo } from '../src/ui/simReplay';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

/** 画面で遊ぶのと同じ進め方: 分岐点では、奇数番目は自分で（いちばん後ろの選択肢）、偶数番目はその人らしく自動で選ぶ */
function play(id: string, untilMin: number, mode: PlayMode) {
  const { map } = sounanMap();
  const sc = loadScenario(id);
  const w = createWorld(map, sc);
  const ctx = createStaticContext(map, sc, { mode: mode === 't' ? 'timed' : 'interactive' });
  let k = 0;
  for (let i = 0; i < 40000 && !w.ended && w.tMin < untilMin; i += 1) {
    if (w.pendingChoice) {
      const found = findChoicePoint(ctx, w.pendingChoice.cpId);
      if (found && k % 2 === 0) {
        const { available } = evaluateOptions(w, ctx, found.cp, found.key);
        resolveChoice(w, ctx, available[available.length - 1]!.option.id, 'user');
      } else autoResolve(w, ctx, 'bias');
      k += 1;
      ctx.events.length = 0;
      continue;
    }
    stepWorld(w, ctx);
    ctx.events.length = 0;
  }
  return { w, map, sc };
}

describe('状況の URL（リロード・共有で同じ場面から）', () => {
  for (const [id, until] of [['s01_cold_front', 14 * 60], ['s02_fog_descent', 18 * 60], ['s03_thunder_ridge', 13 * 60]] as const) {
    it(`${id}: URL に入れて最初から進め直すと、同じ World になる`, async () => {
      const { w, map, sc } = play(id, until, 'i');
      expect(w.decisions.length).toBeGreaterThan(0);
      const enc = await encodeState(stateOf(w, 'i', undefined));
      expect(enc.length).toBeLessThan(2000);
      const st = (await decodeState(enc))!;
      expect(st).not.toBeNull();
      const w2 = createWorld(map, sc);
      const ctx2 = createStaticContext(map, sc, { mode: 'interactive' });
      const r = replayTo(w2, ctx2, st, () => {});
      expect(r.complete).toBe(true);
      expect(JSON.stringify(w2)).toBe(JSON.stringify(w));
    });
  }

  it('壊れた URL は null', async () => {
    expect(await decodeState('not-a-state')).toBeNull();
  });
});

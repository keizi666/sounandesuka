import { describe, expect, it } from 'vitest';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { replayTo } from '../src/ui/simReplay';
import { loadEntryRuntime, loadIndex } from '../tools/lib/scenarios';

// みんなの遭難記録の「この分岐から」: 記録の選択を分岐点の順で当てて、その分岐の場面で止まる。
// 投稿のあとにモデルが変わって時刻が少しずれても（記録の時刻は 0.1 分に丸めてある）、同じ選択で進められる
describe('記録の分岐から始める', () => {
  const e = loadIndex().find((x) => x.id === 's02_fog_descent')!;
  const { scenario, map } = loadEntryRuntime(e)!;
  const run = runHeadless(map, scenario, { policy: 'bias', seed: scenario.seed });
  const ds = run.world.decisions;
  it('記録に分岐が 3 つ以上ある', () => expect(ds.length).toBeGreaterThanOrEqual(3));
  for (const shift of [0, 0.1, -0.1]) {
    it(`時刻が ${shift} 分ずれていても、最後の分岐の場面で止まる`, () => {
      const k = ds.length - 1;
      const world = createWorld(map, scenario, scenario.seed);
      const ctx = createStaticContext(map, scenario, { mode: 'interactive' });
      const r = replayTo(world, ctx, {
        v: 1,
        mode: 'i',
        d: ds.slice(0, k).map((x) => [x.cpId, x.optionId, x.tMin + shift, x.by === 'user' ? 'u' : 'b']),
        t: ds[k]!.tMin + shift,
        seed: scenario.seed,
        cp: ds[k]!.cpId,
      }, () => {});
      expect(r.complete).toBe(true);
      expect(world.pendingChoice?.cpId).toBe(ds[k]!.cpId);
      expect(world.decisions.map((x) => x.optionId)).toEqual(ds.slice(0, k).map((x) => x.optionId));
    }, 120000);
  }
});

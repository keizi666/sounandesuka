import { describe, expect, it } from 'vitest';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { stepWorld } from '../src/sim/core/step';
import { autoResolve } from '../src/sim/scenario/choices';
import { replayTo } from '../src/ui/simReplay';
import { loadEntryRuntime, loadIndex } from '../tools/lib/scenarios';

// みんなの遭難記録の「この分岐から」: 記録の選択を分岐点の順で当てて、その分岐の場面で止まる。
// 投稿のあとにモデルが変わって時刻が少しずれても（記録の時刻は 0.1 分に丸めてある）、同じ選択で進められる
describe('記録の分岐から始める', () => {
  const e = loadIndex().find((x) => x.id === 's02_fog_descent')!;
  const { scenario, map } = loadEntryRuntime(e)!;
  // 記録は画面で遊んだときと同じ進め方で作る（分岐点が出たティックではそこで止まり、その人らしく自動で決める）
  const rec = createWorld(map, scenario, scenario.seed);
  const recCtx = createStaticContext(map, scenario, { mode: 'interactive' });
  for (let n = 0; n < 30 * 24 * 360 && !rec.ended; n += 1) {
    if (rec.pendingChoice) autoResolve(rec, recCtx, 'bias');
    else stepWorld(rec, recCtx);
    recCtx.events.length = 0;
  }
  const ds = rec.decisions;
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

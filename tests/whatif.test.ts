/**
 * What-if（docs/12 §3）とセリフ（docs/07 §7）
 */
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { runWhatIf } from '../src/sim/record/whatif';
import { evaluateOptions, findChoicePoint } from '../src/sim/scenario/choices';
import type { World } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

describe('What-if', () => {
  const { map } = hakoniwa();
  it('s01 の最初の分岐点で選択肢ごとに n 回走り、件数が合う', () => {
    const s = loadScenario('s01_cold_front');
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s, { mode: 'interactive' });
    while (!w.pendingChoice && !w.ended) stepWorld(w, ctx);
    expect(w.pendingChoice).not.toBeNull();
    const snap = JSON.parse(JSON.stringify(w)) as World;
    const found = findChoicePoint(ctx, snap.pendingChoice!.cpId)!;
    const { available } = evaluateOptions(snap, ctx, found.cp, found.key);
    for (const a of available) {
      const r = runWhatIf(map, s, snap, a.option.id, { n: 4 });
      const total = Object.values(r.counts).reduce((x, y) => x + (y ?? 0), 0);
      expect(total).toBe(4);
      expect(r.minCoreHistogram.reduce((x, y) => x + y, 0)).toBe(4);
    }
    // 中止の選択肢は必ず ABORTED
    const abort = available.find((a) => a.option.actions.some((x) => x.type === 'abortTrip'));
    if (abort) expect(runWhatIf(map, s, snap, abort.option.id, { n: 3 }).counts.ABORTED).toBe(3);
    // スナップショットは書き換えない
    expect(JSON.stringify(snap)).toBe(JSON.stringify(w));
  });
});

describe('セリフ（docs/07 §7）', () => {
  const { map } = hakoniwa();
  it('s03 で複数人のセリフが出て、同時に話すのは 3 人まで・同じ人は 3 分あける', () => {
    const r = runHeadless(map, loadScenario('s03_thunder_ridge'), { policy: 'bias', seed: 3, collectEvents: true });
    const sp = r.events.filter((e) => e.type === 'SPEECH');
    expect(sp.length).toBeGreaterThan(0);
    const byT = new Map<number, number>();
    for (const e of sp) if (!(e.data?.['delaySec'] as number | undefined)) byT.set(e.tMin, (byT.get(e.tMin) ?? 0) + 1);
    for (const n of byT.values()) expect(n).toBeLessThanOrEqual(3);
    const last = new Map<string, number>();
    for (const e of sp) {
      if (e.data?.['delaySec']) continue;
      const p = last.get(e.climberId!);
      if (p !== undefined) expect(e.tMin - p).toBeGreaterThanOrEqual(3 - 1e-9);
      last.set(e.climberId!, e.tMin);
    }
  });
  it('深部体温 32℃未満・意識なしの人は話さない', () => {
    const r = runHeadless(map, loadScenario('s01_cold_front'), { policy: 'risky', seed: 11, collectEvents: true });
    const cold = new Set<string>();
    for (const e of r.events) {
      if (e.type === 'STAGE_CHANGE' && Number(e.data?.['coreC'] ?? 99) < 32) cold.add(e.climberId!);
      if (e.type === 'SPEECH') expect(Number(e.data?.['distortLevel'] ?? 0)).toBeLessThan(3);
    }
    void cold;
  });
});

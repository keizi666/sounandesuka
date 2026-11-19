/** 急病（src/sim/climber/illness.ts）と、通りかかる登山者の較正 */
import { describe, expect, it } from 'vitest';
import { onsetIllness, stepIllness } from '../src/sim/climber/illness';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import type { IllnessKind } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const { map } = hakoniwa();
const s = loadScenario('s01_cold_front');

/** n 人分、発症してから hours 時間、安静（または歩き続ける）で何人亡くなるか */
function deaths(kind: IllnessKind, hours: number, walking: boolean, n = 400): number {
  let dead = 0;
  for (let i = 0; i < n; i += 1) {
    const w = createWorld(map, { ...s, seed: 1000 + i });
    const ctx = createStaticContext(map, s);
    const c = w.climbers[0]!;
    onsetIllness(w, ctx, c, kind);
    const dt = 1;
    for (let m = 0; m < hours * 60 && c.body.alive; m += dt) {
      w.tMin += dt;
      stepIllness(w, ctx, c, dt, walking, 0);
    }
    if (!c.body.alive) dead += 1;
  }
  return dead / n;
}

describe('急病', () => {
  it('心筋梗塞: 安静で 48 時間のうちに 35〜50% が亡くなる（治療なし）', () => {
    const d = deaths('mi', 48, false);
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThan(0.52);
  });
  it('心筋梗塞: 歩き続けると危険が大きく上がる（6 時間）', () => {
    expect(deaths('mi', 6, true)).toBeGreaterThan(deaths('mi', 6, false) * 1.8);
  });
  it('狭心症: 15 分休めば治まる。命に関わることは少ない', () => {
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const c = w.climbers[0]!;
    onsetIllness(w, ctx, c, 'angina');
    for (let m = 0; m < 20; m += 1) {
      w.tMin += 1;
      stepIllness(w, ctx, c, 1, false, 0);
    }
    expect(c.body.illness?.active).toBe(false);
    expect(deaths('angina', 24, false)).toBeLessThan(0.05);
  });
  it('良性（胃・筋肉・パニックなど）: 亡くならない', () => {
    expect(deaths('benign', 24, true, 100)).toBe(0);
  });
});

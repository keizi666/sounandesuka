/** 急病（src/sim/climber/illness.ts）と、通りかかる登山者の較正 */
import { describe, expect, it } from 'vitest';
import { epipen, onsetIllness, stepIllness, sting } from '../src/sim/climber/illness';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import type { IllnessKind } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

const { map } = sounanMap();
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

describe('ハチとアナフィラキシー', () => {
  /** n 人を刺し、hours 時間安静（エピペンは症状が出たら打つ）で、アナフィラキシーになった人数と亡くなった人数 */
  function run(sensitized: boolean, withEpi: boolean, walking: boolean, n = 600): { ana: number; dead: number } {
    let ana = 0;
    let dead = 0;
    for (let i = 0; i < n; i += 1) {
      const s2 = { ...s, seed: 5000 + i, party: s.party.map((p) => ({ ...p, beeSensitized: sensitized, gear: { ...p.gear, epipen: withEpi } })) };
      const w = createWorld(map, s2);
      const ctx = createStaticContext(map, s2);
      const c = w.climbers[0]!;
      sting(w, ctx, c, 1);
      if (c.body.illness?.kind === 'anaphylaxis') ana += 1;
      for (let m = 0; m < 6 * 60 && c.body.alive; m += 1) {
        w.tMin += 1;
        stepIllness(w, ctx, c, 1, walking, 0);
        if (withEpi && c.body.illness?.active && (c.body.illness.epiUntilMin ?? -1) < w.tMin) epipen(w, ctx, c);
      }
      if (!c.body.alive) dead += 1;
    }
    return { ana: ana / n, dead: dead / n };
  }
  it('以前刺されたことがある人はアナフィラキシーを起こしやすい', () => {
    expect(run(false, false, false).ana).toBeLessThan(0.07);
    expect(run(true, false, false).ana).toBeGreaterThan(0.2);
  });
  it('アナフィラキシーは歩くと危険が増え、エピペンで大きく下がる', () => {
    const rest = run(true, false, false).dead;
    const walk = run(true, false, true).dead;
    const epi = run(true, true, false).dead;
    expect(walk).toBeGreaterThan(rest * 1.8);
    expect(epi).toBeLessThan(rest * 0.6);
  });
});

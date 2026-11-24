/**
 * 増水と渡渉（hazards/ford.ts）・雪崩（hazards/avalanche.ts）・子どもを連れた山行（climber/childCare.ts）・高地脳浮腫（climber/altitude.ts）
 * （ユーザーの指定: 屋久島・立山・陣馬山・富士山のシナリオのために足した仕組み）
 */
import { describe, expect, it } from 'vitest';
import { applyActions } from '../src/sim/climber/actions';
import { stepAltitude } from '../src/sim/climber/altitude';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { triggerAvalanche, survivalMinutes } from '../src/sim/hazards/avalanche';
import { crossFord, updateFords } from '../src/sim/hazards/ford';
import { TUNING } from '../src/sim/tuning';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(n: number, edit: (s: ScenarioDef) => void = () => undefined) {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  const base = s.party[0]!;
  s.party = Array.from({ length: n }, (_, i) => ({ ...structuredClone(base), id: `p${i}`, name: `P${i}`, leader: i === 0 }));
  edit(s);
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'interactive' });
  return { w, ctx, s };
}

const FORD = { id: 'f1', name: '白谷川', x: 0, z: 0, baseCm: 20, gainCmPerMmH: 3, riseMin: 30, fallMin: 120, wadeCm: 45, sweepCm: 70 };

describe('増水と渡渉', () => {
  it('強い雨で水位が上がり、雨がやむと時間をかけて引く', () => {
    const { w, ctx } = setup(1, (s) => (s.fords = [FORD]));
    w.weather.precipMmH = 30;
    for (let i = 0; i < 90; i += 1) updateFords(w, ctx);
    const high = w.fords!['f1']!;
    expect(high).toBeGreaterThan(70);
    w.weather.precipMmH = 0;
    for (let i = 0; i < 60; i += 1) updateFords(w, ctx);
    const after1h = w.fords!['f1']!;
    expect(after1h).toBeLessThan(high);
    expect(after1h).toBeGreaterThan(FORD.baseCm + 10); // 引くのはゆっくり
  });

  it('ふだんの水位なら誰も流されない。濁流（sweepCm を大きく超える）なら多くが流される。ロープで確保すると減る', () => {
    const swept = (level: number, rope: boolean): number => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const { w, ctx } = setup(3, (s) => {
          s.fords = [FORD];
          s.seed = seed;
        });
        w.fords = { f1: level };
        const before = ctx.events.length;
        crossFord(w, ctx, w.climbers, 'f1', rope);
        n += ctx.events.slice(before).filter((e) => e.data?.['swept'] !== undefined).length;
      }
      return n;
    };
    expect(swept(25, false)).toBe(0);
    const raw = swept(100, false);
    const roped = swept(100, true);
    expect(raw).toBeGreaterThan(60);
    expect(roped).toBeLessThan(raw / 2);
  });
});

describe('雪崩', () => {
  it('生存率の曲線: 15 分までは高く、35 分までに急に下がる', () => {
    const c = TUNING.avalanche.survivalCurve;
    expect(survivalMinutes(0.95, c)).toBeLessThan(15);
    expect(survivalMinutes(0.5, c)).toBeGreaterThan(15);
    expect(survivalMinutes(0.5, c)).toBeLessThan(35);
    expect(survivalMinutes(0.1, c)).toBeGreaterThan(90);
  });

  it('範囲の中の 2 人が埋まり、ビーコンとシャベルがあれば短い時間で掘り出す。何もなければずっと長くかかる', () => {
    const run = (gear: boolean, helpers: number): number => {
      const { w, ctx } = setup(4, (s) => {
        for (const p of s.party) Object.assign(p.gear, { beacon: gear, probe: gear, shovel: gear });
      });
      for (const c of w.climbers) {
        c.x = 0;
        c.z = 0;
      }
      triggerAvalanche(w, ctx, { x: 0, z: 0, radiusM: 50, maxBuried: 2, depthM: [1, 1] }, w.climbers[0]!);
      const buried = w.climbers.filter((c) => c.body.buried);
      expect(buried).toHaveLength(2);
      applyActions(w, ctx, [{ type: 'avalancheRescue', helpers }], w.climbers.filter((c) => !c.body.buried), w.climbers[2]!);
      return Math.max(...w.avalancheDig!.map((d) => d.atMin - w.tMin));
    };
    const fast = run(true, 0);
    const slow = run(false, 0);
    const helped = run(false, 6);
    expect(fast).toBeLessThan(30);
    expect(slow).toBeGreaterThan(fast * 3);
    expect(helped).toBeLessThan(slow);
  });
});

describe('子どもを連れた山行', () => {
  it('おんぶ: 子どもは歩かずについてきて、背負う人は重くなる。時間が来たら下ろす', () => {
    const { w, ctx } = setup(2, (s) => {
      s.party[1] = { ...s.party[1]!, age: 9, weightKg: 28, packKg: 2 };
    });
    for (let i = 0; i < 30; i += 1) stepWorld(w, ctx);
    const [dad, kid] = w.climbers as [(typeof w.climbers)[0], (typeof w.climbers)[0]];
    applyActions(w, ctx, [{ type: 'piggyback', who: dad.id, rider: kid.id, minutes: 10 }], w.climbers, dad);
    expect(dad.plan.carryKg).toBeCloseTo(30, 5);
    for (let i = 0; i < 6 * 5; i += 1) stepWorld(w, ctx);
    expect(kid.metAct).toBeLessThan(dad.metAct);
    expect(Math.hypot(kid.x - dad.x, kid.z - dad.z)).toBeLessThan(5);
    for (let i = 0; i < 6 * 7; i += 1) stepWorld(w, ctx);
    expect(kid.plan.ridingUntilMin).toBeNull();
    expect(dad.plan.carryKg).toBe(0);
  });

  it('荷物を代わりに持つ: 子どもは空身、親の荷物が増える', () => {
    const { w, ctx } = setup(2, (s) => {
      s.party[1] = { ...s.party[1]!, age: 9, weightKg: 28, packKg: 3 };
    });
    const [dad, kid] = w.climbers as [(typeof w.climbers)[0], (typeof w.climbers)[0]];
    applyActions(w, ctx, [{ type: 'takePack', who: dad.id, from: kid.id }], w.climbers, dad);
    expect(kid.plan.packDeltaKg).toBeCloseTo(-3, 5);
    expect(dad.plan.packDeltaKg).toBeCloseTo(3, 5);
  });
});

describe('高地脳浮腫', () => {
  it('続くと意識がなくなり、さらに続くと亡くなる。下ろせば点が下がる', () => {
    const { w, ctx } = setup(1);
    const c = w.climbers[0]!;
    c.elevM = 3400;
    c.body.ams = 95;
    c.body.acclimElevM = 1000;
    const a = TUNING.altitude;
    for (let m = 0; m < a.haceUnconsciousH * 60 + 5; m += 1) stepAltitude(w, ctx, c, 1);
    expect(c.body.haceMin).toBeGreaterThan(a.haceUnconsciousH * 60);
    expect(c.body.alive).toBe(true);
    for (let m = 0; m < (a.haceDeathH - a.haceUnconsciousH) * 60; m += 1) stepAltitude(w, ctx, c, 1);
    expect(c.body.alive).toBe(false);
    expect(c.body.deathCause).toBe('hace');
  });
});

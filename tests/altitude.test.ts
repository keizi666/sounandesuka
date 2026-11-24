/**
 * 高い所の体への影響と、靴の滑りやすさ（ユーザーの指定）。src/sim/climber/altitude.ts・src/sim/hazards/slip.ts
 */
import { describe, expect, it } from 'vitest';
import { amsLevelOf, stepAltitude } from '../src/sim/climber/altitude';
import { usableMet } from '../src/sim/climber/movement';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { slipP10 } from '../src/sim/hazards/slip';
import type { ClimberState, ScenarioDef } from '../src/sim/types';
import { hpOf } from '../src/ui/hp';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(age: number) {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  s.party = [{ ...s.party[0]!, age }];
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'interactive' });
  return { w, ctx, c: w.climbers[0]! };
}

/** elevM の高さに hours 時間いる（10 分刻み） */
function stay(env: ReturnType<typeof setup>, c: ClimberState, elevM: number, hours: number): void {
  for (let i = 0; i < hours * 6; i += 1) {
    c.elevM = elevM;
    stepAltitude(env.w, env.ctx, c, 10);
  }
}

describe('高山病', () => {
  it('2,500 m より下では起きない', () => {
    const env = setup(25);
    stay(env, env.c, 2300, 24);
    expect(env.c.body.ams ?? 0).toBe(0);
  });

  it('20 代が 3,700 m に着くと数時間で頭痛（軽い高山病）、半日ほどで高地脳浮腫になり、下ると治まる', () => {
    const env = setup(25);
    const c = env.c;
    stay(env, c, 3700, 2);
    expect(amsLevelOf(c.body.ams, env.ctx.tuning)).toBe('none');
    stay(env, c, 3700, 2);
    expect(amsLevelOf(c.body.ams, env.ctx.tuning)).toBe('mild');
    stay(env, c, 3700, 10);
    expect(amsLevelOf(c.body.ams, env.ctx.tuning)).toBe('hace');
    stay(env, c, 2000, 8);
    expect(amsLevelOf(c.body.ams, env.ctx.tuning)).toBe('none');
    expect(c.body.amsMax ?? 0).toBeGreaterThanOrEqual(env.ctx.tuning.altitude.amsHace);
  });

  it('年配の人は起きにくい（同じ時間・高さで点が低い）', () => {
    const young = setup(25);
    const old = setup(60);
    stay(young, young.c, 3500, 6);
    stay(old, old.c, 3500, 6);
    expect(old.c.body.ams ?? 0).toBeLessThan(young.c.body.ams ?? 0);
  });

  it('段階が上がると、判断力と運動能力が下がり、ログに出る', () => {
    const env = setup(25);
    const c = env.c;
    stay(env, c, 3776, 14);
    const logs = env.ctx.events.filter((e) => e.type === 'SCRIPT_LOG' && e.climberId === c.id && typeof e.data?.['ams'] === 'string').map((e) => e.data!['ams']);
    expect(logs).toEqual(['mild', 'moderate', 'hace']);
  });

  it('重い高山病では、休んでいても疲れが抜けず、体力（HP）の表示も下がる（ユーザーの指摘: 体力 99・疲労 0 だった）', () => {
    const env = setup(25);
    const c = env.c;
    expect(hpOf(c.body)).toBeGreaterThan(95);
    stay(env, c, 3700, 8);
    expect(amsLevelOf(c.body.ams, env.ctx.tuning)).toBe('moderate');
    expect(c.body.fatigue).toBeGreaterThanOrEqual(40);
    expect(hpOf(c.body)).toBeLessThan(75);
  });
});

describe('酸素の薄さ', () => {
  it('高い所ほど、出せる力の上限が下がる', () => {
    const env = setup(40);
    const c = env.c;
    c.elevM = 1000;
    const low = usableMet(c, env.ctx.tuning);
    c.elevM = 3776;
    const high = usableMet(c, env.ctx.tuning);
    expect(high / low).toBeCloseTo(1 - 0.1 * 2.276, 2);
  });
});

describe('靴', () => {
  it('スニーカーは登山靴より転びやすく、下りでさらに差が開く', () => {
    const env = setup(40);
    const c = env.c;
    const p = (shoe: 'sneakers' | 'hikingBoots', down: boolean): number => {
      c.def = { ...c.def, gear: { ...c.def.gear, footwear: shoe } };
      return slipP10(env.w, env.ctx, c, 'T2', down);
    };
    expect(p('sneakers', false) / p('hikingBoots', false)).toBeCloseTo(1.6, 5);
    expect(p('sneakers', true) / p('hikingBoots', true)).toBeCloseTo(1.6 * 1.5, 5);
  });
});

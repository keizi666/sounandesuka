import { describe, expect, it } from 'vitest';
import { computeJ, computeM, piecewise, stageOf, updateCapacity } from '../src/sim/climber/capacity';
import { usableMet } from '../src/sim/climber/movement';
import { bodyArea, rainProtection, shiverMet, thermalEnvFor } from '../src/sim/climber/physiology';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { TUNING } from '../src/sim/tuning';
import type { SimEvent } from '../src/sim/types';
import { calibClimber } from './helpers/calib';
import { sounanMap } from './helpers/map';
import { loadScenario, testScenario } from './helpers/scenario';

describe('判断力 J・運動能力 M（docs/06 §6）', () => {
  it('表の線形補間', () => {
    expect(piecewise(TUNING.capacity.coreJ, 37)).toBe(1);
    expect(piecewise(TUNING.capacity.coreJ, 34.5)).toBeCloseTo(0.65, 9);
    expect(piecewise(TUNING.capacity.coreJ, 29)).toBe(0.05);
    // 33℃ 台は重度: 動きは半分以下
    expect(piecewise(TUNING.capacity.coreM, 33.5)).toBeCloseTo(0.45, 9);
  });

  it('J は経験・体温・疲労・不安・脱水で下がる', () => {
    const c = calibClimber({ hours: 0, env: {} });
    expect(computeJ(c)).toBeCloseTo(0.4 + 0.6 * 0.5, 9);
    c.body.coreC = 34;
    expect(computeJ(c)).toBeCloseTo(0.7 * 0.5, 9);
    c.body.coreC = 37;
    c.body.anxiety = 80;
    c.body.waterDeficitL = 3;
    expect(computeJ(c)).toBeCloseTo(0.7 * 0.75 * 0.9, 9);
  });

  it('M は体温・負傷・グリコーゲンで下がり、意識がなければ 0', () => {
    const c = calibClimber({ hours: 0, env: {} });
    expect(computeM(c)).toBe(1);
    c.body.injury = 'sprain';
    expect(computeM(c)).toBeCloseTo(0.45, 9);
    c.body.injury = 'none';
    c.body.coreC = 30;
    expect(computeM(c)).toBe(0);
    c.body.coreC = 37;
    c.body.conscious = false;
    expect(computeM(c)).toBe(0);
  });

  it('段階の境目（docs/06 §7）', () => {
    expect(stageOf(36.0)).toBe('normal');
    expect(stageOf(35.99)).toBe('cold');
    expect(stageOf(34.9)).toBe('mild');
    expect(stageOf(33.9)).toBe('moderate');
    // 33℃ 台は重度（山での目安。ユーザーの指定）
    expect(stageOf(33.4)).toBe('severe');
    expect(stageOf(39.1)).toBe('heatExhaustion');
    expect(stageOf(40.6)).toBe('heatStroke');
  });

  it('脱水で使える MET が下がる', () => {
    const c = calibClimber({ hours: 0, env: {} });
    const base = usableMet(c);
    c.body.waterDeficitL = 2.5;
    expect(usableMet(c)).toBeCloseTo(base * 0.85, 9);
  });
});

describe('震え・雨具・体表面積', () => {
  it('震えは 36.8℃ 未満で始まり、32℃ から弱まって 30℃ で消える。歩行中は目立たない', () => {
    const c = calibClimber({ hours: 0, env: {} });
    c.body.coreC = 37;
    expect(shiverMet(c, 1.4)).toBe(0);
    c.body.coreC = 35;
    expect(shiverMet(c, 1.4)).toBe(3);
    expect(shiverMet(c, 5)).toBeCloseTo(1.2, 9);
    c.body.coreC = 31;
    expect(shiverMet(c, 1.4)).toBeCloseTo(1.5, 9);
    c.body.coreC = 30;
    expect(shiverMet(c, 1.4)).toBe(0);
  });

  it('糖質が尽きても震えは 6 割は残る。高齢では弱い', () => {
    const c = calibClimber({ hours: 0, env: {} });
    c.body.coreC = 35;
    c.body.glycogenKcal = 0;
    expect(shiverMet(c, 1.4)).toBeCloseTo(1.8, 9);
    const old = calibClimber({ hours: 0, env: {}, def: { age: 70 } });
    old.body.coreC = 35;
    expect(shiverMet(old, 1.4)).toBeCloseTo(3 * 0.7, 9);
  });

  it('雨具の防水率: goretex 0.95、basic は 3 時間を超えると劣化、ポンチョは強風で役に立たない', () => {
    const c = calibClimber({ hours: 0, env: {}, gear: { rainwear: 'basic' }, body: { rainwearOn: true } });
    expect(rainProtection(c, 5)).toBe(0.8);
    c.body.rainExposureMin = 5 * 60;
    expect(rainProtection(c, 5)).toBeCloseTo(0.8 * 0.8, 9);
    const p = calibClimber({ hours: 0, env: {}, gear: { rainwear: 'poncho' }, body: { rainwearOn: true } });
    expect(rainProtection(p, 20)).toBe(0);
    const off = calibClimber({ hours: 0, env: {}, gear: { rainwear: 'goretex' } });
    expect(rainProtection(off, 5)).toBe(0);
  });

  it('体表面積は 65 kg で 1.8 m²、小柄なほど体重あたりで大きい', () => {
    expect(bodyArea(65)).toBeCloseTo(1.8, 9);
    expect(bodyArea(50) / 50).toBeGreaterThan(bodyArea(80) / 80);
  });
});

describe('熱環境（docs/06 §3.1）', () => {
  const { map } = sounanMap();

  it('営業小屋は 18℃・無風・食事、避難小屋は気温 +5・無風', () => {
    const sc = testScenario(['HUT_RIDGE', 'SUMMIT']);
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const c = w.climbers[0]!;
    c.body.shelterNodeId = 'HUT_RIDGE';
    const env = thermalEnvFor(w, ctx, c);
    expect(env).toMatchObject({ tairC: 18, windMs: 0, precipMmH: 0, staffed: true });
    c.body.shelterNodeId = 'SADDLE_N';
    const em = thermalEnvFor(w, ctx, c);
    expect(em.tairC).toBeCloseTo(c.local.tempC + 5, 9);
    expect(em.staffed).toBe(false);
  });

  it('風下とツェルトは重ねて効き、ビバーク中は地面に接する', () => {
    const sc = testScenario(['SUMMIT', 'HUT_RIDGE']);
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const c = w.climbers[0]!;
    c.local.windMs = 10;
    c.state = 'BIVOUAC';
    c.body.leeShelter = 0.5;
    c.body.inBivy = true;
    const env = thermalEnvFor(w, ctx, c);
    expect(env.windMs).toBeCloseTo(10 * 0.5 * 0.08, 9);
    expect(env.wetInputF).toBe(0);
    expect(env.groundContact).toBe(true);
    c.state = 'WALKING';
    expect(thermalEnvFor(w, ctx, c).groundContact).toBe(false);
  });
});

describe('意識と生死（docs/06 §7）', () => {
  const { map } = sounanMap();
  const setup = (): { w: ReturnType<typeof createWorld>; ctx: ReturnType<typeof createStaticContext> } => {
    const sc = testScenario(['SUMMIT', 'HUT_RIDGE']);
    return { w: createWorld(map, sc), ctx: createStaticContext(map, sc) };
  };

  it('28℃ 未満で意識を失い、24℃ で死亡する', () => {
    const { w, ctx } = setup();
    const c = w.climbers[0]!;
    c.body.coreC = 27.5;
    updateCapacity(w, ctx, c, false);
    expect(c.body.conscious).toBe(false);
    expect(c.state).toBe('UNCONSCIOUS');
    expect(c.M).toBe(0);
    c.body.coreC = 24;
    updateCapacity(w, ctx, c, false);
    expect(c.body.alive).toBe(false);
    expect(c.body.deathCause).toBe('hypothermia');
    expect(c.state).toBe('DEAD');
    expect(ctx.events.some((e) => e.type === 'DEATH')).toBe(true);
  });

  it('M が 0 になると行動不能（INCAPACITATED）', () => {
    const { w, ctx } = setup();
    const c = w.climbers[0]!;
    c.body.injury = 'severeTrauma';
    updateCapacity(w, ctx, c, false);
    expect(c.state).toBe('INCAPACITATED');
  });

  it('心停止の判定は 28℃ 未満・10 分ごとだけ、hazard ストリームで決定論的', () => {
    const run = (): number => {
      const { w, ctx } = setup();
      const c = w.climbers[0]!;
      let i = 0;
      for (; i < 1000 && c.body.alive; i += 1) {
        c.body.coreC = 26;
        updateCapacity(w, ctx, c, true);
      }
      return i;
    };
    expect(run()).toBe(run());
    expect(run()).toBeLessThan(100); // p = 0.14 / 回
    const { w, ctx } = setup();
    const c = w.climbers[0]!;
    for (let i = 0; i < 1000; i += 1) {
      c.body.coreC = 28.5;
      updateCapacity(w, ctx, c, true);
    }
    expect(c.body.alive).toBe(true);
  });
});

describe('World に組み込んだ生理', () => {
  it('s01 で何もしない（雨具を着ない・食べない）と、寒冷前線の雨で低体温症が進む', () => {
    const { map } = sounanMap();
    // 分岐点なし・雨具なし・食べ物なしで歩き続ける
    const base = loadScenario('s01_cold_front');
    const m = base.party[0]!;
    const off = { enabled: false };
    const genericOverrides = { lostAware: off, darkness: off, hypothermia: off, injured: off, lightning: off, waterfall: off, straggler: off, rescueFailed: off };
    const sc = { ...base, choices: [], events: [], genericOverrides, party: [{ ...m, gear: { ...m.gear, rainwear: 'none' as const, foodKcal: 0 } }] };
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const events: SimEvent[] = [];
    while (w.tMin < 20 * 60 && !w.ended) {
      stepWorld(w, ctx);
      events.push(...ctx.events);
      ctx.events.length = 0;
    }
    const c = w.climbers[0]!;
    expect(c.body.coreC).toBeLessThan(35);
    const stages = events.filter((e) => e.type === 'STAGE_CHANGE').map((e) => e.data?.['to']);
    expect(stages.slice(0, 2)).toEqual(['cold', 'mild']);
  });

  it('晴れの短い山行では体温・エネルギーが保たれる', () => {
    const { map } = sounanMap();
    const sc = testScenario(['TH_SAWA', 'J_FOREST', 'EBOSHI']);
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    for (let i = 0; i < 6 * 60 * 5 && !w.ended; i += 1) stepWorld(w, ctx);
    const c = w.climbers[0]!;
    expect(c.state).toBe('FINISHED');
    expect(c.body.coreC).toBeGreaterThan(36.5);
    expect(c.body.glycogenKcal).toBeGreaterThan(500);
    expect(c.body.fatigue).toBeGreaterThan(0);
  });
});

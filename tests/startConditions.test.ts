/**
 * 始まりの条件を変えて試す（天気・気温・季節・体調）
 */
import { describe, expect, it } from 'vitest';
import { computeJ, computeM } from '../src/sim/climber/capacity';
import { createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import { applyConditions, DEFAULT_CONDITIONS, isDefaultConditions } from '../src/sim/scenario/startConditions';
import { validateScenario } from '../src/sim/scenario/validate';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

describe('始まりの条件', () => {
  const { map } = hakoniwa();
  const s0 = loadScenario('s01_cold_front');

  it('何も変えなければ元のシナリオのまま', () => {
    expect(isDefaultConditions(DEFAULT_CONDITIONS)).toBe(true);
    expect(applyConditions(s0, DEFAULT_CONDITIONS)).toBe(s0);
  });

  it('天気・気温・季節を変えると、写しの気象と日付が変わり、元は変わらない', () => {
    const before = JSON.stringify(s0);
    const s = applyConditions(s0, { ...DEFAULT_CONDITIONS, weather: 'rain', tempOffsetC: -5, season: 'winter' });
    expect(JSON.stringify(s0)).toBe(before);
    expect(s.weather.keyframes.every((k) => k.precipMmH >= 5)).toBe(true);
    expect(s.startDate.slice(5, 7)).toBe('01');
    expect(s.season).toBe('winter');
    expect(s.weather.keyframes[0]!.tempC).toBeLessThan(s0.weather.keyframes[0]!.tempC - 5);
    expect(validateScenario(s, map.def).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('体調: 寝不足は判断力、風邪は運動能力が下がり、疲れは始まりの疲労が多い', () => {
    const id = s0.party[0]!.id;
    const base = createWorld(map, s0).climbers[0]!;
    const sleepy = createWorld(map, applyConditions(s0, { ...DEFAULT_CONDITIONS, health: { [id]: 'sleepy' } })).climbers[0]!;
    const cold = createWorld(map, applyConditions(s0, { ...DEFAULT_CONDITIONS, health: { [id]: 'cold' } })).climbers[0]!;
    const tired = createWorld(map, applyConditions(s0, { ...DEFAULT_CONDITIONS, health: { [id]: 'tired' } })).climbers[0]!;
    expect(computeJ(sleepy)).toBeLessThan(computeJ(base));
    expect(computeM(cold)).toBeLessThan(computeM(base));
    expect(tired.body.fatigue).toBeGreaterThan(base.body.fatigue);
  });

  it('条件を全部変えても、最後まで走る', { timeout: 60000 }, () => {
    for (const weather of ['clear', 'fog', 'snow', 'storm'] as const) {
      const s = applyConditions(s0, { weather, tempOffsetC: 3, season: 'summer', health: Object.fromEntries(s0.party.map((p) => [p.id, 'tired'])) });
      const r = runHeadless(map, s, { seed: 2 });
      expect(r.world.ended).not.toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { eraGear } from '../src/sim/scenario/era';
import { TUNING } from '../src/sim/tuning';
import type { GearDef } from '../src/sim/types';

const full = (): GearDef => ({
  rainwear: 'goretex', cloWorn: 1, cloPack: 1, gloves: 'thin', hat: true, bivy: 'none',
  headlamp: { has: true, batteryH: 8, inPack: false, spareBatteryH: 0 },
  phone: { has: true, batteryPct: 90, gpsApp: true, trackRecording: true, satelliteSos: true },
  map: true, compass: true, foodKcal: 1000, waterL: 1, stove: false, crampons: false, helmet: false, trekkingPoles: false, whistle: true,
  cocoheli: true, powerBankMah: 10000,
});

describe('電子機器はシナリオの年代に合わせる', () => {
  it('1967 年: 携帯電話もバッテリーもココヘリもない', () => {
    const g = eraGear(full(), 1967, TUNING);
    expect(g.phone.has).toBe(false);
    expect(g.powerBankMah).toBe(0);
    expect(g.cocoheli).toBe(false);
  });
  it('2006 年: 携帯電話はあるが、地図アプリ・衛星 SOS・バッテリー・ココヘリはない', () => {
    const g = eraGear(full(), 2006, TUNING);
    expect(g.phone.has).toBe(true);
    expect(g.phone.gpsApp).toBe(false);
    expect(g.phone.satelliteSos).toBe(false);
    expect(g.powerBankMah).toBe(0);
    expect(g.cocoheli).toBe(false);
  });
  it('2026 年: すべてある（そのまま）', () => {
    const g0 = full();
    expect(eraGear(g0, 2026, TUNING)).toBe(g0);
  });
});

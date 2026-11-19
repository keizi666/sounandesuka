/** 総合の体力（HP）の目安（src/ui/hp.ts）と、顔アイコンの割り当て（src/ui/avatar.ts の portraitOf） */
import { describe, expect, it } from 'vitest';
import { hpLevel, hpOf, type HpInput } from '../src/ui/hp';

const ok: HpInput = { coreC: 37, glycogenKcal: 1500, waterDeficitL: 0, fatigue: 10, injury: 'none', conscious: true, alive: true };

describe('総合の体力（HP）', () => {
  it('元気なら 100、死亡で 0。生きている間は 1 以上', () => {
    expect(hpOf(ok)).toBe(100);
    expect(hpOf({ ...ok, alive: false })).toBe(0);
    expect(hpOf({ ...ok, coreC: 24.1, glycogenKcal: 0, waterDeficitL: 6, fatigue: 100, conscious: false })).toBeGreaterThanOrEqual(1);
  });
  it('深部体温が下がるほど減り、死亡の境目（24℃）に向かって 0 に近づく', () => {
    const at = (c: number): number => hpOf({ ...ok, coreC: c });
    expect(at(36)).toBeLessThan(at(37));
    expect(at(34)).toBeLessThan(at(36));
    expect(at(30)).toBeLessThan(at(34));
    expect(at(25)).toBeLessThan(10);
  });
  it('高体温でも減る（42℃ に向かって 0 に近づく）', () => {
    expect(hpOf({ ...ok, coreC: 40 })).toBeLessThan(70);
    expect(hpOf({ ...ok, coreC: 41.8 })).toBeLessThan(10);
  });
  it('けがは上限を決め、意識がなければ 15 以下', () => {
    expect(hpOf({ ...ok, injury: 'sprain' })).toBe(85);
    expect(hpOf({ ...ok, injury: 'severeTrauma' })).toBe(20);
    expect(hpOf({ ...ok, conscious: false })).toBeLessThanOrEqual(15);
  });
  it('消耗（エネルギー切れ・脱水・疲労）で割り引かれるが、それだけでは半分を切らない', () => {
    const worn = hpOf({ ...ok, glycogenKcal: 0, waterDeficitL: 5, fatigue: 100 });
    expect(worn).toBeLessThan(70);
    expect(worn).toBeGreaterThan(50);
  });
  it('段階', () => {
    expect([100, 60, 30, 10].map(hpLevel)).toEqual(['ok', 'warn', 'danger', 'critical']);
  });
});

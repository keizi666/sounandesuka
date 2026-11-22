// 成績の判定の揺れの幅（Wilson の区間）と 3 段階の判定
import { describe, expect, it } from 'vitest';
import { checkTargets, wilson, type McSummary } from '../src/sim/mc';

const sum = (n: number, fatal: number, deaths: [number, number] = [0, 0]): McSummary => ({
  scenarioId: 't',
  policy: 'bias',
  n,
  counts: { SAFE_RETURN: n - fatal, SAFE_SHELTER: 0, ABORTED: 0, SELF_RESCUE: 0, RESCUED: 0, RESCUED_CRITICAL: 0, MISSING: 0, FATAL: fatal },
  deathCauses: {},
  minCore: { p10: 37, p50: 37, p90: 37 },
  lostRate: 0,
  deathCountMedian: deaths[0],
  deathCountCi: deaths,
  choices: {},
  msPerRun: 0,
});

describe('成績の判定', () => {
  it('Wilson の区間は点の値を含み、回数が増えると狭くなる', () => {
    const [a, b] = wilson(50, 100);
    expect(a).toBeLessThan(0.5);
    expect(b).toBeGreaterThan(0.5);
    const [c, d] = wilson(200, 400);
    expect(d - c).toBeLessThan(b - a);
    expect(wilson(0, 100)[0]).toBe(0);
  });

  it('区間ごと目標の内なら合格、またげば境目、外なら不合格', () => {
    expect(checkTargets(sum(400, 240), { fatalMin: 0.5 })[0]!.verdict).toBe('ok');
    expect(checkTargets(sum(100, 49), { fatalMin: 0.5 })[0]!.verdict).toBe('border');
    expect(checkTargets(sum(300, 137), { fatalMin: 0.55 })[0]!.verdict).toBe('ng');
    // 点では不合格でも、揺れの幅のうちなら境目
    const c = checkTargets(sum(100, 49), { fatalMin: 0.5 })[0]!;
    expect(c.ok).toBe(false);
  });

  it('死亡者数の中央値は区間で判定する', () => {
    expect(checkTargets(sum(100, 90, [6, 7]), { deathCountMedian: [4, 11] })[0]!.verdict).toBe('ok');
    expect(checkTargets(sum(100, 90, [3, 5]), { deathCountMedian: [4, 11] })[0]!.verdict).toBe('border');
    expect(checkTargets(sum(100, 90, [1, 2]), { deathCountMedian: [4, 11] })[0]!.verdict).toBe('ng');
  });
});

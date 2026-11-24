/** 週替わりのお題（src/app/weekly.ts）と季節（src/app/season.ts） */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentSeason, seasonOfMonth } from '../src/app/season';
import { weekOf, weekRange, weekSeed, weeklyPick } from '../src/app/weekly';
import type { ScenarioIndexEntry } from '../src/sim/types';

const index = JSON.parse(readFileSync('public/scenarios/index.json', 'utf8')) as ScenarioIndexEntry[];
const jst = (y: number, m: number, d: number, h = 0): number => Date.UTC(y, m - 1, d, h) - 9 * 3600000;

describe('週替わりのお題', () => {
  it('月曜 0 時（日本時間）に週が替わる', () => {
    expect(weekOf(jst(2026, 1, 5))).toBe(1);
    expect(weekOf(jst(2026, 1, 11, 23))).toBe(1);
    expect(weekOf(jst(2026, 1, 12))).toBe(2);
    expect(weekRange(weekOf(jst(2026, 11, 25)))).toEqual({ from: '11/23', to: '11/29' });
  });
  it('同じ週なら、誰が見ても同じシナリオと種。史実のシナリオは選ばない。前の週と同じにならない', () => {
    for (let w = 40; w < 120; w += 1) {
      const a = weeklyPick(index, w);
      expect(a).not.toBeNull();
      expect(a!.historical).not.toBe(true);
      expect(weeklyPick(index, w)!.id).toBe(a!.id);
      expect(weeklyPick(index, w - 1)!.id).not.toBe(a!.id);
      expect(weekSeed(w)).toBe(weekSeed(w));
      expect(weekSeed(w)).toBeGreaterThan(0);
    }
    expect(weekSeed(10)).not.toBe(weekSeed(11));
  });
  it('季節に合うシナリオから選ぶ（11 月の週は秋）', () => {
    const w = weekOf(jst(2026, 11, 25));
    expect(weeklyPick(index, w)!.season).toBe('autumn');
  });
});

describe('季節', () => {
  it('月から季節', () => {
    expect([1, 3, 6, 9, 12].map(seasonOfMonth)).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter']);
    expect(currentSeason(jst(2026, 1, 15))).toBe('winter');
  });
});

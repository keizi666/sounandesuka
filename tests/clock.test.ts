import { describe, expect, it } from 'vitest';
import {
  clockMinOf,
  dateAt,
  formatClock,
  formatTimeRef,
  nextSunriseTMin,
  parseHHMM,
  parseTimeRef,
  solarElevationDeg,
  sunParamsOf,
  tryParseTimeRef,
} from '../src/sim/core/clock';

describe('TimeRef', () => {
  it('解析と表示が往復する', () => {
    expect(parseTimeRef('D0 05:30')).toBe(330);
    expect(parseTimeRef('D1 12:00')).toBe(1440 + 720);
    expect(parseTimeRef('D0 00:00')).toBe(0);
    expect(parseTimeRef('D0 23:59')).toBe(1439);
    for (const t of [0, 330, 1439, 1440, 2160, 9 * 1440 + 59]) expect(parseTimeRef(formatTimeRef(t))).toBe(t);
  });

  it('不正な書式は null / 例外', () => {
    for (const bad of ['D0 5:30', 'D0 24:00', 'D0 12:60', 'd0 05:30', 'D10 05:30', 'D0  05:30', '05:30']) {
      expect(tryParseTimeRef(bad)).toBeNull();
    }
    expect(() => parseTimeRef('D0 25:00')).toThrow(/TimeRef/);
  });

  it('表示は分を切り捨て、日付をまたぐ', () => {
    expect(formatClock(330.9)).toBe('05:30');
    expect(formatTimeRef(1440 + 65.5)).toBe('D1 01:05');
    expect(clockMinOf(1440 + 10)).toBe(10);
    expect(clockMinOf(-10)).toBe(1430);
  });

  it('HH:MM の解析', () => {
    expect(parseHHMM('05:52')).toBe(352);
    expect(() => parseHHMM('5:52')).toThrow();
  });
});

describe('日付', () => {
  it('月末・年末・うるう年をまたぐ', () => {
    expect(dateAt('2026-10-17', 0)).toEqual({ year: 2026, month: 10, day: 17 });
    expect(dateAt('2026-10-31', 1440)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(dateAt('2026-12-31', 1440 + 5)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(dateAt('2028-02-28', 1440)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(dateAt('2027-02-28', 1440)).toEqual({ year: 2027, month: 3, day: 1 });
  });

  it('存在しない日付は例外', () => {
    expect(() => dateAt('2026-02-30', 0)).toThrow();
    expect(() => dateAt('2026/10/17', 0)).toThrow();
  });
});

describe('太陽高度', () => {
  const p = sunParamsOf({ sunrise: '05:52', sunset: '17:04', maxElevDeg: 42 }, 'autumn');

  it('日の出・日の入りで 0、南中で最大', () => {
    expect(solarElevationDeg(352, p)).toBeCloseTo(0, 9);
    expect(solarElevationDeg(1024, p)).toBeCloseTo(0, 9);
    expect(solarElevationDeg((352 + 1024) / 2, p)).toBeCloseTo(42, 9);
  });

  it('夜は負で、真夜中付近で最も低い（伏角 = 108 − 南中高度）', () => {
    const midNight = 1024 + (1440 - (1024 - 352)) / 2; // 日の入りから夜の長さの半分
    expect(solarElevationDeg(midNight, p)).toBeCloseTo(-(108 - 42), 6);
    expect(solarElevationDeg(1440 + 60, p)).toBeLessThan(0);
    expect(solarElevationDeg(1440 + 352 + 60, p)).toBeGreaterThan(0);
  });

  it('日の入りから −6° までの薄明は 15〜45 分', () => {
    let t = 1024;
    while (solarElevationDeg(t, p) > -6) t += 1;
    expect(t - 1024).toBeGreaterThanOrEqual(15);
    expect(t - 1024).toBeLessThanOrEqual(45);
  });

  it('maxElevDeg を省略すると季節の既定値', () => {
    expect(sunParamsOf({ sunrise: '04:30', sunset: '19:00' }, 'summer').maxElevDeg).toBe(75);
    expect(sunParamsOf({ sunrise: '06:50', sunset: '16:30' }, 'winter').maxElevDeg).toBe(32);
  });

  it('次の日の出', () => {
    expect(nextSunriseTMin(300, p)).toBe(352);
    expect(nextSunriseTMin(352, p)).toBe(1440 + 352);
    expect(nextSunriseTMin(1200, p)).toBe(1440 + 352);
  });

  it('日の入りが日の出より前なら例外', () => {
    expect(() => sunParamsOf({ sunrise: '18:00', sunset: '06:00' }, 'autumn')).toThrow();
  });
});

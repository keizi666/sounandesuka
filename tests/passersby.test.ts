import { describe, expect, it } from 'vitest';
import { isBusyDay } from '../src/sim/rescue/passersby';

describe('通りかかる人の多い日（土日祝）', () => {
  const cases: [string, number, boolean][] = [
    ['2026-10-03', 0, true], // 土
    ['2026-10-04', 0, true], // 日
    ['2026-04-15', 0, false], // 水
    ['2026-04-15', 1, false], // 木
    ['2026-04-15', 3, true], // 土（4/18）
    ['2027-01-03', 0, true], // 日
    ['2026-01-12', 0, true], // 成人の日（1 月の第 2 月曜）
    ['2026-05-04', 0, true], // みどりの日
    ['2026-05-06', 0, true], // 振替休日（5/3 が日曜）
    ['2026-05-07', 0, false], // 木
    ['2026-09-21', 0, true], // 敬老の日
    ['2026-09-22', 0, true], // 国民の休日（敬老の日と秋分の日にはさまれる）
    ['2026-09-23', 0, true], // 秋分の日
    ['2026-09-24', 0, false], // 木
    ['2026-03-20', 0, true], // 春分の日
    ['2026-11-23', 0, true], // 勤労感謝の日
  ];
  for (const [date, off, busy] of cases) it(`${date} +${off} 日は ${busy ? '土日祝' : '平日'}`, () => expect(isBusyDay(date, off)).toBe(busy));
});

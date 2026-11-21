import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimeRef } from '../src/sim/core/clock';
import type { MapDef } from '../src/sim/types';
import { applyNewProjectTemplates } from '../src/editor/templates/apply';
import { danglingClimberRefs, generateParty } from '../src/editor/templates/party';
import { HAKONIWA_STAGES, routeCourseMin } from '../src/editor/templates/stages';
import { WEATHER_TEMPLATES, weatherFromTemplate } from '../src/editor/templates/weather';
import { createFictionalProject } from '../src/editor/store/project';

const map = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/maps/sounan.json'), 'utf8')) as MapDef;

/** 決まった列の乱数（テスト用） */
function seq(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const base = { season: 'autumn' as const, refElevM: 1000, lapseRateCPer100m: 0.65, sunriseMin: 352, s: 1, mapSizeM: 4096 };

function precipAt(kfs: { at: string; precipMmH: number }[], h: number): number {
  return kfs.find((k) => parseTimeRef(k.at) === h * 60)?.precipMmH ?? NaN;
}

describe('天候のテンプレート', () => {
  it('どのテンプレートも D0 00:00〜D3 00:00 の時刻順のキーフレームを作る', () => {
    for (const t of WEATHER_TEMPLATES) {
      const { keyframes } = weatherFromTemplate(t.id, base);
      const ts = keyframes.map((k) => parseTimeRef(k.at));
      expect(ts[0]).toBe(0);
      expect(ts[ts.length - 1]).toBe(72 * 60);
      expect([...ts].sort((a, b) => a - b)).toEqual(ts);
      for (const k of keyframes) {
        expect(k.cloudCover).toBeGreaterThanOrEqual(0);
        expect(k.cloudCover).toBeLessThanOrEqual(1);
        expect(k.windMs).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(k.tempC)).toBe(true);
      }
    }
  });

  it('ずっと好天は雨が降らず、昼は夜より暖かい', () => {
    const { keyframes } = weatherFromTemplate('fair3', base);
    expect(keyframes.every((k) => k.precipMmH === 0)).toBe(true);
    const at = (h: number): number => keyframes.find((k) => parseTimeRef(k.at) === h * 60)!.tempC;
    expect(at(14)).toBeGreaterThan(at(6) + 5);
  });

  it('崩れる時期がテンプレートどおり', () => {
    const a = weatherFromTemplate('breakAfternoon', base).keyframes;
    expect(precipAt(a, 8)).toBe(0);
    expect(precipAt(a, 18)).toBeGreaterThan(5);
    const n = weatherFromTemplate('breakNextDay', base).keyframes;
    expect(precipAt(n, 12)).toBe(0);
    expect(precipAt(n, 36)).toBeGreaterThan(5);
    const r = weatherFromTemplate('badThenRecover', base).keyframes;
    expect(precipAt(r, 4)).toBeGreaterThan(5);
    expect(precipAt(r, 24)).toBe(0);
  });

  it('夏の雷雨は毎日 1 つの雷雲セル、冬は氷点下', () => {
    expect(weatherFromTemplate('afternoonThunder', { ...base, season: 'summer' }).cells).toHaveLength(3);
    const w = weatherFromTemplate('fair3', { ...base, season: 'winter' }).keyframes;
    expect(Math.max(...w.map((k) => k.tempC))).toBeLessThan(2);
  });
});

describe('登山者のテンプレート', () => {
  it('人数・性別・年代の条件を満たし、名前は重ならない', () => {
    const p = generateParty({ count: 4, sex: 'f', age: '50s60s', level: 'veteran', season: 'autumn' }, { mid_f: 5, senior_f: 5 }, seq(3));
    expect(p).toHaveLength(4);
    expect(p.every((c) => c.sex === 'f' && c.age >= 50 && c.age <= 69)).toBe(true);
    expect(new Set(p.map((c) => c.name)).size).toBe(4);
    expect(new Set(p.map((c) => c.portrait)).size).toBe(4);
    expect(p.filter((c) => c.leader)).toHaveLength(1);
    expect(p.every((c) => c.portrait?.startsWith(c.age < 65 ? 'mid_f:' : 'senior_f:'))).toBe(true);
  });

  it('混在なら男女どちらも、年代もばらける', () => {
    const p = generateParty({ count: 4, sex: 'mix', age: 'mix', level: 'mix', season: 'summer' }, null, seq(7));
    expect(new Set(p.map((c) => c.sex)).size).toBe(2);
    const bands = new Set(p.map((c) => (c.age < 30 ? 2 : c.age < 50 ? 3 : c.age < 70 ? 5 : 7)));
    expect(bands.size).toBe(4);
    expect(p.every((c) => c.portrait === undefined)).toBe(true);
  });

  it('親子は大人がリーダーで子供を含む', () => {
    const p = generateParty({ count: 4, sex: 'mix', age: 'family', level: 'standard', season: 'autumn' }, null, seq(11));
    expect(p.filter((c) => c.age < 16)).toHaveLength(2);
    expect(p.find((c) => c.leader)!.age).toBeGreaterThanOrEqual(18);
  });

  it('いなくなる登山者の参照を見つける', () => {
    const pr = createFictionalProject('t', map);
    pr.scenario.party = generateParty({ count: 3, sex: 'mix', age: 'mix', level: 'mix', season: 'autumn' }, null, seq(2));
    (pr.scenario as unknown as { events: unknown[] }).events = [{ id: 'e', who: 'c3' }];
    expect(danglingClimberRefs(pr.scenario, ['c1', 'c2'])).toEqual(['c3']);
  });
});

describe('箱庭岳のステージ', () => {
  it('どのコースも道がつながっている', () => {
    for (const st of HAKONIWA_STAGES) {
      expect(routeCourseMin(map, st.route), st.id).not.toBeNull();
      for (const g of st.goalNodes) expect(map.nodes.some((n) => n.id === g)).toBe(true);
    }
  });

  it('新規作成にテンプレートを当てる', () => {
    const pr = createFictionalProject('テスト', map);
    applyNewProjectTemplates(pr, { season: 'summer', stage: 'loopWest', weather: 'afternoonThunder', party: { count: 3, sex: 'mix', age: 'mix', level: 'mix', season: 'summer' } }, null, seq(5));
    const s = pr.scenario;
    expect(s.season).toBe('summer');
    expect(s.plan.route).toEqual(HAKONIWA_STAGES.find((x) => x.id === 'loopWest')!.route);
    expect(parseTimeRef(s.plan.plannedFinish)).toBeGreaterThan(parseTimeRef(s.startAt));
    expect(s.party).toHaveLength(3);
    expect(s.weather.thunderCells).toHaveLength(3);
    expect(s.briefing.forecast.length).toBeGreaterThan(0);
  });
});

// テスト用: 最小のシナリオと標準登山者（docs/07 §1.3: experience 0.5, fitness 1.0, 荷物 8 kg）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClimberDef, NodeId, ScenarioDef } from '../../src/sim/types';

export function standardClimber(over: Partial<ClimberDef> = {}): ClimberDef {
  return {
    id: 'std',
    name: '標準',
    age: 40,
    sex: 'm',
    weightKg: 65,
    packKg: 8,
    experience: 0.5,
    fitness: 1.0,
    navSkill: 0.5,
    riskTolerance: 0.5,
    color: '#888888',
    leader: true,
    habits: { eatEveryMin: null, drinkEveryMin: null, delaysRainwear: 0, gpsCheckEveryMin: null },
    gear: {
      rainwear: 'goretex',
      cloWorn: 1.0,
      cloPack: 0.5,
      gloves: 'thin',
      hat: true,
      bivy: 'none',
      headlamp: { has: true, batteryH: 6, inPack: false, spareBatteryH: 0 },
      phone: { has: true, batteryPct: 100, gpsApp: true, trackRecording: false, satelliteSos: false },
      map: true,
      compass: true,
      foodKcal: 1000,
      waterL: 1.5,
      stove: false,
      crampons: false,
      helmet: false,
      trekkingPoles: false,
      whistle: false,
    },
    ...over,
  };
}

/** 晴天・昼の最小シナリオ */
export function testScenario(route: NodeId[], over: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'test',
    version: 1,
    title: 'テスト',
    theme: 'mixed',
    difficulty: 1,
    season: 'autumn',
    estMinutes: 1,
    mapId: 'sounan',
    seed: 1,
    startDate: '2026-10-17',
    startAt: 'D0 06:00',
    timeLimit: 'D1 12:00',
    sun: { sunrise: '05:00', sunset: '19:00', maxElevDeg: 45 },
    briefing: { text: '', forecast: [] },
    plan: { route, goalNodes: [route[route.length - 1]!], plannedFinish: 'D0 18:00', submittedPlan: true, reportIfNotBackBy: null },
    party: [standardClimber()],
    // 晴れ・無風（コースタイムの検証条件）
    weather: {
      refElevM: 1000,
      lapseRateCPer100m: 0.65,
      keyframes: [{ at: 'D0 00:00', tempC: 15, windMs: 0, windDirDeg: 0, precipMmH: 0, cloudCover: 0, cloudBaseM: 5000, visibilityM: 30000 }],
    },
    events: [],
    choices: [],
    endings: [],
    lessons: [],
    ...over,
  };
}

export function loadScenario(id: string): ScenarioDef {
  const path = resolve(import.meta.dirname, '..', '..', 'public', 'scenarios', `${id}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as ScenarioDef;
}

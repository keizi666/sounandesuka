import { describe, expect, it } from 'vitest';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { evalCondition } from '../src/sim/scenario/conditions';
import { expandText } from '../src/sim/scenario/text';
import { isKnownVarPath, resolveVar, type VarScope } from '../src/sim/scenario/vars';
import { TEXT_LABELS } from '../src/i18n/format';
import type { Condition } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(): VarScope {
  const { map } = hakoniwa();
  const sc = loadScenario('s02_fog_descent');
  const world = createWorld(map, sc);
  createStaticContext(map, sc);
  return { world, map, scenario: sc, leader: world.climbers[0]! };
}

const ev = (c: Condition, s: VarScope, key = 'k'): boolean => evalCondition(c, s, key);

describe('条件 DSL（docs/09 §4）', () => {
  it('論理と比較', () => {
    const s = setup();
    s.leader.body.coreC = 35;
    expect(ev({ var: 'leader.coreC', op: '<', value: 35.3 }, s)).toBe(true);
    expect(ev({ var: 'leader.coreC', op: '>=', value: 35.3 }, s)).toBe(false);
    expect(ev({ var: 'leader.state', op: '==', value: 'WALKING' }, s)).toBe(true);
    expect(ev({ var: 'leader.state', op: '!=', value: 'WALKING' }, s)).toBe(false);
    expect(ev({ all: [{ var: 'leader.coreC', op: '<', value: 36 }, { not: { var: 'leader.coreC', op: '<', value: 34 } }] }, s)).toBe(true);
    expect(ev({ any: [{ var: 'leader.coreC', op: '>', value: 36 }, { var: 'leader.coreC', op: '==', value: 35 }] }, s)).toBe(true);
    // 文字列と数値の大小比較は偽
    expect(ev({ var: 'leader.state', op: '<', value: 3 }, s)).toBe(false);
  });

  it('時刻・ノード・状態・フラグ・選択・イベント', () => {
    const s = setup();
    const w = s.world;
    expect(ev({ after: 'D0 08:00' }, s)).toBe(true);
    expect(ev({ before: 'D0 08:00' }, s)).toBe(false);
    expect(ev({ beenAt: 'TH_SAWA' }, s)).toBe(true);
    expect(ev({ beenAt: 'SUMMIT' }, s)).toBe(false);
    expect(ev({ state: 'WALKING' }, s)).toBe(true);
    expect(ev({ flag: 'x' }, s)).toBe(false);
    w.flags['x'] = w.tMin - 40;
    expect(ev({ flag: 'x' }, s)).toBe(true);
    expect(ev({ elapsedSince: { flag: 'x', min: 30 } }, s)).toBe(true);
    expect(ev({ elapsedSince: { flag: 'x', min: 60 } }, s)).toBe(false);
    w.decisions.push({ cpId: 'cp_summit', optionId: 'loop', tMin: w.tMin, by: 'user' });
    expect(ev({ chose: { cp: 'cp_summit', option: 'loop' } }, s)).toBe(true);
    expect(ev({ chose: { cp: 'cp_summit', option: 'hut' } }, s)).toBe(false);
    w.recentEvents = [{ type: 'NODE_ARRIVE', climberId: s.leader.id, node: 'J_FOREST' }, { type: 'RAIN_START', climberId: null, node: null }];
    expect(ev({ atNode: 'J_FOREST' }, s)).toBe(true);
    expect(ev({ atNode: 'EBOSHI' }, s)).toBe(false);
    expect(ev({ event: 'RAIN_START' }, s)).toBe(true);
    expect(ev({ near: { x: s.leader.x + 50, z: s.leader.z, r: 80 } }, s)).toBe(true);
    expect(ev({ near: { x: s.leader.x + 100, z: s.leader.z, r: 80 } }, s)).toBe(false);
  });

  it('chance は初回に 1 回だけ抽選し、結果を固定する', () => {
    const s = setup();
    const first = ev({ chance: 0.5 }, s, 'events[0].trigger');
    for (let i = 0; i < 20; i += 1) expect(ev({ chance: 0.5 }, s, 'events[0].trigger')).toBe(first);
    expect(s.world.chanceResults['events[0].trigger']).toBe(first);
    let trues = 0;
    for (let i = 0; i < 2000; i += 1) if (ev({ chance: 0.3 }, s, `k${i}`)) trues += 1;
    expect(trues / 2000).toBeGreaterThan(0.25);
    expect(trues / 2000).toBeLessThan(0.35);
  });
});

describe('変数パス（docs/09 §4.1）', () => {
  it('登山者・局地気象・定義・集計・別の登山者', () => {
    const s = setup();
    expect(resolveVar('leader.name', s)).toBe('佐藤');
    expect(resolveVar('leader.def.riskTolerance', s)).toBe(0.6);
    expect(typeof resolveVar('leader.local.tempC', s)).toBe('number');
    expect(resolveVar('c.tanaka.fatigue', s)).toBe(0);
    expect(resolveVar('party.count', s)).toBe(2);
    expect(resolveVar('party.min.coreC', s)).toBe(37);
    expect(resolveVar('sun.isDark', s)).toBe(false);
    expect(resolveVar('leader.nonexistent', s)).toBeUndefined();
    expect(resolveVar('c.nobody.coreC', s)).toBeUndefined();
  });

  it('validate 用の既知パス判定', () => {
    const { scenario } = setup();
    expect(isKnownVarPath('leader.local.windChillC', scenario)).toBe(true);
    expect(isKnownVarPath('c.tanaka.anxiety', scenario)).toBe(true);
    expect(isKnownVarPath('c.nobody.anxiety', scenario)).toBe(false);
    expect(isKnownVarPath('rec.minCoreC', scenario)).toBe(true);
    expect(isKnownVarPath('rec.whatever', scenario)).toBe(false);
    expect(isKnownVarPath('group.main.min.coreC', scenario)).toBe(true);
    expect(isKnownVarPath('group.main.count', scenario)).toBe(true);
    expect(isKnownVarPath('leader.temperature', scenario)).toBe(false);
  });
});

describe('プレースホルダ（docs/09 §5）', () => {
  it('小数桁・列挙値の日本語・未知のパスはそのまま', () => {
    const s = setup();
    s.leader.local.precipType = 'sleet';
    s.leader.local.windChillC = -3.46;
    const r = (p: string) => resolveVar(p, s);
    expect(expandText('{leader.name}さん、体感 {leader.local.windChillC:0}℃、{leader.local.precipType}', r, TEXT_LABELS)).toBe('佐藤さん、体感 -3℃、みぞれ');
    expect(expandText('{leader.local.windChillC:1}', r)).toBe('-3.5');
    expect(expandText('{leader.state}', r, TEXT_LABELS)).toBe('歩行中');
    expect(expandText('{leader.zzz}', r)).toBe('{leader.zzz}');
  });
});

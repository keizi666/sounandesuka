/**
 * 歩けない仲間を運ぶ・救助を呼びに行く（ユーザーの指定。src/sim/climber/carry.ts）
 * - 支えて進む: けが人を置いていかず、全員で進む。介助の 2 人が背負い、3 人分の荷物はほかの人が分けて持つ
 * - 呼びに行く: 1 人が付き添って残り、ほかは呼びに行く。3 人なら 1 人が呼びに行き、2 人ならけが人は 1 人で残る
 */
import { describe, expect, it } from 'vitest';
import { applyActions } from '../src/sim/climber/actions';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import type { ScenarioDef } from '../src/sim/types';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(n: number) {
  const { map } = sounanMap();
  const s: ScenarioDef = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  const base = s.party[0]!;
  s.party = Array.from({ length: n }, (_, i) => ({ ...structuredClone(base), id: `p${i}`, name: `P${i}`, experience: 0.5 + i * 0.01 }));
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s, { mode: 'interactive' });
  for (let i = 0; i < 60; i += 1) stepWorld(w, ctx); // 10 分歩く
  const hurt = w.climbers[1]!;
  hurt.body.injury = 'legFracture';
  const leader = w.climbers[0]!;
  const act = (type: 'carryInjured' | 'sendForHelp'): void => applyActions(w, ctx, [{ type }], w.climbers, leader);
  return { w, ctx, hurt, leader, act };
}

describe('歩けない仲間を運ぶ', () => {
  it('8 人の列: けが人を置いていかず、全員で進む。介助の人が背負い、荷物はほかの人が持つ', () => {
    const { w, ctx, hurt, leader, act } = setup(8);
    act('carryInjured');
    const carriers = w.climbers.filter((c) => (c.plan.carryKg ?? 0) > 10);
    expect(carriers).toHaveLength(2);
    // けが人と介助の 2 人の荷物を、残りの 5 人で分けて持つ
    const others = w.climbers.filter((c) => c !== hurt && !carriers.includes(c));
    expect(others).toHaveLength(5);
    for (const c of others) expect(c.plan.carryKg).toBeCloseTo((hurt.def.packKg + carriers[0]!.def.packKg + carriers[1]!.def.packKg) / 5, 5);
    const x0 = leader.x;
    const z0 = leader.z;
    for (let i = 0; i < 360; i += 1) stepWorld(w, ctx); // 1 時間
    // 全員が同じグループのまま（置いていかない）で、けが人も列と同じ場所にいる
    expect(new Set(w.climbers.map((c) => c.groupId)).size).toBe(1);
    expect(Math.hypot(hurt.x - leader.x, hurt.z - leader.z)).toBeLessThan(1);
    // 遅いが、進む
    expect(Math.hypot(leader.x - x0, leader.z - z0)).toBeGreaterThan(50);
  });
});

describe('救助を呼びに行く', () => {
  it('4 人: 1 人が付き添って残り、2 人が呼びに行く', () => {
    const { w, hurt, act } = setup(4);
    act('sendForHelp');
    const stay = w.climbers.filter((c) => c.groupId === hurt.groupId);
    expect(stay).toHaveLength(2);
    expect(w.climbers.filter((c) => c.groupId !== hurt.groupId)).toHaveLength(2);
  });

  it('3 人: 1 人が付き添って残り、1 人が呼びに行く', () => {
    const { w, hurt, act } = setup(3);
    act('sendForHelp');
    expect(w.climbers.filter((c) => c.groupId === hurt.groupId)).toHaveLength(2);
    expect(w.climbers.filter((c) => c.groupId !== hurt.groupId)).toHaveLength(1);
  });

  it('2 人: 1 人が呼びに行き、けが人は 1 人で残る', () => {
    const { w, hurt, act } = setup(2);
    act('sendForHelp');
    expect(w.climbers.filter((c) => c.groupId === hurt.groupId)).toHaveLength(1);
    expect(w.climbers.filter((c) => c.groupId !== hurt.groupId)).toHaveLength(1);
  });

  it('呼びに行った人が電波の入る所か小屋・登山口に着いたら、けが人を残した場所を知らせる', () => {
    const { w, ctx, hurt, act } = setup(4);
    act('sendForHelp');
    for (let i = 0; i < 360 * 12 && w.rescue.status === 'none' && !w.ended; i += 1) stepWorld(w, ctx);
    expect(w.rescue.status).not.toBe('none');
    const est = w.rescue.locationEstimate;
    expect(est).not.toBeNull();
    expect(Math.hypot(est!.x - hurt.x, est!.z - hurt.z)).toBeLessThan(500);
  });
});

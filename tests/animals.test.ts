/**
 * 野生動物（src/sim/hazards/animals.ts）: 出る・見つける・不安・立ち去る・消える、決定論、検証、変数
 */
import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { animalPos } from '../src/sim/hazards/animals';
import { validateScenario } from '../src/sim/scenario/validate';
import { resolveVar } from '../src/sim/scenario/vars';
import { TUNING } from '../src/sim/tuning';
import type { AnimalEffect, ScenarioDef, SimEvent } from '../src/sim/types';
import { loadSounanDef, sounanMap } from './helpers/map';
import { testScenario } from './helpers/scenario';

function scenarioWith(effects: AnimalEffect[], extra: Partial<ScenarioDef> = {}): ScenarioDef {
  return testScenario(['TH_SAWA', 'J_FOREST'], { events: [{ id: 'ev_a', trigger: { after: 'D0 06:01' }, once: true, effects }], ...extra });
}

function run(sc: ScenarioDef, minutes: number): { events: SimEvent[]; world: ReturnType<typeof createWorld>; anxietyAt: (t: number) => number } {
  const { map } = sounanMap();
  const world = createWorld(map, sc);
  const ctx = createStaticContext(map, sc);
  const events: SimEvent[] = [];
  const anx: [number, number][] = [];
  for (let i = 0; i < minutes * 6; i += 1) {
    stepWorld(world, ctx);
    events.push(...ctx.events.splice(0));
    anx.push([world.tMin, world.climbers[0]!.body.anxiety]);
  }
  return { events, world, anxietyAt: (t) => anx.find(([m]) => m >= t)?.[1] ?? NaN };
}

describe('野生動物', () => {
  it('前方に出た熊を見つけ、不安が増え、近づくと立ち去って消える', () => {
    const sc = scenarioWith([{ type: 'animal', species: 'bear', aheadM: 60, durationMin: 30 }]);
    const { events, world, anxietyAt } = run(sc, 40);
    const seen = events.find((e) => e.type === 'ANIMAL');
    expect(seen?.data?.['species']).toBe('bear');
    expect(anxietyAt(seen!.tMin) - anxietyAt(seen!.tMin - 0.5)).toBeGreaterThanOrEqual(TUNING.animals.species['bear']!.anxiety - 1);
    // 人が近づいて（30 分より前に）立ち去り、ログに 1 行。そのあと World から消える
    const left = events.find((e) => e.type === 'SCRIPT_LOG' && e.data?.['animalLeft'] === 'bear');
    expect(left).toBeDefined();
    expect(left!.tMin).toBeLessThan(6 * 60 + 1 + 30);
    expect(world.animals).toEqual([]);
  });

  it('時刻だけで位置が決まり、World は JSON で往復できる', () => {
    const sc = scenarioWith([{ type: 'animal', species: 'deer', count: 3, behavior: 'cross', aheadM: 200, sideM: 20 }]);
    const { map } = sounanMap();
    const world = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    for (let i = 0; i < 12; i += 1) stepWorld(world, ctx);
    const a = world.animals![0]!;
    expect(a.count).toBe(3);
    const p1 = animalPos(a, a.fromMin + 0.2, TUNING.animals);
    const p2 = animalPos(a, a.fromMin + 0.4, TUNING.animals);
    expect(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])).toBeGreaterThan(1);
    expect(JSON.parse(JSON.stringify(world))).toEqual(structuredClone(world));
    // 同じシードなら同じ結果
    const r1 = run(sc, 20);
    const r2 = run(sc, 20);
    expect(JSON.stringify(r1.world)).toBe(JSON.stringify(r2.world));
  });

  it('animal.<種類> はリーダーからの距離、animalLeave で立ち去る、quiet と anxiety: 0', () => {
    const sc = scenarioWith([{ type: 'animal', id: 'b', species: 'serow', aheadM: 50, anxiety: 0, quiet: true, durationMin: 60 }]);
    const { map } = sounanMap();
    const world = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    for (let i = 0; i < 5; i += 1) stepWorld(world, ctx);
    const before = world.climbers[0]!.body.anxiety;
    for (let i = 0; i < 2; i += 1) stepWorld(world, ctx);
    const scope = { world, map, scenario: sc, leader: world.climbers[0]! };
    const d = resolveVar('animal.serow', scope) as number;
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(70);
    expect(resolveVar('animal.bear', scope)).toBe(99999);
    expect(world.climbers[0]!.body.anxiety).toBeLessThanOrEqual(before);
    expect(ctx.events.some((e) => e.type === 'ANIMAL' && e.data?.['quiet'] === true)).toBe(true);
    ctx.scenario.events.push({ id: 'ev_go', trigger: { after: 'D0 06:02' }, once: true, effects: [{ type: 'animalLeave', id: 'b' }] });
    for (let i = 0; i < 6; i += 1) stepWorld(world, ctx);
    expect(world.animals![0]!.leaveMin).not.toBeNull();
    expect(resolveVar('animal.serow', scope)).toBe(99999);
  });

  it('検証: 未知の動物・未定義の地点・x だけ はエラー', () => {
    const map = loadSounanDef();
    const bad = scenarioWith([
      { type: 'animal', species: 'tiger' as never },
      { type: 'animal', species: 'deer', at: 'NOWHERE' },
      { type: 'animal', species: 'deer', x: 10 },
    ]);
    const codes = validateScenario(bad, map).filter((i) => i.level === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unknownAnimal', 'undefinedNode', 'animalXZ']));
    const ok = scenarioWith([{ type: 'animal', species: 'monkey', at: 'J_FOREST', count: 4 }], { choices: [] });
    expect(validateScenario(ok, map).filter((i) => i.level === 'error' && i.path.startsWith('events'))).toEqual([]);
  });
});

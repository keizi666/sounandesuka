import { describe, expect, it } from 'vitest';
import { capSpeedByMet, CLEAR_DAY, paceOf, toblerKmh, trailSpeedMs, walkMet } from '../src/sim/climber/movement';
import { transition } from '../src/sim/climber/state';
import { DT_SEC, stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { TUNING } from '../src/sim/tuning';
import type { MapRuntime, ScenarioDef, World } from '../src/sim/types';

// コースタイムは休憩を含まない歩行時間なので、決まった間隔で休む習慣を切って測る
const NO_HABIT = { ...TUNING, behavior: { ...TUNING.behavior, habitRestEveryMin: Infinity } };
import { sounanMap } from './helpers/map';
import { loadScenario, standardClimber, testScenario } from './helpers/scenario';

/** 1 人が FINISHED になるまで回し、かかった分を返す。restPattern があれば 50 分歩いて 10 分休み、休憩ごとに 250 kcal 食べて 0.5 L 飲む */
function walkMinutes(map: MapRuntime, sc: ScenarioDef, restPattern = false): { minutes: number; world: World } {
  const w = createWorld(map, sc);
  const ctx = createStaticContext(map, sc, { tuning: NO_HABIT });
  const t0 = w.tMin;
  let walked = 0;
  for (let i = 0; i < 20_000 && w.climbers[0]!.state !== 'FINISHED'; i += 1) {
    const c = w.climbers[0]!;
    if (restPattern && c.state === 'WALKING' && walked >= 50) {
      walked = 0;
      c.plan.restUntilMin = w.tMin + 10;
      transition(w, ctx, c, 'RESTING', 'test');
      c.body.gutKcal += 250;
      c.body.waterDeficitL = Math.max(0, c.body.waterDeficitL - 0.5);
    }
    const wasWalking = c.state === 'WALKING';
    stepWorld(w, ctx);
    if (wasWalking) walked += DT_SEC / 60;
    ctx.events.length = 0;
  }
  return { minutes: w.tMin - t0, world: w };
}

describe('コースタイムの検証（docs/07 §1.3）', () => {
  const { map } = sounanMap();
  for (const e of map.def.edges) {
    if (e.kind !== 'trail' || !e.to || !e.courseTimeMin) continue;
    const ct = e.courseTimeMin;
    it(`${e.id} ${e.name}: 標準登山者の所要が両方向とも ±25%`, () => {
      const fwd = walkMinutes(map, testScenario([e.from, e.to!])).minutes;
      const rev = walkMinutes(map, testScenario([e.to!, e.from])).minutes;
      expect(Math.abs(fwd / ct[0] - 1), `${e.from}→${e.to} ${fwd.toFixed(0)}/${ct[0]}分`).toBeLessThanOrEqual(0.25);
      expect(Math.abs(rev / ct[1] - 1), `${e.to}→${e.from} ${rev.toFixed(0)}/${ct[1]}分`).toBeLessThanOrEqual(0.25);
    });
  }
});

describe('s01 の計画ルート（docs/13 P2）', () => {
  it('標準登山者が 50 分歩いて 10 分休む固定パターンで 7.5〜10 時間', () => {
    const { map } = sounanMap();
    const s01 = loadScenario('s01_cold_front');
    const sc = testScenario(s01.plan.route, { plan: { ...s01.plan, goalNodes: ['TH_KITA'] } });
    const { minutes, world } = walkMinutes(map, sc, true);
    expect(minutes / 60).toBeGreaterThanOrEqual(7.5);
    expect(minutes / 60).toBeLessThanOrEqual(10);
    const c = world.climbers[0]!;
    expect(c.state).toBe('FINISHED');
    expect(c.pos).toEqual({ mode: 'node', nodeId: 'TH_KITA' });
    for (const id of s01.plan.route) expect(world.visitedNodes[id], id).toBeDefined();
  });
});

describe('速度と代謝', () => {
  it('Tobler: 緩い下り（−5%）で最大 6 km/h、急になるほど遅い', () => {
    expect(toblerKmh(-0.05)).toBeCloseTo(6, 9);
    expect(toblerKmh(0.2)).toBeLessThan(toblerKmh(0));
    expect(toblerKmh(-0.4)).toBeLessThan(toblerKmh(-0.1));
  });

  it('ペース係数は標準で約 0.8', () => {
    expect(paceOf(standardClimber())).toBeCloseTo(0.825, 9);
  });

  it('暗さ・霧・風・疲労で遅くなる', () => {
    const { map } = sounanMap();
    const sc = testScenario(['TH_SAWA', 'J_FOREST']);
    const c = createWorld(map, sc).climbers[0]!;
    const e = map.trails['E1']!.def;
    const base = trailSpeedMs(c, e, false, 0.1, CLEAR_DAY);
    expect(trailSpeedMs(c, e, false, 0.1, { ...CLEAR_DAY, isDark: true })).toBeLessThan(base);
    expect(trailSpeedMs(c, e, false, 0.1, { ...CLEAR_DAY, visibilityM: 20 })).toBeLessThan(base);
    expect(trailSpeedMs(c, e, false, 0.1, { ...CLEAR_DAY, windMs: 15 })).toBeLessThan(base);
    expect(trailSpeedMs(c, e, true, 0.1, CLEAR_DAY)).toBeLessThan(base);
    c.body.fatigue = 80;
    expect(trailSpeedMs(c, e, false, 0.1, CLEAR_DAY)).toBeLessThan(base);
  });

  it('MET は登りと荷物で増え、持続上限を超える速度は下げられる', () => {
    const def = standardClimber();
    expect(walkMet(1, 0.2, def, 0)).toBeGreaterThan(walkMet(1, 0, def, 0));
    expect(walkMet(1, 0, { ...def, packKg: 20 }, 0)).toBeGreaterThan(walkMet(1, 0, def, 0));
    expect(walkMet(1, -0.3, def, 0)).toBeGreaterThan(walkMet(1, -0.1, def, 0));
    const { map } = sounanMap();
    const c = createWorld(map, testScenario(['TH_SAWA', 'J_FOREST'])).climbers[0]!;
    c.body.glycogenKcal = 100; // シャリバテ
    const r = capSpeedByMet(2.0, 0.3, c, 0);
    expect(r.vMs).toBeLessThan(2.0);
    expect(r.met).toBeLessThanOrEqual(0.75 * (8 + 6 * c.def.fitness) * 0.55 + 1e-9);
  });
});

describe('World（docs/03 §3）', () => {
  it('プレーンな JSON で往復でき、往復後の続きが同じ', () => {
    const { map } = sounanMap();
    const sc = loadScenario('s03_thunder_ridge');
    const a = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    for (let i = 0; i < 100; i += 1) stepWorld(a, ctx);
    const b = JSON.parse(JSON.stringify(a)) as World;
    expect(structuredClone(a)).toEqual(a);
    for (let i = 0; i < 300; i += 1) {
      stepWorld(a, ctx);
      stepWorld(b, ctx);
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('3 シナリオで World を作れ、全員が計画ルートの最初のノードにいる', () => {
    const { map } = sounanMap();
    for (const id of ['s01_cold_front', 's02_fog_descent', 's03_thunder_ridge']) {
      const sc = loadScenario(id);
      const w = createWorld(map, sc);
      expect(w.climbers).toHaveLength(sc.party.length);
      for (const c of w.climbers) expect(c.pos).toEqual({ mode: 'node', nodeId: sc.plan.route[0] });
      // s01（05:30 出発・日の出 05:52）と s03（04:30・04:55）は日の出前、s02（08:00）は明るい
      if (id === 's02_fog_descent') expect(w.sun.isDark || w.sun.twilight).toBe(false);
      else expect(w.sun.elevDeg).toBeLessThan(0);
    }
  });

  it('ノード到着と状態遷移のイベントが出る', () => {
    const { map } = sounanMap();
    const sc = testScenario(['TH_SAWA', 'J_FOREST']);
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const types: string[] = [];
    for (let i = 0; i < 1000 && w.climbers[0]!.state !== 'FINISHED'; i += 1) {
      stepWorld(w, ctx);
      types.push(...ctx.events.map((e) => e.type).filter((t) => t !== 'THOUGHT'));
      ctx.events.length = 0;
    }
    expect(types).toEqual(['NODE_ARRIVE', 'STATE', 'FINISHED', 'ENDED']);
  });
});

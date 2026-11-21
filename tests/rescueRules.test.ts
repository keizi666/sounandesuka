/**
 * 救助隊の行動の決まり（ユーザーの指定）: 夜はヘリも地上隊も山に入らない。悪天候でも出ない。ヘリは雲があれば飛ばない。
 */
import { describe, expect, it } from 'vitest';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { groundNoGo, heliNoGo, heliReadyAt, stepRescue } from '../src/sim/rescue/rescue';
import { checkEnding } from '../src/sim/scenario/endings';
import { stepWorld } from '../src/sim/core/step';
import { sounanMap } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function setup(clock: string) {
  const { map } = sounanMap();
  const s = structuredClone(loadScenario('s01_cold_front'));
  s.choices = [];
  s.events = [];
  // 晴れて雲の高い日にする（天気の影響を除いて、昼と夜だけを比べる）
  s.weather.keyframes = s.weather.keyframes.map((k) => ({ ...k, precipMmH: 0, cloudCover: 0.1, cloudBaseM: 6000, visibilityM: 40000, windMs: 3, thunder: 0 }));
  s.weather.thunderCells = [];
  s.startAt = `D0 ${clock}`;
  const w = createWorld(map, s);
  const ctx = createStaticContext(map, s);
  return { w, ctx, c: w.climbers[0]! };
}

describe('救助隊の行動の決まり', () => {
  it('昼の晴れた日は、ヘリも地上隊も動ける', () => {
    const { w, ctx, c } = setup('11:00');
    stepWorld(w, ctx);
    expect(heliNoGo(w, ctx, c.x, c.z)).toBeNull();
    expect(groundNoGo(w, ctx, c.x, c.z)).toBeNull();
  });

  it('夜はヘリも地上隊も動かない', () => {
    const { w, ctx, c } = setup('22:00');
    stepWorld(w, ctx);
    expect(heliNoGo(w, ctx, c.x, c.z)).toBe('night');
    expect(groundNoGo(w, ctx, c.x, c.z)).toBe('night');
  });

  it('雲が低く山にかかっていれば、ヘリは飛ばない', () => {
    const { w, ctx, c } = setup('11:00');
    stepWorld(w, ctx);
    w.weather.cloudBaseM = c.elevM + 100;
    expect(heliNoGo(w, ctx, c.x, c.z)).toBe('cloud');
  });

  it('夜に通報があっても、夜明けまではヘリは飛ばず、地上隊も山に入らない', () => {
    const { w, ctx, c } = setup('21:00');
    for (const x of w.climbers) x.state = 'WAITING_RESCUE';
    stepWorld(w, ctx);
    w.rescue = { ...w.rescue, status: 'dispatched', calledAtMin: w.tMin, via: 'phone', locationEstimate: { x: c.x, z: c.z, radiusM: 50 } };
    const sunrise = Number(ctx.scenario.sun.sunrise.slice(0, 2)) * 60 + Number(ctx.scenario.sun.sunrise.slice(3));
    const dawn = Math.floor(w.tMin / 1440 + 1) * 1440 + sunrise;
    while (w.tMin < dawn - 5) {
      stepRescue(w, ctx, 10 / 60);
      w.tMin += 10 / 60;
      expect(w.climbers.some((x) => x.state === 'RESCUED')).toBe(false);
      expect(['flying', 'searching']).not.toContain(w.rescue.heli.state);
      expect(['moving', 'searching']).not.toContain(w.rescue.ground.state);
    }
  });

  it('夜はヘリの飛行準備もしない。準備は日の出から日の入りまでの間だけ進む', () => {
    const { ctx } = setup('11:00');
    const hm = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const rise = hm(ctx.scenario.sun.sunrise);
    const set = hm(ctx.scenario.sun.sunset);
    // 昼に要請: そのまま準備の分だけ
    expect(heliReadyAt(ctx, 600, 60)).toBe(660);
    // 夜に要請: 翌朝の日の出から準備を始める
    expect(heliReadyAt(ctx, 21 * 60, 60)).toBe(1440 + rise + 60);
    // 日の入りの 20 分前に要請: 20 分だけ進み、残りは翌朝
    expect(heliReadyAt(ctx, set - 20, 60)).toBe(1440 + rise + 40);
  });

  it('夜に要請を受けたヘリは、夜明けまで準備中のまま（準備ができるのは日の出の後）', () => {
    const { w, ctx, c } = setup('21:00');
    for (const x of w.climbers) x.state = 'WAITING_RESCUE';
    stepWorld(w, ctx);
    w.rescue = { ...w.rescue, status: 'dispatched', calledAtMin: w.tMin, via: 'phone', locationEstimate: { x: c.x, z: c.z, radiusM: 50 } };
    stepRescue(w, ctx, 10 / 60);
    const rise = Number(ctx.scenario.sun.sunrise.slice(0, 2)) * 60 + Number(ctx.scenario.sun.sunrise.slice(3));
    expect(w.rescue.heli.state).toBe('preparing');
    expect(w.rescue.heli.readyAtMin!).toBeGreaterThanOrEqual(1440 + rise + ctx.tuning.rescue.heliPrepMinMin);
  });

  it('plan.recoverDead のシナリオでは、亡くなった人を収容するまで続け、収容をログとフラグに残す', () => {
    const { w, ctx, c } = setup('11:00');
    ctx.scenario.plan.recoverDead = true;
    stepWorld(w, ctx);
    for (const x of w.climbers) {
      x.state = 'DEAD';
      x.body.alive = false;
      x.body.conscious = false;
    }
    // 救助隊が来る見込みがある（通報済み）あいだは終わらない
    w.rescue = { ...w.rescue, status: 'dispatched', calledAtMin: w.tMin, via: 'phone', locationEstimate: { x: c.x, z: c.z, radiusM: 50 } };
    expect(checkEnding(w, ctx)).toBe(false);
    const t0 = w.tMin;
    while (w.tMin < t0 + 24 * 60 && w.flags['bodyRecovered'] === undefined) {
      stepRescue(w, ctx, 10 / 60);
      w.tMin += 10 / 60;
    }
    expect(w.flags['bodyRecovered']).toBeDefined();
    expect(w.climbers.every((x) => x.offMap !== undefined && x.state === 'DEAD')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'SCRIPT_LOG' && e.data?.['bodyRecovered'] !== undefined)).toBe(true);
    expect(checkEnding(w, ctx)).toBe(true);
    expect(w.ended?.kind).toBe('FATAL');
  });

  it('plan.recoverDead がなければ、全員が亡くなった時点で終わる（これまでどおり）', () => {
    const { w, ctx } = setup('11:00');
    stepWorld(w, ctx);
    for (const x of w.climbers) {
      x.state = 'DEAD';
      x.body.alive = false;
    }
    expect(checkEnding(w, ctx)).toBe(true);
  });
});

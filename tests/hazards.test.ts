/**
 * P6 の受け入れ: 道迷い・落雷・電波・救助（docs/13 P6、docs/14 navigation / hazards / rescue）
 */
import { describe, expect, it } from 'vitest';
import { applyActions } from '../src/sim/climber/actions';
import { confuserErrorP } from '../src/sim/climber/navigation';
import { stepWorld } from '../src/sim/core/step';
import { deriveSeed } from '../src/sim/core/rng';
import { parseTimeRef } from '../src/sim/core/clock';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { lightningCheck } from '../src/sim/hazards/lightning';
import { slipP10 } from '../src/sim/hazards/slip';
import { runHeadless } from '../src/sim/headless';
import { heliFlyable } from '../src/sim/rescue/rescue';
import { nearestOnPolyline, newNearest, preparePolyline } from '../src/sim/terrain/geom';
import { nearestIndex } from '../src/sim/terrain/sample';
import type { PolicyName, ProceduralTerrainDef, ScenarioDef } from '../src/sim/types';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

function lostRate(id: string, policy: PolicyName, n: number): number {
  const { map } = hakoniwa();
  const s = loadScenario(id);
  let lost = 0;
  for (let i = 0; i < n; i += 1) {
    let l = false;
    runHeadless(map, s, { policy, seed: deriveSeed(s.seed, i), onTick: (_w, _c, evs) => void (l ||= evs.some((e) => e.type === 'OFFROUTE')) });
    if (l) lost += 1;
  }
  return lost / n;
}

describe('道迷い（docs/13 P6）', () => {
  it('s02 を bias で 200 回: 道迷い 40% 以上', () => {
    expect(lostRate('s02_fog_descent', 'bias', 200)).toBeGreaterThanOrEqual(0.4);
  }, 120_000);

  it('s02 を recommended で 200 回: 道迷い 15% 以下', () => {
    expect(lostRate('s02_fog_descent', 'recommended', 200)).toBeLessThanOrEqual(0.15);
  }, 120_000);

  it('分岐の誤り率は手がかりの見えにくさで増え、ナビ技術で減る', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s02_fog_descent');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const c = w.climbers[0]!;
    const leg = { edgeId: 'E8', dir: 1 as const, from: 'SADDLE_N', to: 'W_SHOULDER' };
    const p = (cue: number): number => confuserErrorP(ctx, c, 'SADDLE_N', leg, cue).pErr;
    expect(p(0)).toBeLessThan(p(0.5));
    expect(p(0.5)).toBeLessThan(p(1));
    const before = p(0.8);
    c.def = { ...c.def, navSkill: 0.9 };
    expect(p(0.8)).toBeLessThan(before);
  });

  it('道迷い中に沢下りを強制した 100 回: 60% 以上が鬼ヶ沢に入り、20% 以上が魚止ノ滝に着く', () => {
    const { map } = hakoniwa();
    const base = loadScenario('s02_fog_descent');
    const sc: ScenarioDef = { ...base, choices: [], events: [], genericOverrides: { waterfall: { enabled: false }, lostAware: { enabled: false } } };
    const oni = preparePolyline((map.def.terrain as ProceduralTerrainDef).valleys.find((v) => v.id === 'oni')!.points);
    const q = newNearest();
    let enter = 0;
    let reach = 0;
    const n = 100;
    for (let i = 0; i < n; i += 1) {
      const w = createWorld(map, sc, deriveSeed(99, i));
      const ctx = createStaticContext(map, sc);
      // 北の鞍部の廃道（F1）が消えた辺りで道迷いに気づいた
      for (const c of w.climbers) {
        c.x = -800;
        c.z = -680;
        c.pos = { mode: 'free', x: -800, z: -680 };
        c.state = 'LOST_AWARE';
      }
      applyActions(w, ctx, [{ type: 'descendDrainage' }], w.climbers, w.climbers[0]!);
      let inOni = false;
      let atWf = false;
      for (let k = 0; k < 6 * 60 * 4 && !w.ended; k += 1) {
        stepWorld(w, ctx);
        ctx.events.length = 0;
        const c = w.climbers[0]!;
        if (nearestOnPolyline(oni, c.x, c.z, q).d < 120 && q.along > 300) inOni = true;
        const dx = c.x + 1200;
        const dz = c.z + 575;
        if (dx * dx + dz * dz < 90 * 90 || c.memo.atWaterfall) atWf = true;
      }
      if (inOni) enter += 1;
      if (atWf) reach += 1;
    }
    expect(enter / n).toBeGreaterThanOrEqual(0.6);
    expect(reach / n).toBeGreaterThanOrEqual(0.2);
  }, 120_000);
});

describe('落雷（docs/08 §2）', () => {
  function strikeRate(nodeId: string, n: number): number {
    const { map } = hakoniwa();
    const sc = loadScenario('s03_thunder_ridge');
    let hit = 0;
    for (let i = 0; i < n; i += 1) {
      const w = createWorld(map, sc, deriveSeed(7, i));
      const ctx = createStaticContext(map, sc);
      const c = w.climbers[0]!;
      const nd = map.nodes[nodeId]!;
      c.x = nd.x;
      c.z = nd.z;
      let struck = false;
      for (let k = 0; k < 180 && !struck; k += 1) {
        c.local.thunder = 0.8;
        lightningCheck(w, ctx, c, 1 / 6);
        struck = ctx.events.some((e) => e.type === 'LIGHTNING_STRIKE');
      }
      if (struck) hit += 1;
    }
    return hit / n;
  }

  it('山頂で雷の強さ 0.8 の中に 30 分: 500 回の被雷率が 5〜25%', () => {
    const r = strikeRate('SUMMIT', 500);
    expect(r).toBeGreaterThanOrEqual(0.05);
    expect(r).toBeLessThanOrEqual(0.25);
  });

  it('森林内に同じ時間いた場合は 2% 以下', () => {
    expect(strikeRate('J_FOREST', 500)).toBeLessThanOrEqual(0.02);
  });
});

describe('転倒（docs/08 §1）', () => {
  it('道外の急斜面・崖は登山道より転びやすく、暗さ・下りで増える', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s01_cold_front');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const c = w.climbers[0]!;
    w.sun.isDark = false;
    const t1 = slipP10(w, ctx, c, 'T1', false);
    expect(slipP10(w, ctx, c, 'EXPOSED', false)).toBeGreaterThan(t1);
    expect(slipP10(w, ctx, c, 'CLIFF', false)).toBeGreaterThan(slipP10(w, ctx, c, 'OFF_STEEP', false));
    expect(slipP10(w, ctx, c, 'T1', true)).toBeGreaterThan(t1);
    w.sun.isDark = true;
    expect(slipP10(w, ctx, c, 'T1', false)).toBeGreaterThan(t1);
  });
});

describe('電波と救助（docs/08 §4〜5）', () => {
  it('電波のない地点で救助要請は失敗し、電波を探して移動すると成功する', () => {
    const { map } = hakoniwa();
    const sc: ScenarioDef = { ...loadScenario('s01_cold_front'), choices: [], events: [] };
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const c = w.climbers[0]!;
    // 鬼ヶ沢の滝の下（圏外）
    c.x = -1300;
    c.z = -540;
    c.pos = { mode: 'free', x: c.x, z: c.z };
    c.state = 'LOST_AWARE';
    expect(map.radio[nearestIndex(map, c.x, c.z)]!).toBeLessThan(0.15);
    applyActions(w, ctx, [{ type: 'callRescue', via: 'phone' }], [c], c);
    expect(ctx.events.some((e) => e.type === 'RESCUE_CALL_FAILED')).toBe(true);
    expect(w.rescue.status).toBe('none');
    ctx.events.length = 0;
    applyActions(w, ctx, [{ type: 'seekSignal' }], [c], c);
    let called = false;
    for (let k = 0; k < 6 * 60 * 6 && !called && !w.ended; k += 1) {
      stepWorld(w, ctx);
      called = ctx.events.some((e) => e.type === 'RESCUE_CALLED');
      ctx.events.length = 0;
    }
    expect(called).toBe(true);
    expect(map.radio[nearestIndex(map, c.x, c.z)]!).toBeGreaterThanOrEqual(0.15);
    expect(['dispatched', 'contacted']).toContain(w.rescue.status);
  });

  it('夜間はヘリが飛ばない', () => {
    const { map } = hakoniwa();
    const sc = loadScenario('s03_thunder_ridge');
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    const S = map.nodes['HUT_RIDGE']!;
    w.tMin = parseTimeRef('D0 08:00');
    expect(heliFlyable(w, ctx, S.x, S.z)).toBe(true);
    w.tMin = parseTimeRef('D0 22:00');
    expect(heliFlyable(w, ctx, S.x, S.z)).toBe(false);
    w.tMin = parseTimeRef('D1 04:50'); // 日の出直後（+30 分前）
    expect(heliFlyable(w, ctx, S.x, S.z)).toBe(false);
  });

  it('未帰還通報: 家族の通報時刻を過ぎると捜索が始まる', () => {
    const { map } = hakoniwa();
    const base = loadScenario('s01_cold_front');
    // 動けなくなって山中に残る
    const sc: ScenarioDef = { ...base, choices: [], events: [] };
    const w = createWorld(map, sc);
    const ctx = createStaticContext(map, sc);
    w.climbers[0]!.state = 'STAYING';
    while (w.tMin < parseTimeRef('D0 21:10') && !w.ended) {
      stepWorld(w, ctx);
      ctx.events.length = 0;
    }
    expect(w.rescue.via).toBe('overdue');
    expect(w.rescue.calledAtMin).toBeCloseTo(parseTimeRef('D0 21:00'), 0);
  });
});

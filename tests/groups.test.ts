/**
 * グループ・分割・浸水（docs/07 §1.4、docs/09 §3.1・§6、docs/06 §4.1）と、スケルトンマップの結合（docs/16 §8）
 */
import { describe, expect, it } from 'vitest';
import { applyActions } from '../src/sim/climber/actions';
import { groupLeader, groupMembers } from '../src/sim/climber/party';
import { applySoak } from '../src/sim/climber/physiology';
import { stepWorld } from '../src/sim/core/step';
import { createStaticContext, createWorld } from '../src/sim/core/world';
import { runHeadless } from '../src/sim/headless';
import type { ScenarioDef } from '../src/sim/types';
import { buildVertexGraph, candidatesFor, joinSkeleton, normalizeName } from '../src/editor/geo/skeleton';
import { calibClimber } from './helpers/calib';
import { hakoniwa } from './helpers/map';
import { loadScenario, standardClimber } from './helpers/scenario';

/** s03（3 人）をもとに 5 人パーティにしたシナリオ */
function party5(): ScenarioDef {
  const s = structuredClone(loadScenario('s03_thunder_ridge'));
  const base = s.party[0]!;
  s.party = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ ...structuredClone(base), id, name: id.toUpperCase(), leader: i === 0 }));
  s.groups = [{ id: 'main', members: 'all', leader: 'a', cohesion: 'tight' }];
  s.choices = [];
  s.events = [];
  s.speech = [];
  s.thoughts = [];
  return s;
}

describe('グループ', () => {
  const { map } = hakoniwa();

  it('groups の定義どおりにグループができ、全員が同じ位置で歩く（tight）', () => {
    const s = party5();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    expect(w.groups.map((g) => g.id)).toEqual(['main']);
    expect(w.climbers.every((c) => c.groupId === 'main')).toBe(true);
    for (let i = 0; i < 600; i += 1) stepWorld(w, ctx);
    const l = groupLeader(w, 'main');
    for (const c of w.climbers) expect(Math.hypot(c.x - l.x, c.z - l.z)).toBeLessThan(1);
  });

  it('splitParty: 動けない人・弱った人・残りに分かれ、名指しのリーダーは付き添う。0 人のグループは作らない', () => {
    const s = party5();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    const [a, b, c, d, e] = w.climbers as [typeof w.climbers[0], typeof w.climbers[0], typeof w.climbers[0], typeof w.climbers[0], typeof w.climbers[0]];
    d.M = 0; // 動けない
    e.body.coreC = 33.5; // 弱っている
    applyActions(w, ctx, [{ type: 'splitParty', groups: [
      { id: 'biv1', members: 'incapacitated', leader: 'b', actions: [{ type: 'bivouac', until: 'rescue', findLee: false }] },
      { id: 'biv2', members: 'weak', leader: 'c', actions: [{ type: 'bivouac', until: 'rescue', findLee: false }] },
      { id: 'descend', members: 'rest', leader: 'a', cohesion: 'loose', actions: [{ type: 'continueRoute' }] },
    ] }], w.climbers, a);
    expect(groupMembers(w, 'biv1').map((x) => x.id).sort()).toEqual(['b', 'd']);
    expect(groupMembers(w, 'biv2').map((x) => x.id).sort()).toEqual(['c', 'e']);
    expect(groupMembers(w, 'descend').map((x) => x.id)).toEqual(['a']);
    expect(b.state).toBe('BIVOUAC');
    expect(a.state).toBe('WALKING');
    expect(ctx.events.some((x) => x.type === 'PARTY_SPLIT')).toBe(true);
    // 別行動: 配列を共有していない
    expect(a.plan.route).not.toBe(b.plan.route);
    // 弱った人がいなければ biv2 は作られず、リーダーは残りに入る
    const w2 = createWorld(map, s);
    applyActions(w2, ctx, [{ type: 'splitParty', groups: [
      { id: 'biv2', members: 'weak', leader: 'c', actions: [] },
      { id: 'descend', members: 'rest', leader: 'a', actions: [{ type: 'continueRoute' }] },
    ] }], w2.climbers, w2.climbers[0]!);
    expect(w2.groups.some((g) => g.id === 'biv2')).toBe(false);
    expect(groupMembers(w2, 'descend')).toHaveLength(5);
  });

  it('detach: 1 人が離れて別行動し、残りは進み続ける', () => {
    const s = party5();
    const w = createWorld(map, s);
    const ctx = createStaticContext(map, s);
    for (let i = 0; i < 900; i += 1) stepWorld(w, ctx);
    const start = s.plan.route[0]!;
    applyActions(w, ctx, [{ type: 'detach', who: 'e', then: [{ type: 'goToNode', node: start, then: 'stay' }] }], w.climbers, w.climbers[0]!);
    const e = w.climbers.find((c) => c.id === 'e')!;
    expect(e.groupId).toBe('solo_e');
    for (let i = 0; i < 1200 && !w.ended; i += 1) stepWorld(w, ctx);
    const a = w.climbers[0]!;
    expect(Math.hypot(e.x - a.x, e.z - a.z)).toBeGreaterThan(200);
  });

  it('loose: リーダーは先に進み、遅い人は離れる。人数確認で STRAGGLER が出る', () => {
    const s = party5();
    s.party[4] = { ...s.party[4]!, fitness: 0.6, experience: 0.1, weightKg: 50, packKg: 14 };
    s.groups = [{ id: 'main', members: 'all', leader: 'a', cohesion: 'loose' }];
    s.genericOverrides = { ...(s.genericOverrides ?? {}), straggler: { enabled: true } };
    const r = runHeadless(map, s, { policy: 'risky', seed: 2, collectEvents: true });
    expect(r.events.some((e) => e.type === 'STRAGGLER')).toBe(true);
    expect(r.world.decisions.some((d) => d.cpId === 'generic:straggler')).toBe(true);
  });

  it('大人数（20 人）でも最後まで走り、決定論的', () => {
    const s = party5();
    const base = s.party[0]!;
    s.party = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(base), id: `p${i}`, name: `P${i}`, leader: i === 0, age: 30 + i * 2 }));
    s.groups = [{ id: 'main', members: 'all', leader: 'p0', cohesion: 'tight' }];
    const a = runHeadless(map, s, { policy: 'bias', seed: 7 });
    const b = runHeadless(map, s, { policy: 'bias', seed: 7 });
    expect(a.world.ended).not.toBeNull();
    expect(JSON.stringify(b.world.climbers.map((c) => [c.state, c.body.coreC]))).toBe(JSON.stringify(a.world.climbers.map((c) => [c.state, c.body.coreC])));
  });
});

describe('浸水（docs/06 §4.1）', () => {
  it('深いほど濡れ・冷えが大きく、雪解け水は冷たい', () => {
    const mk = () => calibClimber({ hours: 0, env: {}, def: standardClimber() });
    const feet = mk();
    const full = mk();
    const warm = mk();
    applySoak(feet, 'feet', 2, 0);
    applySoak(full, 'full', 2, 0);
    applySoak(warm, 'full', 10, 0);
    expect(feet.body.wetness).toBeCloseTo(0.15, 5);
    expect(full.body.wetness).toBe(1);
    expect(37 - full.body.coreC).toBeGreaterThan(37 - feet.body.coreC);
    expect(37 - full.body.coreC).toBeGreaterThan(37 - warm.body.coreC);
    // 全身 2 分・水温 2℃・65 kg: 1200 W × 120 s × 35/27 ≒ 187 kJ → 約 0.3℃
    expect(37 - full.body.coreC).toBeGreaterThan(0.2);
    expect(37 - full.body.coreC).toBeLessThan(0.5);
    expect(feet.body.coldExtremitiesUntilMin).toBe(60);
  });
});

describe('スケルトンマップの結合（docs/16 §8）', () => {
  it('名前はひらがな・カタカナ・空白の違いを無視する', () => {
    expect(normalizeName('トムラウシ山')).toBe(normalizeName('とむらうし山'));
    expect(normalizeName('ヒサゴ沼 避難小屋')).toBe(normalizeName('ひさご沼避難小屋'));
  });
  it('候補は完全一致・概略標高に近い順', () => {
    const pts = [
      { name: '北沼', x: 0, z: 0, kind: 'water' },
      { name: '北沼分岐', x: 100, z: 0, kind: 'locality' },
    ];
    const c = candidatesFor({ id: 'K', name: '北沼渡渉点', type: 'landmark', x: 0, z: 0, osmName: '北沼', expectedElevM: 2000 }, pts, () => 2000);
    expect(c[0]!.name).toBe('北沼');
  });
  it('名前のないノードは、計画ルートの順に概略標高が合う位置へ置き、エッジは登山道をたどる', () => {
    // 東へ一直線に下る登山道（x: 0〜3000 m、標高 2000 → 1400 m）
    const elevAt = (x: number): number => 2000 - x * 0.2;
    const nodes = [
      { id: 'A', name: 'A', type: 'peak' as const, x: 0, z: 0 },
      { id: 'B', name: 'B', type: 'trailhead' as const, x: 3000, z: 0 },
    ];
    const edges = [{ id: 'E', name: 'AB', kind: 'trail' as const, from: 'A', to: 'B', class: 'T2' as const, markers: 0.7, drift: 0.02, sinuosity: 1, waypoints: Array.from({ length: 299 }, (_, i) => [(i + 1) * 10, 0] as [number, number]) }];
    const g = buildVertexGraph(nodes, edges);
    const sk = {
      id: 'sk', name: 'sk', size: 6144, resolution: 513, skeleton: true,
      terrain: { type: 'heightmap' as const, encoding: 'u16-base64' as const, minElevM: 0, maxElevM: 0, baseElevation: 0, source: { dem: 'DEM10B' as const, zoom: 14, fetchedAt: '' }, data: '' },
      vegetation: { forestLine: 1500, forestLineNoise: 0, broadleafLine: 1000 },
      nodes: [
        { id: 'TOP', name: '山頂', type: 'peak' as const, x: 0, z: 0, expectedElevM: 2000 },
        { id: 'MID1', name: '肩', type: 'landmark' as const, x: 0, z: 0, expectedElevM: 1800 },
        { id: 'MID2', name: '平', type: 'landmark' as const, x: 0, z: 0, expectedElevM: 1600 },
        { id: 'TH', name: '登山口', type: 'trailhead' as const, x: 0, z: 0, expectedElevM: 1400 },
      ],
      edges: ['TOP-MID1', 'MID1-MID2', 'MID2-TH'].map((k, i) => ({ id: `T${i}`, name: k, kind: 'trail' as const, from: k.split('-')[0]!, to: k.split('-')[1]!, class: 'T2' as const, markers: 0.7, drift: 0.02, sinuosity: 1, waypoints: [] })),
      hazards: [], radio: { stations: [] },
    };
    const r = joinSkeleton(sk, { TOP: { x: 0, z: 0 }, TH: { x: 3000, z: 0 } }, g, (x) => elevAt(x), { order: ['TOP', 'MID1', 'MID2', 'TH'] });
    expect(r.warnings).toEqual([]);
    expect(r.interpolated.sort()).toEqual(['MID1', 'MID2']);
    const at = (id: string): number => r.nodes.find((n) => n.id === id)!.x;
    expect(at('MID1')).toBeGreaterThan(900);
    expect(at('MID1')).toBeLessThan(1100);
    expect(at('MID2')).toBeGreaterThan(1900);
    expect(at('MID2')).toBeLessThan(2100);
    // ID はスケルトンのまま、エッジは登山道の頂点をたどる
    expect(r.edges.map((e) => e.id)).toEqual(['T0', 'T1', 'T2']);
    expect(r.edges[0]!.waypoints.length).toBeGreaterThan(50);
    expect(r.edges.every((e) => e.smooth === false)).toBe(true);
  });
});

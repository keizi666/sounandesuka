/**
 * バンドルの書き出し・読み込み（docs/15 §3.2、docs/18 §8）と、まとめて試すの集計
 */
import { describe, expect, it } from 'vitest';
import { deriveSeed } from '../src/sim/core/rng';
import { runHeadless } from '../src/sim/headless';
import { runMonteCarlo } from '../src/sim/mc';
import { validateScenario } from '../src/sim/scenario/validate';
import { buildMapRuntime } from '../src/sim/terrain/map';
import { mergeRuns, suggestTarget } from '../src/editor/mcMerge';
import { attributionFor, createFictionalProject, createRealProject, duplicateProject, fromBundle, hasTerrain, setHeights, toBundle } from '../src/editor/store/project';
import { validateEditor } from '../src/editor/validateMap';
import type { McRun } from '../src/workers/editorRun.worker';
import { sounanMap, loadSounanDef } from './helpers/map';
import { loadScenario } from './helpers/scenario';

/** なだらかな円錐の山（257 頂点・3,072 m）と、登山口→山頂の 1 本道 */
function realProject() {
  const p = createRealProject('試験の山', 36.4, 137.71, 3072, 257);
  const n = 257;
  const h = new Float32Array(n * n);
  for (let z = 0; z < n; z += 1) for (let x = 0; x < n; x += 1) h[z * n + x] = 1800 - Math.hypot(x - 128, z - 128) * 4;
  setHeights(p, h, { baseElevation: 1000, smoothing: 0, fetchedAt: '2026-11-19T00:00:00Z' });
  p.map.nodes.push({ id: 'TH001', name: '登山口', type: 'trailhead', x: -1200, z: 0, source: 'osm' }, { id: 'PK001', name: '山頂', type: 'peak', x: 0, z: 0, source: 'osm' });
  p.map.edges.push({ id: 'E001', name: '登山道', kind: 'trail', from: 'TH001', to: 'PK001', class: 'T2', markers: 0.8, drift: 0.02, sinuosity: 1, smooth: false, source: 'osm', waypoints: [[-800, 0], [-400, 0]] });
  p.scenario.plan = { ...p.scenario.plan, route: ['TH001', 'PK001', 'TH001'], goalNodes: ['TH001'] };
  return p;
}

describe('バンドル', () => {
  it('実在の山: 高さを base64 にして書き出し、読み戻すと同じ地形・同じ試走結果になる', () => {
    const p = realProject();
    expect(hasTerrain(p)).toBe(true);
    const b = toBundle(p);
    expect(b.format).toBe('sounan-bundle');
    expect(b.map.terrain.type).toBe('heightmap');
    expect(b.scenario.mapId).toBe(b.map.id);
    expect(validateScenario(b.scenario, b.map).filter((i) => i.level === 'error')).toEqual([]);
    const m1 = buildMapRuntime(b.map).map;
    const r1 = runHeadless(m1, b.scenario, { policy: 'recommended' });
    expect(r1.ending.kind).toBe('SAFE_RETURN');
    // 読み込み → もう一度書き出し
    const q = fromBundle(JSON.parse(JSON.stringify(b)));
    expect(q.heightsBuffer).not.toBeNull();
    expect(q.map.terrain.type === 'heightmap' && q.map.terrain.data).toBe('');
    const b2 = toBundle(q);
    const m2 = buildMapRuntime(b2.map).map;
    let maxErr = 0;
    for (let i = 0; i < m1.heights.length; i += 1) maxErr = Math.max(maxErr, Math.abs(m1.heights[i]! - m2.heights[i]!));
    expect(maxErr).toBeLessThan(0.05);
    expect(runHeadless(m2, b2.scenario, { policy: 'recommended' }).ending.kind).toBe('SAFE_RETURN');
  });

  it('出典は使ったデータ源だけ（地理院・OSM・Open-Meteo）', () => {
    const p = realProject();
    expect(attributionFor(p).map((a) => a.id)).toEqual(['gsi', 'osm']);
    p.map.nodes.forEach((n) => (n.source = 'manual'));
    p.map.edges.forEach((e) => (e.source = 'manual'));
    expect(attributionFor(p).map((a) => a.id)).toEqual(['gsi']);
    p.scenario.sources = ['気象の下書き: Open-Meteo（ERA5 再解析）2025-10-12 36.40,137.71'];
    expect(toBundle(p).attribution.map((a) => a.id)).toEqual(['gsi', 'open-meteo']);
    const f = createFictionalProject('架空', loadSounanDef());
    expect(attributionFor(f)).toEqual([]);
    for (const a of toBundle(p).attribution) expect(a.url).toMatch(/^https:\/\//);
  });

  it('架空の箱庭岳のプロジェクトは既存マップを参照し、検証エラーは計画ルートの不足だけにならない', () => {
    const f = createFictionalProject('架空', loadSounanDef());
    expect(f.scenario.mapId).toBe('sounan');
    f.scenario = { ...loadScenario('s01_cold_front') };
    const b = toBundle(f);
    expect(validateScenario(b.scenario, b.map).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateEditor(f, sounanMap().map).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('複製: そのまま／同じマップで新しいシナリオ', () => {
    const p = realProject();
    const a = duplicateProject(p, false);
    expect(a.id).not.toBe(p.id);
    expect(a.scenario.plan.route).toEqual(p.scenario.plan.route);
    const b = duplicateProject(p, true);
    expect(b.map.nodes).toHaveLength(2);
    expect(b.scenario.choices).toEqual([]);
    expect(b.scenario.region?.real).toBe(true);
    expect(new Float32Array(b.heightsBuffer!)[0]).toBe(new Float32Array(p.heightsBuffer!)[0]);
  });

  it('エディター固有の検証: 端がつながらない道・エリア外・未確定の道', () => {
    const p = realProject();
    p.map.edges.push({ id: 'E002', name: '切れた道', kind: 'trail', from: 'TH001', to: 'NOPE', class: 'T2', markers: 0.5, drift: 0.02, sinuosity: 1, waypoints: [] });
    p.map.nodes.push({ id: 'OUT', name: '外', type: 'landmark', x: 9000, z: 0 });
    p.editorState.draftEdgeIds = ['E001'];
    const iss = validateEditor(p, null);
    expect(iss.some((i) => i.code === 'dangling' && i.level === 'error')).toBe(true);
    expect(iss.some((i) => i.code === 'outside' && i.level === 'error')).toBe(true);
    expect(iss.some((i) => i.code === 'drafts')).toBe(true);
    expect(iss.some((i) => i.code === 'noHut')).toBe(true);
  });
});

describe('まとめて試すの集計', () => {
  it('偶数番・奇数番に分けて回した結果を合わせると、順に回した集計と一致する', () => {
    const { map } = sounanMap();
    const s = loadScenario('s03_thunder_ridge');
    const n = 12;
    const seq = runMonteCarlo(map, s, 'bias', n);
    const run = (i: number): McRun => {
      const r = runHeadless(map, s, { policy: 'bias', seed: deriveSeed(s.seed, i) });
      const dead = r.world.climbers.filter((c) => !c.body.alive);
      return { i, kind: r.ending.kind, minCoreC: r.record!.stats.minCoreC, wasLost: r.record!.stats.wasLost, deaths: dead.length, causes: dead.map((c) => c.body.deathCause ?? 'unknown'), decisions: r.world.decisions.map((d) => ({ cpId: d.cpId, optionId: d.optionId })) };
    };
    const odd = [1, 3, 5, 7, 9, 11].map(run);
    const even = [0, 2, 4, 6, 8, 10].map(run);
    const merged = mergeRuns(s.id, 'bias', [...odd, ...even], 0);
    expect(merged.counts).toEqual(seq.counts);
    expect(merged.choices).toEqual(seq.choices);
    expect(merged.minCore).toEqual(seq.minCore);
    expect(merged.lostRate).toBe(seq.lostRate);
    const t = suggestTarget('recommended', merged);
    expect(t.goodMin).toBeLessThanOrEqual(1);
    expect(t.fatalMax).toBeGreaterThanOrEqual(0);
  }, 30000); // 24 回走らせるので、ほかのテストと同時だと 5 秒を超えることがある（速さではなく一致を見るテスト）
});

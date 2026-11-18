import { describe, expect, it } from 'vitest';
import { posToWorld } from '../src/sim/climber/position';
import { edgeBetween, legCourseTimeMin, pointOnTrail, resolveRoute, shortestPath } from '../src/sim/terrain/trails';
import { hakoniwa } from './helpers/map';
import { loadScenario } from './helpers/scenario';

describe('登山道グラフ（docs/04 §5）', () => {
  it('全エッジがポリライン化され、実距離 = 水平距離 × sinuosity', () => {
    const { map } = hakoniwa();
    for (const e of map.def.edges) {
      const t = map.trails[e.id]!;
      expect(t.samples.length).toBeGreaterThan(2);
      const last = t.samples[t.samples.length - 1]!;
      expect(t.lengthM).toBeCloseTo(last.sH * e.sinuosity, 6);
      for (let i = 1; i < t.samples.length; i += 1) {
        const a = t.samples[i - 1]!;
        const b = t.samples[i]!;
        expect(b.sH - a.sH).toBeLessThanOrEqual(10 + 1e-6);
        expect(b.s).toBeGreaterThan(a.s);
      }
    }
  });

  it('エッジの端点はノード（スナップ後）の位置にある', () => {
    const { map } = hakoniwa();
    for (const e of map.def.edges) {
      const t = map.trails[e.id]!;
      const first = t.samples[0]!;
      expect([first.x, first.z]).toEqual([map.nodes[e.from]!.x, map.nodes[e.from]!.z]);
      if (e.to) {
        const last = t.samples[t.samples.length - 1]!;
        expect(last.x).toBeCloseTo(map.nodes[e.to]!.x, 9);
        expect(last.z).toBeCloseTo(map.nodes[e.to]!.z, 9);
      }
    }
  });

  it('隣接表: SADDLE_N には E5・E6・E8・F1 がつながる', () => {
    const { map } = hakoniwa();
    expect([...map.adjacency['SADDLE_N']!].sort()).toEqual(['E5', 'E6', 'E8', 'F1']);
  });

  it('ルート解決は向きつきで、偽の道は使わない', () => {
    const { map } = hakoniwa();
    expect(resolveRoute(map, ['TH_SAWA', 'J_FOREST', 'EBOSHI']).map((l) => [l.edgeId, l.dir])).toEqual([
      ['E1', 1],
      ['E2', 1],
    ]);
    expect(resolveRoute(map, ['EBOSHI', 'J_FOREST']).map((l) => [l.edgeId, l.dir])).toEqual([['E2', -1]]);
    expect('error' in edgeBetween(map, 'TH_SAWA', 'SUMMIT')).toBe(true);
    expect(() => resolveRoute(map, ['TH_SAWA', 'SUMMIT'])).toThrow(/登山道がありません/);
  });

  it('3 シナリオの計画ルートがすべて解決できる', () => {
    const { map } = hakoniwa();
    for (const id of ['s01_cold_front', 's02_fog_descent', 's03_thunder_ridge']) {
      expect(() => resolveRoute(map, loadScenario(id).plan.route), id).not.toThrow();
    }
  });

  it('ダイクストラはコースタイム最小の経路を返す', () => {
    const { map } = hakoniwa();
    // 稜線小屋から北の鞍部: 山頂経由（E4+E5 = 95 分）と、烏帽子・樹林帯・西尾根経由（大回り）
    expect(shortestPath(map, 'HUT_RIDGE', 'SADDLE_N')).toEqual(['HUT_RIDGE', 'SUMMIT', 'SADDLE_N']);
    expect(shortestPath(map, 'TH_SAWA', 'TH_SAWA')).toEqual(['TH_SAWA']);
    const p = shortestPath(map, 'TH_KITA', 'TH_SAWA')!;
    expect(p[0]).toBe('TH_KITA');
    expect(p[p.length - 1]).toBe('TH_SAWA');
    const legs = resolveRoute(map, p);
    const total = legs.reduce((s, l) => s + legCourseTimeMin(map, l), 0);
    expect(total).toBeGreaterThan(0);
  });

  it('エッジ上の位置: 端は端点、途中は補間、逆向きでも同じポリライン', () => {
    const { map } = hakoniwa();
    const t = map.trails['E3']!;
    expect(pointOnTrail(t, 0)).toMatchObject({ x: map.nodes['EBOSHI']!.x, z: map.nodes['EBOSHI']!.z });
    const mid = posToWorld(map, { mode: 'edge', edgeId: 'E3', s: t.lengthM / 2, dir: -1 });
    const same = posToWorld(map, { mode: 'edge', edgeId: 'E3', s: t.lengthM / 2, dir: 1 });
    expect(mid).toEqual(same);
    const nd = posToWorld(map, { mode: 'node', nodeId: 'SUMMIT' });
    expect(nd.elevM).toBe(map.nodes['SUMMIT']!.elevM);
  });

  it('危険箇所の区間がエッジの長さに収まる', () => {
    const { map } = hakoniwa();
    for (const h of map.def.hazards) {
      if (h.type === 'chain' || h.type === 'rockfallZone') {
        expect(h.sRange[1], h.id).toBeLessThanOrEqual(map.trails[h.onEdge]!.lengthM);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { EdgeDef, MapDef, NodeDef } from '../src/sim/types';
import { disambiguateRoute, nearestLinked } from '../src/editor/map/routeClick';

const node = (id: string, x: number, z: number): NodeDef => ({ id, name: id, type: 'junction', x, z, snap: false }) as NodeDef;
const edge = (id: string, from: string, to: string, waypoints: [number, number][], courseTimeMin?: [number, number]): EdgeDef =>
  ({ id, name: id, kind: 'trail', from, to, class: 'T2', markers: 0.6, drift: 0.02, sinuosity: 1, waypoints, ...(courseTimeMin ? { courseTimeMin } : {}) }) as EdgeDef;

/** A から B へ道が 2 本（尾根道が近く、巻き道が遠回り）、B から C へ 1 本。P は道につながらない山頂の印 */
function fixture(): MapDef {
  return {
    nodes: [node('A', 0, 0), node('B', 1000, 0), node('C', 2000, 0), node('P', 1000, 120)],
    edges: [
      edge('E1', 'A', 'B', [[300, 300], [500, 400], [700, 300]]),
      edge('E2', 'B', 'A', [[700, 20], [500, 30], [300, 20]]),
      edge('E3', 'B', 'C', [[1500, 0]]),
    ],
  } as unknown as MapDef;
}

describe('計画ルートの自動の手当て', () => {
  it('道が 2 本ある区間は、短いほうの道に経由点を足して通す（往復は同じ経由点）', () => {
    const map = fixture();
    const r = disambiguateRoute(map, ['A', 'B', 'C', 'B', 'A']);
    expect(r.notes).toHaveLength(1);
    const via = r.route[1]!;
    expect(r.route).toEqual(['A', via, 'B', 'C', 'B', via, 'A']);
    // 経由点は短い道（E2）の途中にある
    const n = map.nodes.find((x) => x.id === via)!;
    expect(Math.abs(n.z)).toBeLessThan(50);
    // A と B を直接結ぶ道は E1 だけになり、どの区間も 1 本に決まる
    for (let i = 1; i < r.route.length; i += 1) {
      const a = r.route[i - 1]!;
      const b = r.route[i]!;
      expect(map.edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)).length).toBe(1);
    }
  });

  it('道が 1 本ずつなら何も変えない', () => {
    const map = fixture();
    const before = map.edges.length;
    expect(disambiguateRoute(map, ['B', 'C']).route).toEqual(['B', 'C']);
    expect(map.edges.length).toBe(before);
  });

  it('つながっていない地点のそばの、つながった地点を探す', () => {
    const map = fixture();
    expect(nearestLinked(map, map.nodes.find((x) => x.id === 'P')!)?.id).toBe('B');
    expect(nearestLinked(map, map.nodes.find((x) => x.id === 'P')!, 100)).toBeNull();
  });
});

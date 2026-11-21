/**
 * 道の上にあるのに、その道の分かれ目になっていない地点（エディター）。見つけて、道に挿入してつなぐ。
 */
import { describe, expect, it } from 'vitest';
import { insertNodeOnEdge, nodesOnEdges } from '../src/editor/map/tools';
import type { MapDef, ScenarioDef } from '../src/sim/types';

function mapWith(): MapDef {
  return {
    id: 'm', name: 'm', size: 2048, resolution: 257,
    terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: 0, maxElevM: 1, baseElevation: 0, data: '' } as MapDef['terrain'],
    vegetation: { forestLine: 2500, forestLineNoise: 0, broadleafLine: 1500 },
    nodes: [
      { id: 'A', name: 'A', type: 'trailhead', x: 0, z: 0 },
      { id: 'B', name: 'B', type: 'junction', x: 400, z: 0 },
      { id: 'C', name: '大曲', type: 'junction', x: 200, z: 3 },
      { id: 'D', name: 'D', type: 'peak', x: 200, z: -300 },
    ],
    edges: [
      { id: 'E1', name: 'AB', kind: 'trail', from: 'A', to: 'B', class: 'T1', markers: 0.6, drift: 0.02, sinuosity: 1, waypoints: [[100, 0], [200, 0], [300, 0]] },
      { id: 'E2', name: 'CD', kind: 'trail', from: 'C', to: 'D', class: 'T1', markers: 0.6, drift: 0.02, sinuosity: 1, waypoints: [] },
    ],
    hazards: [],
    radio: { stations: [] },
  };
}

describe('道の上にあるのにつながっていない地点', () => {
  it('見つける（道の端の近くの地点や、その道の端の地点は数えない）', () => {
    const r = nodesOnEdges(mapWith());
    expect(r.map((x) => [x.node.id, x.edge.id])).toEqual([['C', 'E1']]);
  });
  it('道に挿入してつなぐと、その道を通るルートにも入り、もう見つからない', () => {
    const map = mapWith();
    const scenario = { plan: { route: ['A', 'B'], goalNodes: ['B'] }, choices: [], events: [] } as unknown as ScenarioDef;
    const h = nodesOnEdges(map)[0]!;
    insertNodeOnEdge(map, scenario, h.edge, { x: h.node.x, z: h.node.z }, h.node.id, 'E9', h.node);
    expect(map.nodes).toHaveLength(4);
    expect(map.edges.filter((e) => e.from === 'C' || e.to === 'C')).toHaveLength(3);
    expect(scenario.plan.route).toEqual(['A', 'C', 'B']);
    expect(nodesOnEdges(map)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { osmToGraph, overpassQuery, resample, suggestConfusers, trailAttrs, type OsmJson } from '../src/editor/geo/overpass';
import { toLatLon } from '../src/editor/geo/projection';

const lat0 = 36.4;
const lon0 = 137.71;
const size = 3072;
const ll = (x: number, z: number): { lat: number; lon: number } => toLatLon(lat0, lon0, x, z);

/** T 字の登山道（南北の道に東から合流）＋山頂＋小屋＋境界をはみ出す道 */
function fixture(): OsmJson {
  const N = (id: number, x: number, z: number, tags?: Record<string, string>) => ({ type: 'node' as const, id, ...ll(x, z), tags });
  const pts: Record<number, [number, number]> = { 1: [0, 1400], 2: [0, 600], 3: [0, 0], 4: [0, -800], 5: [800, 0], 6: [2000, 0] };
  const way = (id: number, ids: number[], tags: Record<string, string>) => ({ type: 'way' as const, id, nodes: ids, tags, geometry: ids.map((i) => ll(...pts[i]!)) });
  return {
    elements: [
      N(100, 0, -810, { natural: 'peak', name: '試験岳', 'name:ja': '試験岳' }),
      N(101, 10, 595, { tourism: 'alpine_hut', name: '試験小屋' }),
      N(102, 400, 0, { waterway: 'waterfall', name: '試験滝' }),
      way(10, [1, 2, 3, 4], { highway: 'path', sac_scale: 'mountain_hiking' }),
      way(11, [3, 5, 6], { highway: 'path', trail_visibility: 'bad' }),
    ],
  };
}

describe('Overpass の取り込み', () => {
  it('境界点から境界点へ出るだけの短い道（500 m 未満）と、その境界点は取り込まない', () => {
    const h = size / 2;
    // 範囲の北東の角をかすめる道（約 280 m）と、範囲を横切る長い道
    const corner = [ll(h - 300, -h - 100), ll(h - 80, -h + 80), ll(h + 100, -h + 300)];
    const across = [ll(-h - 100, 200), ll(0, 200), ll(h + 100, 200)];
    const json: OsmJson = {
      elements: [
        { type: 'way', id: 1, nodes: [1, 2, 3], tags: { highway: 'path' }, geometry: corner },
        { type: 'way', id: 2, nodes: [4, 5, 6], tags: { highway: 'path' }, geometry: across },
      ],
    };
    const g = osmToGraph(json, lat0, lon0, size, () => 1500);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.filter((n) => n.type === 'boundary')).toHaveLength(2);
  });
  it('廃道（偽の道）は行き止まりになり、その先の分岐点はどの道にもつながらないまま残さない', () => {
    const json: OsmJson = {
      elements: [
        { type: 'way', id: 1, nodes: [1, 2, 3], tags: { highway: 'path' }, geometry: [ll(0, 600), ll(0, 0), ll(0, -600)] },
        { type: 'way', id: 2, nodes: [2, 4], tags: { highway: 'path', 'abandoned:highway': 'path' }, geometry: [ll(0, 0), ll(500, 0)] },
      ],
    };
    const g = osmToGraph(json, lat0, lon0, size, () => 1500);
    const fake = g.edges.find((e) => e.kind === 'false')!;
    expect(fake.to).toBeUndefined();
    const used = new Set(g.edges.flatMap((e) => [e.from, e.to ?? '']));
    for (const n of g.nodes.filter((x) => x.type === 'junction' || x.type === 'boundary')) expect(used.has(n.id), n.id).toBe(true);
  });
  it('問い合わせは 1 回分の bbox を含む', () => {
    expect(overpassQuery(lat0, lon0, size)).toMatch(/way\["highway"/);
  });
  it('共有点・地点で分割し、境界で切って境界点を作る', () => {
    const g = osmToGraph(fixture(), lat0, lon0, size, () => 1500);
    const peak = g.nodes.find((n) => n.type === 'peak')!;
    const hut = g.nodes.find((n) => n.type === 'hut')!;
    expect(peak.name).toBe('試験岳');
    expect(hut.shelter).toEqual({ kind: 'staffed', open: true });
    expect(g.hazards[0]).toMatchObject({ type: 'waterfall', radius: 40 });
    // 南北の道は 小屋（25 m 以内）・合流点・山頂 で分割され、東の道は境界で切れて境界点（登山口ではない）になる
    const th = g.nodes.filter((n) => n.type === 'boundary');
    expect(g.nodes.some((n) => n.type === 'trailhead')).toBe(false);
    expect(th[0]!.name).toBe('境界点');
    expect(th.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(Math.abs(th[0]!.x), Math.abs(th[0]!.z))).toBeCloseTo(size / 2, 0);
    // 分岐点は合流点と、エリア内で終わる南端の 2 つ
    expect(g.nodes.filter((n) => n.type === 'junction').length).toBe(2);
    expect(g.edges).toHaveLength(4);
    const toPeak = g.edges.find((e) => e.to === peak.id || e.from === peak.id)!;
    expect(toPeak.class).toBe('T2');
    expect(toPeak.smooth).toBe(false);
    expect(toPeak.sinuosity).toBe(1);
    // 東の道（見えにくい）は markers 0.2、東端は境界で切れる
    const east = g.edges.find((e) => e.markers === 0.2);
    expect(east).toBeDefined();
    expect(g.draftEdgeIds.length).toBe(g.edges.length);
    // すべてのエッジの端は存在するノード
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      if (e.to) expect(ids.has(e.to)).toBe(true);
    }
    // 頂点はおよそ 10 m 間隔
    const w = toPeak.waypoints;
    for (let i = 1; i < w.length; i += 1) expect(Math.hypot(w[i]![0] - w[i - 1]![0], w[i]![1] - w[i - 1]![1])).toBeLessThan(10.5);
  });
  it('way に nodes がない応答（out geom）でも、座標が同じ点を共有点として分割できる', () => {
    const f = fixture();
    for (const e of f.elements) delete e.nodes;
    const g = osmToGraph(f, lat0, lon0, size, () => 1500);
    expect(g.edges).toHaveLength(4);
  });
  it('タグから class・markers・廃道', () => {
    expect(trailAttrs({ sac_scale: 'hiking' }, 30).cls).toBe('T1');
    expect(trailAttrs({}, 20).cls).toBe('T2');
    expect(trailAttrs({ 'abandoned:highway': 'path' }, 5).kind).toBe('false');
    expect(trailAttrs({ highway: 'track' }, 30)).toMatchObject({ cls: 'T1', markers: 0.8 });
  });
  it('再サンプルは端点を保つ', () => {
    const r = resample([{ x: 0, z: 0 }, { x: 35, z: 0 }], 10);
    expect(r[0]).toEqual({ x: 0, z: 0 });
    expect(r[r.length - 1]).toEqual({ x: 35, z: 0 });
  });
  it('紛らわしい分岐の提案: 偽の道が絡む分岐に confusers が付く', () => {
    const g = osmToGraph(fixture(), lat0, lon0, size, () => 1500);
    g.edges.push({ id: 'F1', name: '踏み跡', kind: 'false', from: g.edges[0]!.to!, class: 'T3', markers: 0.1, drift: 0.1, sinuosity: 1, waypoints: [[30, 0]], fadeOutM: 200 });
    expect(suggestConfusers(g.nodes, g.edges)).toBeGreaterThan(0);
  });
});

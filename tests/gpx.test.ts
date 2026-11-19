import { describe, expect, it } from 'vitest';
import { parseGpx, trackAsTrails, trackToRoute, trackToXZ } from '../src/editor/geo/gpx';
import { toLatLon } from '../src/editor/geo/projection';
import { sounanMap } from './helpers/map';

const lat0 = 36.4;
const lon0 = 137.71;

function gpxOf(points: [number, number][], name = '山行'): string {
  const pts = points.map(([x, z]) => {
    const p = toLatLon(lat0, lon0, x, z);
    return `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>1500</ele><time>2026-10-17T00:00:00Z</time></trkpt>`;
  });
  return `<?xml version="1.0"?><gpx version="1.1" creator="t"><wpt lat="${lat0}" lon="${lon0}"><ele>1600</ele><name>中心 &amp; 地点</name></wpt><trk><name>${name}</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

describe('GPX', () => {
  it('軌跡と地点を読む', () => {
    const d = parseGpx(gpxOf([[0, 0], [100, 0], [200, 50]]));
    expect(d.tracks).toHaveLength(1);
    expect(d.tracks[0]!.name).toBe('山行');
    expect(d.tracks[0]!.points).toHaveLength(3);
    expect(d.tracks[0]!.points[0]!.ele).toBe(1500);
    expect(d.waypoints[0]!.name).toBe('中心 & 地点');
  });
  it('GPX でなければエラー', () => {
    expect(() => parseGpx('<kml></kml>')).toThrow();
  });
  it('登山道として追加: 既存の道に重なる部分は使わず、離れた区間だけを新しいエッジにする', () => {
    const d = parseGpx(gpxOf([[0, 0], [300, 0], [300, 300], [0, 300]]));
    const track = trackToXZ(d.tracks[0]!.points, lat0, lon0, 3072);
    // 既存: (0,0)〜(300,0) の道
    const existing = {
      nodes: [
        { id: 'A', name: 'A', type: 'trailhead' as const, x: 0, z: 0 },
        { id: 'B', name: 'B', type: 'junction' as const, x: 300, z: 0 },
      ],
      edges: [{ id: 'E1', name: 'AB', kind: 'trail' as const, from: 'A', to: 'B', class: 'T1' as const, markers: 0.8, drift: 0.02, sinuosity: 1, waypoints: Array.from({ length: 29 }, (_, i) => [(i + 1) * 10, 0] as [number, number]) }],
    };
    let k = 0;
    const r = trackAsTrails(track, existing, (p) => `${p}${++k}`);
    expect(r.edges.length).toBe(1);
    expect(r.edges[0]!.from).toBe('B');
    expect(r.edges[0]!.source).toBe('gpx');
  });
  it('計画ルートとして使う: 箱庭岳の登山道にマップマッチングする', () => {
    const { map } = sounanMap();
    const ids = Object.keys(map.adjacency).filter((id) => map.adjacency[id]!.length > 0);
    const a = map.nodes[ids[0]!]!;
    const e = map.trails[map.adjacency[a.id]![0]!]!;
    const b = map.nodes[e.def.from === a.id ? e.def.to! : e.def.from]!;
    const track = e.samples.map((s) => ({ x: s.x, z: s.z }));
    const route = trackToRoute(e.def.from === a.id ? track : [...track].reverse(), map);
    expect(route[0]).toBe(a.id);
    expect(route[route.length - 1]).toBe(b.id);
  });
});

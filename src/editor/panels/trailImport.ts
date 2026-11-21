/**
 * 登山道の取り込み（登山道と地点のタブ）: OpenStreetMap の応答を道と地点に変換して下書きとして足す、GPX の軌跡を登山道・計画ルート・偽の道にする。
 * trails.ts から分けた（ファイルが長くなったため）。
 */
import type { EdgeDef, NodeDef } from '../../sim/types';
import type { Ed } from '../context';
import { parseGpx, trackAsTrails, trackToRoute, trackToXZ } from '../geo/gpx';
import { osmToGraph, suggestConfusers, type OsmJson } from '../geo/overpass';
import { nextId } from '../store/project';
import { sampleElevAt } from './elev';

export function importOsm(ed: Ed, json: OsmJson): void {
  const g = ed.p.map.geo!;
  const rt = ed.runtime();
  const res = osmToGraph(json, g.centerLat, g.centerLon, ed.p.map.size, (x, z) => (rt ? sampleElevAt(rt, x, z) : 0));
  ed.change('OSM の取り込み', () => {
    // 既存の ID と重ならないよう振り直す
    const map = ed.p.map;
    const ren = new Map<string, string>();
    for (const n of res.nodes) {
      const prefix = n.id.replace(/\d+$/, '');
      const id = map.nodes.some((x) => x.id === n.id) ? nextId([...map.nodes.map((x) => x.id), ...res.nodes.map((x) => x.id)], prefix) : n.id;
      ren.set(n.id, id);
      n.id = id;
      map.nodes.push(n);
    }
    for (const e of res.edges) {
      const id = map.edges.some((x) => x.id === e.id) ? nextId([...map.edges.map((x) => x.id), ...res.edges.map((x) => x.id)], 'E') : e.id;
      e.from = ren.get(e.from) ?? e.from;
      if (e.to) e.to = ren.get(e.to) ?? e.to;
      e.id = id;
      map.edges.push(e);
      ed.p.editorState.draftEdgeIds.push(id);
    }
    map.hazards.push(...res.hazards.map((h, i) => ({ ...h, id: nextId(map.hazards.map((x) => x.id), 'WF') + (i ? '' : '') })));
    suggestConfusers(map.nodes, map.edges);
  }, true);
  ed.toast(`道 ${res.edges.length} 本・地点 ${res.nodes.length} を下書きとして取り込みました${res.warnings.length ? `（${res.warnings.join('、')}）` : ''}`, 6000);
}

export async function importGpx(ed: Ed, f: File, gpxUse: 'trail' | 'route' | 'false'): Promise<void> {
  const g = ed.p.map.geo;
  if (!g) return ed.toast('GPX は実在の山のプロジェクトで使えます');
  const text = await f.text();
  const data = parseGpx(text);
  // すべての軌跡（トラックのセグメントごと・ルート）を使う（ユーザーの指摘: 最初のセグメントしか読まれなかった）。範囲の外だけの軌跡は落とす
  const tracks = data.tracks.map((t) => ({ name: t.name, xz: trackToXZ(t.points, g.centerLat, g.centerLon, ed.p.map.size) })).filter((t) => t.xz.length >= 2);
  if (tracks.length === 0) return ed.toast(data.tracks.length ? 'GPX の軌跡が範囲の中にありません' : 'GPX に軌跡がありません');
  ed.p.raw.gpx = [...(ed.p.raw.gpx ?? []), text];
  if (gpxUse === 'route') {
    const rt = ed.runtime();
    if (!rt) return;
    // 軌跡を順につないで、まとめてマップマッチングする
    const route = trackToRoute(tracks.flatMap((t) => t.xz), rt);
    if (route.length < 2) return ed.toast('軌跡を既存の登山道に重ねられませんでした');
    ed.change('GPX から計画ルート', () => (ed.p.scenario.plan.route = route));
    return ed.toast(`計画ルート: ${route.length} 地点${tracks.length > 1 ? `（軌跡 ${tracks.length} 本をつないで）` : ''}`);
  }
  const ids = [...ed.p.map.nodes.map((n) => n.id), ...ed.p.map.edges.map((e) => e.id)];
  const nid = (p: string): string => {
    const id = nextId(ids, p);
    ids.push(id);
    return id;
  };
  if (gpxUse === 'false') {
    ed.change('GPX から偽の道', () => {
      for (const t of tracks) {
        const start = hitNearestNode(ed, t.xz[0]!);
        ed.p.map.edges.push({ id: nid('F'), name: t.name || '迷った軌跡', kind: 'false', from: start.id, class: 'T3', markers: 0.1, drift: 0.1, sinuosity: 1, smooth: false, source: 'gpx', fadeOutM: 300, attractiveness: 0.5, waypoints: t.xz.slice(1).map((p) => [p.x, p.z]) });
      }
    }, true);
    return ed.toast(`偽の道 ${tracks.length} 本を足しました`);
  }
  // 登山道: 軌跡を 1 本ずつ足す（前の軌跡で足した道・地点にも重ねる）
  const nodes: NodeDef[] = [];
  const edges: EdgeDef[] = [];
  for (const t of tracks) {
    const r = trackAsTrails(t.xz, { nodes: [...ed.p.map.nodes, ...nodes], edges: [...ed.p.map.edges, ...edges] }, nid);
    nodes.push(...r.nodes);
    edges.push(...r.edges);
  }
  ed.change('GPX から登山道', () => {
    ed.p.map.nodes.push(...nodes);
    ed.p.map.edges.push(...edges);
  }, true);
  ed.toast(`新しい道 ${edges.length} 本${tracks.length > 1 ? `（軌跡 ${tracks.length} 本から）` : ''}（既存の道と重なる部分は既存を使いました）`);
}

function hitNearestNode(ed: Ed, p: { x: number; z: number }): NodeDef {
  return ed.p.map.nodes.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a));
}

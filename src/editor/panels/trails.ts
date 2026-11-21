/**
 * タブ 2 登山道（docs/16 §4）: OSM から取り込む（下書き→確定）、GPX、手描き、エッジのインスペクタ、紛らわしい分岐の提案、計画ルートを引く。
 */
import { runHeadless } from '../../sim/headless';
import type { EdgeDef, NodeDef } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import type { EditorApp } from '../EditorApp';
import { button, check, fill, num, section, select, text } from '../forms/fields';
import { toolPalette } from '../forms/toolPalette';
import { parseGpx, trackAsTrails, trackToRoute, trackToXZ } from '../geo/gpx';
import { fetchOsm, osmToGraph, resample, suggestConfusers, type OsmJson } from '../geo/overpass';
import { sampleElevAt } from './elev';
import { clickRouteNode } from '../map/routeClick';
import { nodeDragger } from '../map/nodeDrag';
import { nodeInspector } from './points';
import { routeList } from './routeList';
import { edgePoints, hitEdge, hitNode, insertNodeOnEdge, mergeEdges, reverseEdge, splitEdge } from '../map/tools';
import type { MapTool } from '../map/TileMapView';
import { nextId } from '../store/project';
import { clearEdgeSel, edgeSel, removeSelection } from '../map/edgeSelection';
import { buildVertexGraph, joinSkeleton, namedPoints } from '../geo/skeleton';
import { defaultBinding } from '../geo/skeletonBind';
import { standardLegMin, suggestPaceAdj } from '../pace';
import type { Panel } from './types';
import { nextPaint, showLoading } from '../../ui/loading';

type Mode = 'select' | 'box' | 'draw' | 'split' | 'route';
let mode: Mode = 'select';
let drawing: { x: number; z: number }[] = [];
let gpxUse: 'trail' | 'route' | 'false' = 'trail';
let busy = '';

function importOsm(ed: Ed, json: OsmJson): void {
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

function confirmDrafts(ed: Ed, ids: string[]): void {
  ed.change('下書きを確定', () => {
    ed.p.editorState.draftEdgeIds = ed.p.editorState.draftEdgeIds.filter((x) => !ids.includes(x));
  });
}

function removeEdges(ed: Ed, ids: string[]): void {
  removeSelection(ed, ids, [], { pruneOrphans: true });
}

/** いま選んでいる道（複数選択か、1 本の選択） */
function selectedEdgeIds(ed: Ed): string[] {
  if (edgeSel.ids.size > 0) return [...edgeSel.ids];
  const sel = ed.p.editorState.selection;
  return sel.kind === 'edge' && sel.id && ed.p.map.edges.some((e) => e.id === sel.id) ? [sel.id] : [];
}

/** 矩形に一部でも入る道を選ぶ（add なら今の選択に足す） */
function selectInBox(ed: Ed, b: { x0: number; z0: number; x1: number; z1: number }, add: boolean): void {
  const x0 = Math.min(b.x0, b.x1);
  const x1 = Math.max(b.x0, b.x1);
  const z0 = Math.min(b.z0, b.z1);
  const z1 = Math.max(b.z0, b.z1);
  if (add) for (const id of selectedEdgeIds(ed)) edgeSel.ids.add(id);
  else {
    edgeSel.ids.clear();
    edgeSel.nodeIds.clear();
  }
  const rt = ed.runtime();
  for (const e of ed.p.map.edges) {
    if (edgePoints(ed.p.map, rt, e).some((p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1)) edgeSel.ids.add(e.id);
  }
  // 矩形の中の地点も選ぶ（道につながらない地点も消せるように）
  for (const n of ed.p.map.nodes) if (n.x >= x0 && n.x <= x1 && n.z >= z0 && n.z <= z1) edgeSel.nodeIds.add(n.id);
  // 道 1 本だけ（地点なし）なら、ふつうの選択（属性を編集できる）にする
  if (edgeSel.ids.size === 1 && edgeSel.nodeIds.size === 0) {
    ed.p.editorState.selection = { kind: 'edge', id: [...edgeSel.ids][0]! };
    edgeSel.ids.clear();
  } else ed.p.editorState.selection = { kind: null, id: null };
}

/** 計画ルートから 1 km 以上離れた下書きの道 */
function farFromRoute(ed: Ed): string[] {
  const rnodes = ed.p.scenario.plan.route.map((id) => ed.p.map.nodes.find((n) => n.id === id)).filter((n): n is NodeDef => Boolean(n));
  if (rnodes.length === 0) return [];
  return ed.p.editorState.draftEdgeIds.filter((id) => {
    const e = ed.p.map.edges.find((x) => x.id === id);
    if (!e) return false;
    const pts = edgePoints(ed.p.map, null, e);
    return pts.every((p) => rnodes.every((n) => Math.hypot(n.x - p.x, n.z - p.z) > 1000));
  });
}

async function importGpx(ed: Ed, f: File): Promise<void> {
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

function finishDrawing(ed: Ed): void {
  const pts = drawing;
  drawing = [];
  if (pts.length < 2) return;
  const map = ed.p.map;
  const ids = [...map.nodes.map((n) => n.id), ...map.edges.map((e) => e.id)];
  const rt = ed.runtime();
  let joined = 0;
  /**
   * 描いた線の端の地点: 近くの地点（20 m か画面で 12 px 以内）があればそれ。
   * なければ、既存の道の上（画面で 10 px 以内）ならその道をそこで分けて分岐点を作り、つなぐ
   * （道の途中に重ねただけでは、見た目はつながっていてもルートが引けないため）。どちらでもなければ新しい分岐点
   */
  const endNode = (p: { x: number; z: number }, nodes: NodeDef[]): NodeDef => {
    const px = ed.view.xzToPx(p.x, p.z);
    const near =
      map.nodes.find((n) => Math.hypot(n.x - p.x, n.z - p.z) < 20) ??
      nodes.find((n) => Math.hypot(n.x - p.x, n.z - p.z) < 20) ??
      hitNode(ed.view, { ...map, nodes: [...map.nodes, ...nodes] }, px.px, px.py, 12);
    if (near) return near;
    const id = nextId(ids, 'N');
    ids.push(id);
    const onEdge = hitEdge(ed.view, { ...map, edges: map.edges.filter((e) => e.kind === 'trail' && e.to) }, rt, px.px, px.py, 10);
    if (onEdge) {
      const eid = nextId(ids, 'E');
      ids.push(eid);
      splitEdge(map, onEdge.edge, p, id, eid);
      if (ed.p.editorState.draftEdgeIds.includes(onEdge.edge.id)) ed.p.editorState.draftEdgeIds.push(eid);
      joined += 1;
      return map.nodes.find((n) => n.id === id)!;
    }
    const n: NodeDef = { id, name: id, type: 'junction', x: p.x, z: p.z, snap: false, source: 'manual' };
    nodes.push(n);
    return n;
  };
  ed.change('道を描く', () => {
    const added: NodeDef[] = [];
    const a = endNode(pts[0]!, added);
    const b = endNode(pts[pts.length - 1]!, added);
    map.nodes.push(...added);
    const dense = resample(pts, 10);
    const id = nextId(ids, 'E');
    map.edges.push({ id, name: `${a.name}〜${b.name}`, kind: 'trail', from: a.id, to: b.id, class: 'T2', markers: 0.6, drift: 0.02, sinuosity: 1, smooth: false, source: 'manual', waypoints: dense.slice(1, -1).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]) });
    ed.p.editorState.selection = { kind: 'edge', id };
  }, true);
  if (joined > 0) ed.toast(`描いた道の端を、重なった道の途中につなぎました（分岐点を ${joined} つ作りました）`, 4000);
}

function tool(ed: Ed): MapTool {
  let boxAdd = false;
  const drag = nodeDragger(ed);
  return {
    cursor: mode === 'select' ? 'pointer' : 'crosshair',
    // 範囲選択の道具、または「選択」で Shift を押しながらドラッグすると、矩形で囲んで道を選ぶ
    down(p) {
      // 「選択」「地点を挿入」では、地点の上で押してドラッグすると地点を動かす（地点タブへ行かなくてよい）
      if ((mode === 'select' || mode === 'split') && !p.ev.shiftKey && drag.down(p)) return true;
      if (mode !== 'box' && !(mode === 'select' && p.ev.shiftKey)) return false;
      boxAdd = p.ev.shiftKey || p.ev.ctrlKey;
      edgeSel.box = { x0: p.x, z0: p.z, x1: p.x, z1: p.z };
      return true;
    },
    up(p) {
      if (drag.up()) return;
      const b = edgeSel.box;
      if (!b) return;
      b.x1 = p.x;
      b.z1 = p.z;
      edgeSel.box = null;
      // ほとんど動かさなかったときはクリックとして扱う（click が呼ばれる）
      if (Math.abs(b.x1 - b.x0) < 1e-6 && Math.abs(b.z1 - b.z0) < 1e-6) return;
      selectInBox(ed, b, boxAdd);
      ed.refresh();
    },
    click(p) {
      const rt = ed.runtime();
      if (mode === 'select' || mode === 'box') {
        edgeSel.box = null;
        const n = mode === 'select' ? hitNode(ed.view, ed.p.map, p.px, p.py) : null;
        if (n) {
          clearEdgeSel();
          return ed.select('node', n.id);
        }
        const e = hitEdge(ed.view, ed.p.map, rt, p.px, p.py);
        // Ctrl・Shift を押しながらクリックすると、選んだ道に足す（もう一度で外す）
        if (e && (p.ev.ctrlKey || p.ev.shiftKey)) {
          for (const id of selectedEdgeIds(ed)) edgeSel.ids.add(id);
          if (edgeSel.ids.has(e.edge.id)) edgeSel.ids.delete(e.edge.id);
          else edgeSel.ids.add(e.edge.id);
          ed.p.editorState.selection = { kind: null, id: null };
          return ed.refresh();
        }
        clearEdgeSel();
        return ed.select(e ? 'edge' : null, e?.edge.id ?? null);
      }
      if (mode === 'draw') {
        const n = hitNode(ed.view, ed.p.map, p.px, p.py);
        drawing.push(n ? { x: n.x, z: n.z } : { x: p.x, z: p.z });
        ed.view.redraw();
        return;
      }
      if (mode === 'split') {
        const h = hitEdge(ed.view, ed.p.map, rt, p.px, p.py);
        if (!h) return;
        const ids = [...ed.p.map.nodes.map((n) => n.id), ...ed.p.map.edges.map((e) => e.id)];
        const nodeId = nextId(ids, 'N');
        ed.change('地点を挿入', () => {
          insertNodeOnEdge(ed.p.map, ed.p.scenario, h.edge, { x: p.x, z: p.z }, nodeId, nextId(ids, 'E'));
          // 挿入した地点を選ぶ（そのままドラッグで動かせ、名前・種類も右で編集できる）
          clearEdgeSel();
          ed.p.editorState.selection = { kind: 'node', id: nodeId };
        }, true);
        return;
      }
      if (mode === 'route' && rt) {
        const n = hitNode(ed.view, ed.p.map, p.px, p.py);
        if (n) clickRouteNode(ed, n);
      }
    },
    dblclick() {
      if (mode === 'draw') finishDrawing(ed);
    },
    move(p, dragging) {
      if (drag.move(p, dragging)) return;
      if (dragging && edgeSel.box) {
        edgeSel.box.x1 = p.x;
        edgeSel.box.z1 = p.z;
        ed.view.redraw();
        return;
      }
      if (mode !== 'draw' || drawing.length === 0) return;
      // 描画中の線と区間の傾斜
      ed.view.redraw();
      setTimeout(() => {
        const g = ed.view.canvas.getContext('2d')!;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const rt = ed.runtime();
        const all = [...drawing, { x: p.x, z: p.z }];
        for (let i = 1; i < all.length; i += 1) {
          const a = all[i - 1]!;
          const b = all[i]!;
          const h = Math.hypot(b.x - a.x, b.z - a.z);
          const deg = rt && h > 0 ? (Math.atan(Math.abs(sampleElevAt(rt, b.x, b.z) - sampleElevAt(rt, a.x, a.z)) / h) * 180) / Math.PI : 0;
          const pa = ed.view.xzToPx(a.x, a.z);
          const pb = ed.view.xzToPx(b.x, b.z);
          g.strokeStyle = deg > 38 ? '#ff0000' : '#ffcc00';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(pa.px, pa.py);
          g.lineTo(pb.px, pb.py);
          g.stroke();
          if (i === all.length - 1) {
            g.fillStyle = '#000';
            g.font = '12px system-ui';
            g.fillText(`${Math.round(h)} m・${deg.toFixed(0)}°`, pb.px + 10, pb.py + 14);
          }
        }
      }, 5);
    },
  };
}

function edgeInspector(ed: Ed, e: EdgeDef): HTMLElement {
  const rt = ed.runtime();
  const set = (label: string, f: () => void): void => ed.change(label, f, true);
  const sim = rt && e.to ? [standardLegMin(rt, e.id, 1), standardLegMin(rt, e.id, -1)] : null;
  const others = ed.p.map.edges.filter((x) => x !== e && (x.from === e.from || x.to === e.from || x.from === e.to || x.to === e.to));
  return el('div', {}, [
    el('h3', {}, `道 ${e.id}`),
    text('名前', e.name, (v) => set('道の名前', () => (e.name = v))),
    select('種類', e.kind, [['trail', '登山道'], ['false', '偽の道（踏み跡・廃道）']], (v) => set('道の種類', () => {
      e.kind = v;
      if (v === 'false') {
        e.fadeOutM ??= 300;
        e.attractiveness ??= 0.5;
      }
    })),
    select('等級', e.class, [['T1', 'T1 よく整備'], ['T2', 'T2 一般登山道'], ['T3', 'T3 岩場・急登']], (v) => set('等級', () => (e.class = v))),
    num('標識・踏み跡', e.markers, (v) => set('markers', () => (e.markers = v)), { min: 0, max: 1, step: 0.05, hint: '0 = 何もない、1 = はっきり' }),
    num('逸れやすさ', e.drift, (v) => set('drift', () => (e.drift = v)), { min: 0, max: 0.3, step: 0.01 }),
    e.kind === 'false' ? num('消えるまで', e.fadeOutM ?? 300, (v) => set('fadeOutM', () => (e.fadeOutM = v)), { min: 20, step: 10, unit: 'm' }) : null,
    e.kind === 'false' ? num('入り込みやすさ', e.attractiveness ?? 0.5, (v) => set('attractiveness', () => (e.attractiveness = v)), { min: 0, max: 1, step: 0.05 }) : null,
    e.to ? num('コースタイム（順）', e.courseTimeMin?.[0] ?? null, (v) => set('コースタイム', () => (e.courseTimeMin = [v, e.courseTimeMin?.[1] ?? v])), { min: 1, unit: '分' }) : null,
    e.to ? num('コースタイム（逆）', e.courseTimeMin?.[1] ?? null, (v) => set('コースタイム', () => (e.courseTimeMin = [e.courseTimeMin?.[0] ?? v, v])), { min: 1, unit: '分' }) : null,
    sim ? el('p', { class: 'note' }, `標準登山者の試算（休憩なし）: 順 ${Math.round(sim[0]! / (e.paceAdj ?? 1))} 分・逆 ${Math.round(sim[1]! / (e.paceAdj ?? 1))} 分`) : null,
    num('速度係数 paceAdj', e.paceAdj ?? 1, (v) => set('paceAdj', () => (e.paceAdj = v)), { min: 0.6, max: 1.4, step: 0.05 }),
    sim && e.courseTimeMin ? button(`コースタイムに合わせる（${suggestPaceAdj(sim[0]!, e.courseTimeMin[0])}）`, () => set('paceAdj', () => (e.paceAdj = suggestPaceAdj(sim[0]!, e.courseTimeMin![0])))) : null,
    el('div', {}, [
      button('向きを反転', () => set('向きを反転', () => reverseEdge(e))),
      ...others.map((o) => button(`${o.id} と結合`, () => set('結合', () => void (mergeEdges(ed.p.map, e, o) || ed.toast('つなぎ目のノードに 3 本以上の道があるので結合できません'))))),
      button('削除', () => removeEdges(ed, [e.id]), 'danger'),
    ]),
  ]);
}

/** スケルトンマップを、取り込んだ OSM の登山道に結合する（docs/16 §8）。名前の合う地点に結び、残りは計画ルートの順に補間する */
function joinSkeletonMap(ed: Ed): void {
  const geo = ed.p.map.geo;
  const rt = ed.runtime();
  const osm = ed.p.raw.osm as OsmJson | undefined;
  if (!geo || !rt) return ed.toast('先にタブ 1 で標高を取得してください');
  if (!osm) return ed.toast('先に「OpenStreetMap から取り込む」を押して、登山道のデータを取得してください（下書きは除外してかまいません）');
  const elevAt = (x: number, z: number): number => sampleElevAt(rt, x, z);
  const og = osmToGraph(osm, geo.centerLat, geo.centerLon, ed.p.map.size, elevAt);
  const graph = buildVertexGraph(og.nodes, og.edges);
  const sk = { ...ed.p.map, nodes: ed.p.map.nodes.filter((n) => n.osmName !== undefined || n.expectedElevM !== undefined), edges: ed.p.map.edges.filter((e) => !ed.p.editorState.draftEdgeIds.includes(e.id)) };
  const bind = defaultBinding(sk, namedPoints(osm, geo.centerLat, geo.centerLon, ed.p.map.size), elevAt);
  const r = joinSkeleton(sk, bind, graph, elevAt, { snapM: 500, order: ed.p.scenario.plan.route });
  if (r.nodes.length < sk.nodes.length) {
    busy = `結合できませんでした: ${r.warnings.join(' / ')}`;
    return ed.refresh();
  }
  ed.change('スケルトンの結合', () => {
    ed.p.map.nodes = r.nodes.map((n) => ({ ...n, source: 'osm' as const }));
    ed.p.map.edges = r.edges.map((e) => ({ ...e, source: 'osm' as const }));
    ed.p.map.skeleton = false;
    ed.p.editorState.draftEdgeIds = [];
  }, true);
  busy = `結合しました。名前で結び付けた地点: ${r.matched.length}、登山道の上に補間で置いた地点（地点タブの「地点を動かす」で必ず確認）: ${r.interpolated.map((id) => ed.p.map.nodes.find((n) => n.id === id)?.name || id).join('、') || 'なし'}${r.warnings.length ? ` ／ ${r.warnings.join(' / ')}` : ''}`;
  ed.refresh();
}

async function quickRun(ed: Ed): Promise<void> {
  const rt = ed.runtime();
  if (!rt) return;
  try {
    // sim は分岐点の一覧をシナリオのオブジェクトごとにキャッシュするので、編集中のものは写しを渡す
    const r = runHeadless(rt, structuredClone(ed.p.scenario), { policy: 'recommended' });
    ed.setLastRun(r);
    const lead = r.world.climbers[0]!;
    busy = `推奨方針で試走: ${r.ending.kind}（${lead.state}、${Math.round(r.world.tMin - (r.record?.samples[0]?.t ?? 0))} 分）`;
  } catch (e) {
    busy = `試走できませんでした: ${String(e)}`;
  }
  ed.refresh();
}

export const trailsPanel: Panel = {
  id: 'trails',
  label: '登山道',
  tool,
  key(ed, e) {
    if (e.key === 'Escape' && (edgeSel.ids.size > 0 || edgeSel.nodeIds.size > 0)) {
      clearEdgeSel();
      ed.refresh();
      return true;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    const ids = selectedEdgeIds(ed);
    const sel = ed.p.editorState.selection;
    // 地点を 1 つクリックで選んでいるときは、その地点（とつながる道）を消す
    const nodeIds = edgeSel.nodeIds.size > 0 ? [...edgeSel.nodeIds] : sel.kind === 'node' && sel.id ? [sel.id] : [];
    if (ids.length === 0 && nodeIds.length === 0) return false;
    const before = ed.p.map.edges.length;
    if (removeSelection(ed, ids, nodeIds)) ed.toast(`道を ${before - ed.p.map.edges.length} 本${nodeIds.length ? `・地点を ${nodeIds.length} か所` : ''}削除しました（Ctrl＋Z で戻せます）`);
    return true;
  },
  render(ed) {
    const geo = ed.p.map.geo;
    const drafts = ed.p.editorState.draftEdgeIds;
    const sel = ed.p.editorState.selection;
    const gpxIn = el('input', { type: 'file', accept: '.gpx,application/gpx+xml' });
    gpxIn.addEventListener('change', () => {
      const f = gpxIn.files?.[0];
      if (f) void importGpx(ed, f);
    });
    const osmBtn = button(ed.p.raw.osm ? 'OSM を変換し直す（再取得しない）' : 'OpenStreetMap から取り込む', async () => {
      if (!geo) return;
      const ld = showLoading('OpenStreetMap から登山道を取り込んでいます');
      try {
        let json = ed.p.raw.osm as OsmJson | undefined;
        if (!json) {
          // Overpass は全体の大きさを返さないので、待った時間と受け取った量を出す
          const t0 = performance.now();
          let bytes = 0;
          let retry = '';
          const tick = (): void => {
            const sec = Math.round((performance.now() - t0) / 1000);
            ld.step(bytes > 0 ? `データを受け取っています… ${(bytes / 1048576).toFixed(1)} MB（${sec} 秒）` : `Overpass API に、範囲の中の登山道・山頂・小屋などを問い合わせています…（${sec} 秒。混んでいると 1 分ほどかかります）${retry}`, null);
          };
          tick();
          const timer = setInterval(tick, 500);
          try {
            json = await fetchOsm(geo.centerLat, geo.centerLon, ed.p.map.size, undefined, {
              onBytes: (b) => {
                bytes = b;
                tick();
              },
              onRetry: (n) => {
                retry = `　サーバーが混み合っているので、少し待ってやり直しています（${n} 回目）`;
                tick();
              },
            });
          } finally {
            clearInterval(timer);
          }
          ed.p.raw.osm = json;
        }
        ld.step(`道と地点に変換しています…（OSM の要素 ${json.elements.length.toLocaleString('ja-JP')} 件。標高に沿わせ、範囲の端で切ります）`, 0.6);
        await nextPaint();
        busy = '';
        importOsm(ed, json);
        ld.step('取り込みました', 1);
        await nextPaint();
      } catch (e) {
        busy = String(e instanceof Error ? e.message : e);
        ed.refresh();
      } finally {
        ld.done();
      }
    }, 'primary');
    const e = sel.kind === 'edge' ? ed.p.map.edges.find((x) => x.id === sel.id) : undefined;
    const draftList = drafts.length > 0
      ? section(`下書きの道（${drafts.length} 本）`, [
          el('p', { class: 'note' }, '破線の道は下書きです。使う道を確定し、使わない道は除外してください。'),
          button('すべて確定', () => confirmDrafts(ed, [...drafts])),
          button('計画ルートから 1 km 以上離れた道を除外', () => removeEdges(ed, farFromRoute(ed))),
          button('下書きをすべて除外', () => removeEdges(ed, [...drafts])),
          e && drafts.includes(e.id) ? button(`${e.id} を確定`, () => confirmDrafts(ed, [e.id])) : null,
        ])
      : null;
    const modes = toolPalette<Mode>(ed, [
      { id: 'select', icon: 'arrowSelectorTool', label: '選択', key: 'v', hint: 'クリックで選ぶ。地点はドラッグで動かす。Shift＋ドラッグで範囲選択、Ctrl＋クリックで追加。Delete で削除' },
      { id: 'box', icon: 'selectBox', label: '範囲選択', key: 'm', hint: 'ドラッグで囲んだ道と地点を選ぶ。Delete で削除' },
      { id: 'draw', icon: 'draw', label: '手描き', key: 'p', hint: 'クリックで頂点、ダブルクリックで終了' },
      { id: 'split', icon: 'callSplit', label: '地点を挿入', key: 'n', hint: '道の上をクリックすると地点を足す。足した地点はそのままドラッグで動かせ、名前と種類は下で編集' },
      { id: 'route', icon: 'route', label: '計画ルートを引く', key: 'r', hint: '地点を順にクリック' },
    ], mode, (m) => {
      mode = m;
      drawing = [];
      ed.refresh();
    });
    const route = ed.p.scenario.plan.route;
    const selIds = selectedEdgeIds(ed);
    const selNodes = [...edgeSel.nodeIds];
    const selNode = sel.kind === 'node' ? ed.p.map.nodes.find((n) => n.id === sel.id) : undefined;
    const selSection = edgeSel.ids.size > 0 || selNodes.length > 0
      ? section(`選んだ道（${selIds.length} 本）${selNodes.length ? `・地点（${selNodes.length}）` : ''}`, [
          el('p', { class: 'note' }, 'Delete キーか下のボタンで削除。地点を消すと、その地点につながる道も消えます。Esc で選択を外す。Ctrl＋クリックで道を足す・外す。'),
          button(selNodes.length ? `選んだ道 ${selIds.length} 本と地点 ${selNodes.length} か所を削除` : `選んだ ${selIds.length} 本を削除`, () => removeSelection(ed, selIds, selNodes), 'danger'),
          drafts.some((id) => edgeSel.ids.has(id)) ? button('選んだ下書きを確定', () => confirmDrafts(ed, selIds.filter((id) => drafts.includes(id)))) : null,
          button('選択を外す', () => {
            clearEdgeSel();
            ed.refresh();
          }),
        ])
      : selNode
        ? section(`地点 ${selNode.name || selNode.id}`, [
            el('p', { class: 'note' }, `つながる道 ${ed.p.map.edges.filter((x) => x.from === selNode.id || x.to === selNode.id).length} 本。地図の上でドラッグすると動かせます。`),
            nodeInspector(ed, selNode),
          ])
        : null;
    fill(
      ed.inspector,
      el('h2', {}, '登山道'),
      modes,
      check('急傾斜（38° 超）を赤で表示', false, (v) => (ed as EditorApp).setShowSteep(v)),
      geo ? section('取り込み', [osmBtn, el('p', { class: 'note' }, '© OpenStreetMap contributors（ODbL）。応答は保存し、同じ範囲を再取得しません。'), el('hr'), select('GPX の用途', gpxUse, [['trail', '登山道として追加'], ['route', '計画ルートとして使う'], ['false', '偽の道（迷った軌跡）として追加']], (v) => (gpxUse = v)), gpxIn]) : null,
      ed.p.map.skeleton
        ? section('スケルトンマップの結合', [
            el('p', { class: 'note' }, ed.p.map.areaHint?.text ?? '座標を持たない骨組みのマップです。'),
            el('p', { class: 'note' }, '手順: ①タブ 1 で範囲を置いて標高を取得 → ②上の「OpenStreetMap から取り込む」（下書きは「すべて除外」でよい）→ ③シナリオを { } タブで読み込む（計画ルートの順に補間するため）→ ④結合。'),
            button('結合する（名前の候補＋補間）', () => joinSkeletonMap(ed), 'primary'),
          ])
        : null,
      busy ? el('p', { class: 'note' }, busy) : null,
      selSection,
      draftList,
      section('計画ルート', [
        routeList(ed),
        button('ルートを空にする', () => ed.change('ルート', () => (ed.p.scenario.plan.route = []))),
        button('最後の地点を取り消す', () => ed.change('ルート', () => (ed.p.scenario.plan.route = route.slice(0, -1)))),
        button('最後の地点を下山口に', () => ed.change('下山口', () => (ed.p.scenario.plan.goalNodes = route.length ? [route[route.length - 1]!] : []))),
        button('推奨方針で試走（下山口に着くか）', () => void quickRun(ed)),
      ]),
      section('分岐の紛らわしさ', [button('紛らわしい分岐を提案する', () => ed.change('紛らわしい分岐の提案', () => ed.toast(`${suggestConfusers(ed.p.map.nodes, ed.p.map.edges)} 件の候補を付けました（地点のインスペクタで編集）`), true))]),
      e ? edgeInspector(ed, e) : edgeSel.ids.size > 0 || selNodes.length > 0 || selNode ? null : el('p', { class: 'note' }, '道をクリックすると属性を編集できます（Delete キーで削除）。範囲選択（または Shift＋ドラッグ）で囲んだ道と地点をまとめて選べます。'),
    );
    ed.bottom.replaceChildren();
  },
};

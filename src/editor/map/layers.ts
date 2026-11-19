/**
 * 地図のレイヤー（docs/16 §2）: 陰影段彩と重ね表示、箱庭範囲、登山道、計画ルート、試走の軌跡、地点・危険箇所・基地局、雷雲の進路・確認地点。
 */
import { edgeSel } from './edgeSelection';
import { reliefCanvas } from '../../ui/map2d';
import { VegClass, type MapRuntime } from '../../sim/types';
import { asInt8, decodeGrid } from '../../sim/terrain/codec';
import { scenarioStartMin } from '../../sim/core/clock';
import type { Ed } from '../context';
import type { MapLayer, TileMapView } from './TileMapView';

/** 箱庭の範囲のピクセル矩形 */
export function areaRect(v: TileMapView, size: number): { x: number; y: number; w: number; h: number } {
  const a = v.xzToPx(-size / 2, -size / 2);
  const b = v.xzToPx(size / 2, size / 2);
  return { x: a.px, y: a.py, w: b.px - a.px, h: b.py - a.py };
}

export type OverlayKind = 'none' | 'veg' | 'radio' | 'slope' | 'tpi' | 'sky';

export const VEG_RGB: Record<number, [number, number, number]> = {
  [VegClass.BROADLEAF]: [120, 170, 80],
  [VegClass.CONIFER]: [40, 100, 60],
  [VegClass.KRUMMHOLZ]: [100, 130, 70],
  [VegClass.ALPINE]: [190, 190, 140],
  [VegClass.ROCK]: [150, 140, 130],
  [VegClass.STREAM]: [60, 120, 220],
  [VegClass.CLIFF]: [200, 60, 50],
};

const overlayCache = new WeakMap<MapRuntime, Map<string, HTMLCanvasElement>>();

export function overlayCanvas(map: MapRuntime, kind: OverlayKind): HTMLCanvasElement | null {
  if (kind === 'none') return null;
  let m = overlayCache.get(map);
  if (!m) overlayCache.set(map, (m = new Map()));
  const hit = m.get(kind);
  if (hit) return hit;
  const n = map.n;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i += 1) {
    let rgb: [number, number, number] = [0, 0, 0];
    let a = 150;
    if (kind === 'veg') rgb = VEG_RGB[map.veg[i]!] ?? [0, 0, 0];
    else if (kind === 'radio') {
      const r = map.radio[i]!;
      rgb = r >= 0.3 ? [60, 190, 90] : r >= 0.15 ? [230, 200, 60] : [210, 70, 60];
      a = 110;
    } else if (kind === 'slope') {
      const s = map.slopeDeg[i]!;
      if (s > 50) rgb = [200, 30, 30];
      else if (s > 38) rgb = [240, 120, 40];
      else if (s > 25) rgb = [240, 210, 60];
      else a = 0;
    } else if (kind === 'tpi') {
      const t = Math.max(-1, Math.min(1, map.tpi[i]! / 40));
      rgb = t > 0 ? [230, 120, 60] : [60, 120, 230];
      a = Math.abs(t) * 180;
    } else if (kind === 'sky') {
      const s = map.skyView[i]!;
      rgb = [255 * s, 255 * s, 255 * s];
      a = 140;
    }
    img.data.set([rgb[0], rgb[1], rgb[2], a], i * 4);
  }
  g.putImageData(img, 0, 0);
  m.set(kind, c);
  return c;
}

/** 塗り直し（vegetation.overrides / radio.paint）の確認用 */
function paintCanvas(ed: Ed, which: 'veg' | 'radio'): HTMLCanvasElement | null {
  const grid = which === 'veg' ? ed.p.map.vegetation.overrides : ed.p.map.radio.paint;
  if (!grid) return null;
  const n = ed.p.map.resolution;
  const d = decodeGrid(grid, n * n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i += 1) {
    if (!d[i]) continue;
    const rgb = which === 'veg' ? (VEG_RGB[d[i]! - 1] ?? [0, 0, 0]) : asInt8(d[i]!) > 0 ? [40, 220, 90] : [230, 40, 40];
    img.data.set([rgb[0]!, rgb[1]!, rgb[2]!, 200], i * 4);
  }
  g.putImageData(img, 0, 0);
  return c;
}

export interface LayerState {
  overlay: OverlayKind;
  paint: null | 'veg' | 'radio';
  showSteep: boolean;
}

export function createLayers(ed: Ed, state: LayerState): MapLayer[] {
  let paintCache: HTMLCanvasElement | null = null;
  let paintKey = '';
  const relief: MapLayer = {
    id: 'relief',
    visible: true,
    draw(g, v) {
      const m = ed.runtime();
      if (!m) return;
      const r = areaRect(v, m.def.size);
      g.globalAlpha = v.offline || v.base === 'none' ? 1 : 0.55;
      g.drawImage(reliefCanvas(m), r.x, r.y, r.w, r.h);
      g.globalAlpha = 1;
      g.imageSmoothingEnabled = false;
      const ov = overlayCanvas(m, state.overlay);
      if (ov) g.drawImage(ov, r.x, r.y, r.w, r.h);
      if (state.paint) {
        const grid = state.paint === 'veg' ? ed.p.map.vegetation.overrides : ed.p.map.radio.paint;
        const key = `${state.paint}:${grid?.data.length ?? 0}:${grid?.data.slice(-64) ?? ''}`;
        if (key !== paintKey) {
          paintCache = paintCanvas(ed, state.paint);
          paintKey = key;
        }
        if (paintCache) g.drawImage(paintCache, r.x, r.y, r.w, r.h);
      }
      g.imageSmoothingEnabled = true;
    },
  };
  const area: MapLayer = {
    id: 'area',
    visible: true,
    draw(g, v) {
      const r = areaRect(v, ed.p.map.size);
      g.strokeStyle = '#c0392b';
      g.lineWidth = 2;
      g.setLineDash([8, 4]);
      g.strokeRect(r.x, r.y, r.w, r.h);
      g.setLineDash([]);
      g.fillStyle = 'rgba(192,57,43,0.95)';
      g.font = '12px system-ui';
      g.fillText(`箱庭 ${(ed.p.map.size / 1000).toFixed(2)} km 四方・${ed.p.map.resolution} 頂点`, r.x + 4, r.y - 6);
    },
  };
  const trails: MapLayer = {
    id: 'trails',
    visible: true,
    draw(g, v) {
      const m = ed.runtime();
      const draft = new Set(ed.p.editorState.draftEdgeIds);
      const sel = ed.p.editorState.selection;
      const node = (id: string | undefined): { x: number; z: number } | undefined => ed.p.map.nodes.find((n) => n.id === id);
      for (const e of ed.p.map.edges) {
        const samples = m?.trails[e.id]?.samples;
        const raw = [node(e.from), ...e.waypoints.map((w) => ({ x: w[0], z: w[1] })), node(e.to)].filter((p): p is { x: number; z: number } => Boolean(p));
        const pts = samples ? samples.map((s) => ({ x: s.x, z: s.z })) : raw;
        const selected = (sel.kind === 'edge' && sel.id === e.id) || edgeSel.ids.has(e.id);
        g.strokeStyle = selected ? '#ffcc00' : e.kind === 'false' ? '#8a5a2b' : e.class === 'T3' ? '#c0392b' : e.class === 'T2' ? '#d35400' : '#7b3f00';
        g.lineWidth = selected ? 5 : e.kind === 'false' ? 2 : 3;
        g.setLineDash(draft.has(e.id) ? [6, 5] : e.kind === 'false' ? [3, 3] : []);
        g.beginPath();
        pts.forEach((q, i) => {
          const p = v.xzToPx(q.x, q.z);
          if (i === 0) g.moveTo(p.px, p.py);
          else g.lineTo(p.px, p.py);
        });
        g.stroke();
        // 急傾斜（38° 超、偽の道は 50° 超）を赤で
        if (samples && (selected || state.showSteep)) {
          const lim = e.kind === 'false' ? 50 : 38;
          g.strokeStyle = '#ff0000';
          g.lineWidth = 4;
          g.setLineDash([]);
          for (let i = 1; i < samples.length; i += 1) {
            const a = samples[i - 1]!;
            const b = samples[i]!;
            const h = b.s - a.s;
            if (h > 0 && (Math.atan(Math.abs(b.elevM - a.elevM) / h) * 180) / Math.PI > lim) {
              const pa = v.xzToPx(a.x, a.z);
              const pb = v.xzToPx(b.x, b.z);
              g.beginPath();
              g.moveTo(pa.px, pa.py);
              g.lineTo(pb.px, pb.py);
              g.stroke();
            }
          }
        }
      }
      g.setLineDash([]);
    },
  };
  const route: MapLayer = {
    id: 'route',
    visible: true,
    draw(g, v) {
      const r = ed.p.scenario.plan.route;
      const at = (id: string): { px: number; py: number } | null => {
        const n = ed.p.map.nodes.find((x) => x.id === id);
        return n ? v.xzToPx(n.x, n.z) : null;
      };
      g.strokeStyle = 'rgba(37,99,235,0.85)';
      g.lineWidth = 2;
      g.setLineDash([2, 4]);
      g.beginPath();
      r.forEach((id, i) => {
        const p = at(id);
        if (!p) return;
        if (i === 0) g.moveTo(p.px, p.py);
        else g.lineTo(p.px, p.py);
      });
      g.stroke();
      g.setLineDash([]);
      g.font = 'bold 11px system-ui';
      g.fillStyle = '#1d4ed8';
      r.forEach((id, i) => {
        const p = at(id);
        if (p) g.fillText(String(i + 1), p.px - 3, p.py + 18);
      });
    },
  };
  const track: MapLayer = {
    id: 'track',
    visible: true,
    draw(g, v) {
      const rec = ed.lastRun?.record;
      if (!rec || rec.samples.length === 0) return;
      const lead = rec.samples[0]!.climbers[0]?.id;
      g.lineWidth = 3;
      for (let i = 1; i < rec.track.length; i += 1) {
        const sm = rec.samples[Math.min(rec.samples.length - 1, Math.floor((i / rec.track.length) * rec.samples.length))];
        const c = sm?.climbers.find((x) => x.id === lead)?.coreC ?? 37;
        g.strokeStyle = c >= 36 ? '#2563eb' : c >= 35 ? '#eab308' : c >= 32 ? '#f97316' : '#7f1d1d';
        const a = v.xzToPx(rec.track[i - 1]![0], rec.track[i - 1]![1]);
        const b = v.xzToPx(rec.track[i]![0], rec.track[i]![1]);
        g.beginPath();
        g.moveTo(a.px, a.py);
        g.lineTo(b.px, b.py);
        g.stroke();
      }
      // カーソル時刻の位置
      if (ed.cursorMin > scenarioStartMin(ed.p.scenario)) {
        const s = rec.samples.reduce((a, b) => (Math.abs(b.t - ed.cursorMin) < Math.abs(a.t - ed.cursorMin) ? b : a));
        for (const c of s.climbers) {
          const p = v.xzToPx(c.x, c.z);
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(p.px, p.py, 6, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = ed.p.scenario.party.find((x) => x.id === c.id)?.color ?? '#000';
          g.beginPath();
          g.arc(p.px, p.py, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  };
  const nodes: MapLayer = {
    id: 'nodes',
    visible: true,
    draw(g, v) {
      const sel = ed.p.editorState.selection;
      g.font = '12px system-ui';
      for (const h of ed.p.map.hazards) {
        if (!('x' in h)) continue;
        const p = v.xzToPx(h.x, h.z);
        g.strokeStyle = h.type === 'waterfall' ? '#2563eb' : '#7c3aed';
        g.lineWidth = sel.kind !== null && sel.id === h.id ? 3 : 1.5;
        g.beginPath();
        g.arc(p.px, p.py, Math.max(4, h.radius * v.pxPerM()), 0, Math.PI * 2);
        g.stroke();
      }
      for (const st of ed.p.map.radio.stations) {
        const p = v.xzToPx(st.x, st.z);
        g.fillStyle = '#0369a1';
        g.beginPath();
        g.moveTo(p.px, p.py - 9);
        g.lineTo(p.px + 5, p.py + 5);
        g.lineTo(p.px - 5, p.py + 5);
        g.closePath();
        g.fill();
        g.fillText(`基地局 ${st.id}`, p.px + 7, p.py + 4);
      }
      for (const n of ed.p.map.nodes) {
        const p = v.xzToPx(n.x, n.z);
        const selected = sel.kind === 'node' && sel.id === n.id;
        g.fillStyle = n.type === 'hut' || n.type === 'shelter' ? '#7c2d12' : n.type === 'peak' ? '#111' : n.type === 'trailhead' ? '#15803d' : n.type === 'boundary' ? '#94a3b8' : '#555';
        g.strokeStyle = selected ? '#ffcc00' : '#fff';
        g.lineWidth = selected ? 3 : 1.5;
        g.beginPath();
        if (n.type === 'peak') {
          g.moveTo(p.px, p.py - 7);
          g.lineTo(p.px + 6, p.py + 5);
          g.lineTo(p.px - 6, p.py + 5);
          g.closePath();
        } else g.rect(p.px - 5, p.py - 5, 10, 10);
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.9)';
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 3;
        g.strokeText(n.name, p.px + 8, p.py - 6);
        g.fillText(n.name, p.px + 8, p.py - 6);
      }
    },
  };
  const cells: MapLayer = {
    id: 'cells',
    visible: true,
    draw(g, v) {
      g.font = '12px system-ui';
      for (const c of ed.p.scenario.weather.thunderCells ?? []) {
        g.strokeStyle = '#9333ea';
        g.lineWidth = 2;
        g.beginPath();
        c.path.forEach((q, i) => {
          const p = v.xzToPx(q[0], q[1]);
          if (i === 0) g.moveTo(p.px, p.py);
          else g.lineTo(p.px, p.py);
        });
        g.stroke();
        const s = c.path[0];
        if (s) {
          const p = v.xzToPx(s[0], s[1]);
          g.setLineDash([4, 4]);
          g.beginPath();
          g.arc(p.px, p.py, c.radiusM * v.pxPerM(), 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = '#9333ea';
          g.fillText(`雷雲 ${c.id}`, p.px + 6, p.py - 6);
        }
      }
      for (const q of ed.p.editorState.probePoints) {
        const p = v.xzToPx(q.x, q.z);
        g.fillStyle = '#0f766e';
        g.beginPath();
        g.arc(p.px, p.py, 5, 0, Math.PI * 2);
        g.fill();
        g.fillText(`◎${q.label}`, p.px + 7, p.py + 4);
      }
    },
  };
  // 道を囲んで選ぶ矩形（ドラッグ中）
  const selBox: MapLayer = {
    id: 'selBox',
    visible: true,
    draw(g, v) {
      const b = edgeSel.box;
      if (!b) return;
      const a = v.xzToPx(Math.min(b.x0, b.x1), Math.min(b.z0, b.z1));
      const c = v.xzToPx(Math.max(b.x0, b.x1), Math.max(b.z0, b.z1));
      g.setLineDash([6, 4]);
      g.strokeStyle = '#ffcc00';
      g.lineWidth = 2;
      g.fillStyle = 'rgba(255, 204, 0, 0.12)';
      g.fillRect(a.px, a.py, c.px - a.px, c.py - a.py);
      g.strokeRect(a.px, a.py, c.px - a.px, c.py - a.py);
      g.setLineDash([]);
    },
  };
  return [relief, area, trails, route, track, nodes, cells, selBox];
}

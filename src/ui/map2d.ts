/**
 * 2D 地図（Canvas2D）: 陰影段彩＋等高線（100 m）を 1 回描いてキャッシュし、その上に登山道・計画ルート・軌跡・地点を重ねる。
 * ブリーフィング・振り返り・エディターの試走結果で使う（docs/12 §2）。
 */
import { resolveRoute } from '../sim/terrain/trails';
import type { MapRuntime, NodeId } from '../sim/types';

const reliefCache = new WeakMap<MapRuntime, HTMLCanvasElement>();
const SIZE = 512;

function hypsometric(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [86, 120, 70]],
    [0.35, [126, 150, 90]],
    [0.6, [180, 170, 120]],
    [0.8, [170, 150, 130]],
    [1, [235, 235, 235]],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    const [b, cb] = stops[i]!;
    const [a, ca] = stops[i - 1]!;
    if (t <= b) {
      const f = (t - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return stops[stops.length - 1]![1];
}

export function reliefCanvas(map: MapRuntime): HTMLCanvasElement {
  const hit = reliefCache.get(map);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  const img = g.createImageData(SIZE, SIZE);
  const n = map.n;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of map.heights) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const at = (u: number, v: number): number => {
    const x = Math.min(n - 1, Math.floor((u / SIZE) * n));
    const z = Math.min(n - 1, Math.floor((v / SIZE) * n));
    return map.heights[z * n + x]!;
  };
  for (let v = 0; v < SIZE; v += 1) {
    for (let u = 0; u < SIZE; u += 1) {
      const h = at(u, v);
      const dx = at(Math.min(SIZE - 1, u + 1), v) - at(Math.max(0, u - 1), v);
      const dz = at(u, Math.min(SIZE - 1, v + 1)) - at(u, Math.max(0, v - 1));
      const shade = Math.max(0.45, Math.min(1.25, 1 - (dx - dz) * 0.012));
      const [r, gg, b] = hypsometric((h - lo) / (hi - lo || 1));
      const contour = Math.floor(h / 100) !== Math.floor(at(Math.min(SIZE - 1, u + 1), v) / 100) || Math.floor(h / 100) !== Math.floor(at(u, Math.min(SIZE - 1, v + 1)) / 100);
      const k = (v * SIZE + u) * 4;
      const f = contour ? 0.7 : shade;
      img.data[k] = r * f;
      img.data[k + 1] = gg * f;
      img.data[k + 2] = b * f;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  reliefCache.set(map, c);
  return c;
}

export interface Map2dLayers {
  route?: NodeId[];
  track?: [number, number][];
  /** 軌跡の色（体温などで塗る）。track と同じ長さ */
  trackColors?: string[];
  markers?: { x: number; z: number; label: string; color?: string; shape?: 'diamond' | 'dot' | 'triangle' }[];
  showFalse?: boolean;
}

export function drawMap2d(canvas: HTMLCanvasElement, map: MapRuntime, layers: Map2dLayers = {}): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  g.drawImage(reliefCanvas(map), 0, 0, W, H);
  const toPx = (x: number, z: number): [number, number] => [((x + map.half) / map.def.size) * W, ((z + map.half) / map.def.size) * H];
  // 登山道
  for (const t of Object.values(map.trails)) {
    if (t.def.kind === 'false' && !layers.showFalse) continue;
    g.strokeStyle = t.def.kind === 'false' ? 'rgba(150,90,40,0.6)' : 'rgba(60,40,20,0.85)';
    g.lineWidth = t.def.kind === 'false' ? 1 : 1.6;
    g.setLineDash(t.def.kind === 'false' ? [3, 3] : []);
    g.beginPath();
    t.samples.forEach((s, i) => {
      const [px, pz] = toPx(s.x, s.z);
      if (i === 0) g.moveTo(px, pz);
      else g.lineTo(px, pz);
    });
    g.stroke();
  }
  g.setLineDash([]);
  // 計画ルート
  if (layers.route) {
    try {
      g.strokeStyle = 'rgba(200,40,40,0.9)';
      g.lineWidth = 3;
      g.setLineDash([6, 4]);
      g.beginPath();
      let first = true;
      for (const leg of resolveRoute(map, layers.route)) {
        const s = map.trails[leg.edgeId]!.samples;
        const list = leg.dir === 1 ? s : [...s].reverse();
        for (const p of list) {
          const [px, pz] = toPx(p.x, p.z);
          if (first) g.moveTo(px, pz);
          else g.lineTo(px, pz);
          first = false;
        }
      }
      g.stroke();
      g.setLineDash([]);
    } catch {
      // ルートが解決できなければ描かない
    }
  }
  // 実際の軌跡
  if (layers.track && layers.track.length > 1) {
    g.lineWidth = 3;
    for (let i = 1; i < layers.track.length; i += 1) {
      const [ax, az] = toPx(...layers.track[i - 1]!);
      const [bx, bz] = toPx(...layers.track[i]!);
      g.strokeStyle = layers.trackColors?.[i] ?? '#1d4ed8';
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.stroke();
    }
  }
  // 地点
  g.font = '12px system-ui, sans-serif';
  for (const nd of Object.values(map.nodes)) {
    const [px, pz] = toPx(nd.x, nd.z);
    g.fillStyle = nd.shelter ? '#7c2f24' : '#222';
    g.fillRect(px - 3, pz - 3, 6, 6);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillText(nd.name, px + 5, pz - 4);
  }
  for (const m of layers.markers ?? []) {
    const [px, pz] = toPx(m.x, m.z);
    g.fillStyle = m.color ?? '#b91c1c';
    g.beginPath();
    if (m.shape === 'dot') g.arc(px, pz, 4, 0, Math.PI * 2);
    else if (m.shape === 'triangle') {
      g.moveTo(px, pz - 6);
      g.lineTo(px + 5, pz + 4);
      g.lineTo(px - 5, pz + 4);
    } else {
      g.moveTo(px, pz - 6);
      g.lineTo(px + 6, pz);
      g.lineTo(px, pz + 6);
      g.lineTo(px - 6, pz);
    }
    g.fill();
  }
}

/**
 * 地面の塗り分けの地図（docs/19 フェーズ 4）。登山道と沢の位置を 1 枚の画像に描く。
 *   R = 登山道（踏み固めた土）、G = 沢（水と岸）
 * 地形のシェーダー（塗り分け）と、地形メッシュ・高さの読み出し（道と沢を掘り下げる）の両方が同じ地図を使う。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';

export interface GroundMasks {
  texture: THREE.CanvasTexture;
  /** 登山道の度合い（0..1）。x・z はメートル */
  trail(x: number, z: number): number;
  /** 沢の度合い（0..1） */
  stream(x: number, z: number): number;
}

/** 登山道の幅（m）: 芯と、ぼかした縁 */
const TRAIL_CORE_M = 9;
const TRAIL_SOFT_M = 17;

/** 沢の水面の幅（m）。集水面積（m²）から。源流は 1.5 m ほど、大きな沢で 8 m ほど */
export function streamWidthM(areaM2: number): number {
  const km2 = areaM2 / 1e6;
  return Math.min(STREAM_MAX_W_M, STREAM_MIN_W_M + STREAM_W_K * Math.sqrt(km2));
}
const STREAM_MIN_W_M = 0.8;
const STREAM_MAX_W_M = 7;
const STREAM_W_K = 2.0;

/** 各セルの流れ下る先（いちばん低い隣。なければ -1）と、そこへ集まるセルの数（自分を含む） */
export function flowAccumulation(map: MapRuntime): { down: Int32Array; acc: Float32Array } {
  const n = map.n;
  const h = map.heights;
  const down = new Int32Array(n * n).fill(-1);
  for (let z = 0; z < n; z += 1)
    for (let x = 0; x < n; x += 1) {
      const i = z * n + x;
      let best = h[i]!;
      let bj = -1;
      for (let dz = -1; dz <= 1; dz += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dz) continue;
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const j = zz * n + xx;
          // 斜めは距離が長いので、同じ高さの差なら縦横を選ぶ
          const v = h[j]! + (dx && dz ? 0.001 : 0);
          if (v < best) {
            best = v;
            bj = j;
          }
        }
      down[i] = bj;
    }
  const order = Array.from({ length: n * n }, (_, i) => i).sort((a, b) => h[b]! - h[a]!);
  const acc = new Float32Array(n * n).fill(1);
  for (const i of order) {
    const j = down[i]!;
    if (j >= 0) acc[j]! += acc[i]!;
  }
  return { down, acc };
}

export function buildGroundMasks(map: MapRuntime): GroundMasks {
  const size = map.def.size;
  const S = size > 8000 ? 2048 : 1024;
  const pxPerM = S / size;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const px = (m: number): number => (m + map.half) * pxPerM;

  // 沢: 植生クラス STREAM のセルを、流れ下る隣のセルへ線でつなぐ。幅は集水面積で決め、源流（山頂に近い所）ほど細く、下流ほど太くする
  const cellPx = map.cell * pxPerM;
  const { down, acc } = flowAccumulation(map);
  const n = map.n;
  const segs: { x0: number; y0: number; x1: number; y1: number; wPx: number }[] = [];
  for (let i = 0; i < n * n; i += 1) {
    if (map.veg[i] !== VegClass.STREAM) continue;
    const j = down[i]!;
    const wM = streamWidthM(acc[i]! * map.cell * map.cell);
    const x0 = (i % n) * cellPx;
    const y0 = Math.floor(i / n) * cellPx;
    // 流れ下る先がなければ（窪地・縁）点だけ
    const x1 = j >= 0 ? (j % n) * cellPx : x0;
    const y1 = j >= 0 ? Math.floor(j / n) * cellPx : y0;
    segs.push({ x0, y0, x1, y1, wPx: wM * pxPerM });
  }
  // 外側のぼかし 2 回と芯 1 回
  for (const [scale, minPx, color] of [[2.4, 1.6, 'rgb(0,40,0)'], [1.6, 1.2, 'rgb(0,48,0)'], [1, 0.8, 'rgb(0,125,0)']] as const) {
    g.strokeStyle = color;
    for (const sg of segs) {
      g.lineWidth = Math.max(minPx, sg.wPx * scale);
      g.beginPath();
      g.moveTo(sg.x0, sg.y0);
      g.lineTo(sg.x1 + (sg.x1 === sg.x0 && sg.y1 === sg.y0 ? 0.01 : 0), sg.y1);
      g.stroke();
    }
  }
  // 登山道: 幅を変えて重ね描きし、縁をぼかす（偽の道は描かない）
  const steps = 6;
  for (let k = 0; k < steps; k += 1) {
    const w = TRAIL_SOFT_M + (TRAIL_CORE_M - TRAIL_SOFT_M) * (k / (steps - 1));
    g.strokeStyle = `rgb(${k === steps - 1 ? 90 : 33},0,0)`;
    g.lineWidth = Math.max(1.5, w * pxPerM);
    for (const t of Object.values(map.trails)) {
      if (t.def.kind === 'false') continue;
      g.beginPath();
      t.samples.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), px(p.z)) : g.lineTo(px(p.x), px(p.z))));
      g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
  const data = g.getImageData(0, 0, S, S).data;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false; // 画像の y をそのまま z（南）に対応させる
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  const sample = (x: number, z: number, ch: number): number => {
    const fx = Math.min(S - 1.001, Math.max(0, px(x) - 0.5));
    const fz = Math.min(S - 1.001, Math.max(0, px(z) - 0.5));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (xx: number, zz: number): number => data[(zz * S + xx) * 4 + ch]! / 255;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
  };
  return {
    texture,
    trail: (x, z) => sample(x, z, 0),
    stream: (x, z) => sample(x, z, 1),
  };
}

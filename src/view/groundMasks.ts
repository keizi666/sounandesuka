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

  // 沢: 植生クラス STREAM のセルを、丸で重ねて描く（縁はぼかす）
  const cellPx = map.cell * pxPerM;
  for (let pass = 0; pass < 4; pass += 1) {
    const rad = cellPx * (1.5 - pass * 0.28);
    g.fillStyle = `rgb(0,${pass === 3 ? 110 : 48},0)`;
    for (let i = 0; i < map.n * map.n; i += 1) {
      if (map.veg[i] !== VegClass.STREAM) continue;
      const x = (i % map.n) * cellPx;
      const y = Math.floor(i / map.n) * cellPx;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
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

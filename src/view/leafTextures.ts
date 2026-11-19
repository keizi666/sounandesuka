/**
 * 植生のテクスチャ（コードで描く。docs/19 §7）。1 枚のアトラス（2×2）に、
 *   [0] 広葉樹の葉の塊、[1] 針葉樹の枝、[2] 無地（幹・岩用）、[3] 草・笹の株
 * を描く。色は明るさだけを持ち（白〜灰）、樹種の色は頂点色で掛ける。アルファは輪郭（ぎざぎざ）。
 */
import * as THREE from 'three';

export const ATLAS = { leaf: 0, needle: 1, solid: 2, grass: 3 } as const;
export type AtlasCell = (typeof ATLAS)[keyof typeof ATLAS];

const CELL = 256;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** アトラスのセル内の uv（u, v は 0..1。にじみを避けて少し内側に寄せる） */
export function atlasUv(cell: AtlasCell, u: number, v: number): [number, number] {
  const cx = cell % 2;
  const cy = Math.floor(cell / 2);
  const pad = 0.02;
  return [(cx + pad + u * (1 - 2 * pad)) / 2, 1 - (cy + pad + (1 - v) * (1 - 2 * pad)) / 2];
}

function grey(v: number): string {
  const c = Math.round(Math.min(255, Math.max(0, v)));
  return `rgb(${c},${c},${c})`;
}

/** 葉の塊: 小さな葉を重ねる。縁はぎざぎざ、内部に明暗の斑。下側は暗い */
function drawLeafClump(g: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = rng(11);
  const cx = ox + CELL / 2;
  const cy = oy + CELL / 2;
  const leaves: { x: number; y: number; a: number; s: number; v: number }[] = [];
  for (let i = 0; i < 230; i += 1) {
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 104;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad * 0.92;
    const up = 1 - (y - oy) / CELL; // 上ほど明るい
    leaves.push({ x, y, a: r() * Math.PI, s: 13 + r() * 13, v: 120 + up * 95 + (r() - 0.5) * 70 });
  }
  // 暗い葉を先に、明るい葉を後に重ねる
  leaves.sort((a, b) => a.v - b.v);
  for (const l of leaves) {
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.a);
    g.fillStyle = grey(l.v);
    g.beginPath();
    g.moveTo(-l.s, 0);
    g.quadraticCurveTo(0, -l.s * 0.62, l.s, 0);
    g.quadraticCurveTo(0, l.s * 0.62, -l.s, 0);
    g.fill();
    g.strokeStyle = grey(l.v - 38);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-l.s * 0.9, 0);
    g.lineTo(l.s * 0.9, 0);
    g.stroke();
    g.restore();
  }
}

/** 針葉樹の枝: 上辺の中央が付け根で、下へ垂れて広がり、先が尖る。小枝から針葉が出る */
function drawNeedleBough(g: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = rng(23);
  const top = oy + 8;
  const len = CELL - 20;
  g.lineCap = 'round';
  const spray = (x0: number, y0: number, ang: number, l: number, v: number): void => {
    const x1 = x0 + Math.sin(ang) * l;
    const y1 = y0 + Math.cos(ang) * l;
    g.strokeStyle = grey(v - 50);
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    const n = Math.floor(l / 4);
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (const sgn of [-1, 1]) {
        const na = ang + sgn * (0.75 + r() * 0.35);
        const nl = (9 + r() * 7) * (1 - t * 0.45);
        g.strokeStyle = grey(v + (r() - 0.5) * 60);
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.sin(na) * nl, py + Math.cos(na) * nl);
        g.stroke();
      }
    }
  };
  // 中心の軸と、左右へ出る小枝（下ほど短い）
  const cx = ox + CELL / 2;
  spray(cx, top, 0, len, 150);
  for (let i = 0; i < 9; i += 1) {
    const t = 0.04 + (i / 9) * 0.8;
    const y = top + len * t;
    const l = (92 - 70 * t) * (0.85 + r() * 0.3);
    const v = 215 - t * 70;
    spray(cx, y, 0.95 + r() * 0.25, l, v);
    spray(cx, y, -(0.95 + r() * 0.25), l, v);
  }
}

/** 草・笹の株: 下辺の中央から葉が扇形に出る */
function drawGrass(g: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = rng(37);
  const bx = ox + CELL / 2;
  const by = oy + CELL - 6;
  for (let i = 0; i < 46; i += 1) {
    const a = (r() - 0.5) * 1.9;
    const l = 120 + r() * 120;
    const w = 7 + r() * 9;
    const tx = bx + Math.sin(a) * l;
    const ty = by - Math.cos(a) * l;
    const mx = bx + Math.sin(a * 0.6) * l * 0.5 + (r() - 0.5) * 30;
    const my = by - l * 0.55;
    g.fillStyle = grey(130 + r() * 115);
    g.beginPath();
    g.moveTo(bx - w + (r() - 0.5) * 40, by);
    g.quadraticCurveTo(mx - w * 0.5, my, tx, ty);
    g.quadraticCurveTo(mx + w * 0.5, my, bx + w + (r() - 0.5) * 40, by);
    g.fill();
  }
}

let cached: THREE.CanvasTexture | null = null;

export function vegetationAtlas(): THREE.CanvasTexture {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = CELL * 2;
  c.height = CELL * 2;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  drawLeafClump(g, 0, 0);
  drawNeedleBough(g, CELL, 0);
  g.fillStyle = '#ffffff';
  g.fillRect(0, CELL, CELL, CELL);
  drawGrass(g, CELL, CELL);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cached = t;
  return t;
}

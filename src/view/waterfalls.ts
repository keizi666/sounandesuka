/**
 * 滝（ユーザーの指定: 沢で傾斜のきつい所に滝を作る）。見た目だけ（シミュレーションの滝の危険はシナリオの hazards と崖で表す）。
 * 沢のセルが流れ下る先との間で、傾斜が WATERFALL_DEG を超える所と、シナリオの hazards の滝に、
 * 白く流れ落ちる水の幕（斜面に沿った帯。模様が上から下へ流れる）と、滝つぼの泡を置く。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';
import { flowAccumulation, streamWidthM } from './groundMasks';
import { UNIT, type ViewScale } from './scale';
import type { EnvUniforms } from './terrainMaterial';

/** これより急な沢の段差を滝にする（度） */
const WATERFALL_DEG = 33;
/** 滝どうしの間隔の最小（m）と、置く数の上限 */
const MIN_SPACING_M = 80;
const MAX_FALLS = 80;
/** 見た目の幅（m）: 沢の幅の倍率と最小 */
const WIDTH_F = 1.6;
const MIN_WIDTH_M = 5;

const fallVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fallFrag = /* glsl */ `
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // 縦の筋が下へ流れる（v は上が 0、下が 1）
  float s = n(vec2(vUv.x * 14.0, vUv.y * 3.0 - uTime * 2.2)) * 0.65 + n(vec2(vUv.x * 31.0, vUv.y * 6.0 - uTime * 3.4)) * 0.35;
  vec3 col = mix(vec3(0.62, 0.78, 0.84), vec3(0.97, 0.99, 1.0), smoothstep(0.35, 0.75, s));
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
  float a = edge * (0.55 + 0.4 * s) * smoothstep(0.0, 0.08, vUv.y);
  col *= 1.0 - 0.75 * uNight;
  gl_FragColor = vec4(col, a);
}`;
const foamFrag = /* glsl */ `
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float swirl = n(vec2(atan(p.y, p.x) * 3.0, r * 6.0 - uTime * 1.5));
  float a = (1.0 - smoothstep(0.55, 1.0, r)) * (0.45 + 0.5 * swirl);
  vec3 col = vec3(0.95, 0.98, 1.0) * (1.0 - 0.75 * uNight);
  gl_FragColor = vec4(col, a * 0.85);
}`;

interface Fall {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  widthM: number;
  steep: number;
}

/** 滝を置く場所（上の点・下の点・幅） */
export function findWaterfalls(map: MapRuntime): Fall[] {
  const n = map.n;
  const { down, acc } = flowAccumulation(map);
  const cand: Fall[] = [];
  const vx = (i: number): number => -map.half + (i % n) * map.cell;
  const vz = (i: number): number => -map.half + Math.floor(i / n) * map.cell;
  for (let i = 0; i < n * n; i += 1) {
    if (map.veg[i] !== VegClass.STREAM) continue;
    const j = down[i]!;
    if (j < 0) continue;
    const drop = map.heights[i]! - map.heights[j]!;
    const hd = Math.hypot(vx(i) - vx(j), vz(i) - vz(j));
    const deg = (Math.atan2(drop, hd) * 180) / Math.PI;
    if (deg < WATERFALL_DEG) continue;
    cand.push({ x0: vx(i), z0: vz(i), x1: vx(j), z1: vz(j), widthM: Math.max(MIN_WIDTH_M, streamWidthM(acc[i]! * map.cell * map.cell) * WIDTH_F), steep: deg });
  }
  // シナリオで決めた滝（hazards）も
  for (const hz of map.def.hazards) {
    if (hz.type !== 'waterfall') continue;
    const i = Math.min(n - 1, Math.max(0, Math.round((hz.z + map.half) / map.cell))) * n + Math.min(n - 1, Math.max(0, Math.round((hz.x + map.half) / map.cell)));
    const j = down[i]! >= 0 ? down[i]! : i;
    cand.push({ x0: vx(i), z0: vz(i), x1: vx(j), z1: vz(j), widthM: Math.max(MIN_WIDTH_M * 1.4, hz.radius * 0.25), steep: 90 });
  }
  cand.sort((a, b) => b.steep - a.steep);
  const out: Fall[] = [];
  for (const c of cand) {
    if (out.length >= MAX_FALLS) break;
    if (out.some((o) => Math.hypot(o.x0 - c.x0, o.z0 - c.z0) < MIN_SPACING_M)) continue;
    out.push(c);
  }
  return out;
}

export function buildWaterfalls(map: MapRuntime, _s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms): THREE.Group {
  const group = new THREE.Group();
  const falls = findWaterfalls(map);
  if (falls.length === 0) return group;
  const uniforms = { uTime: env.uTime, uNight: env.uNight };
  const fallMat = new THREE.ShaderMaterial({ uniforms, vertexShader: fallVert, fragmentShader: fallFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const foamMat = new THREE.ShaderMaterial({ uniforms, vertexShader: fallVert, fragmentShader: foamFrag, transparent: true, depthWrite: false });
  const SEG = 8;
  const lift = 0.6 * UNIT;
  for (const f of falls) {
    // 上の点から下の点へ、地面に沿った帯（少し浮かせる）。上流側を少し延ばして、落ち口を見せる
    const dx = f.x1 - f.x0;
    const dz = f.z1 - f.z0;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const half = (f.widthM / 2) * UNIT;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= SEG; k += 1) {
      const t = k / SEG;
      const xm = f.x0 - ux * len * 0.15 + dx * 1.15 * t;
      const zm = f.z0 - uz * len * 0.15 + dz * 1.15 * t;
      const sx = xm * UNIT;
      const sz = zm * UNIT;
      for (const side of [-1, 1]) {
        const x = sx + px * half * side;
        const z = sz + pz * half * side;
        pos.push(x, heightAt(x, z) + lift, z);
        uv.push(side < 0 ? 0 : 1, t);
      }
      if (k > 0) {
        const a = (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, fallMat);
    m.renderOrder = 2;
    group.add(m);
    // 滝つぼの泡
    const r = f.widthM * 0.9 * UNIT;
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), foamMat);
    foam.rotation.x = -Math.PI / 2;
    const bx = (f.x1 + ux * 2) * UNIT;
    const bz = (f.z1 + uz * 2) * UNIT;
    foam.position.set(bx, heightAt(bx, bz) + lift * 1.5, bz);
    foam.renderOrder = 2;
    group.add(foam);
  }
  return group;
}

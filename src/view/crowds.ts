/**
 * 列をなして歩くほかの登山者（見た目だけ。ユーザーの指定: 夏の富士山は、ご来光を見る人が列をなして登っていく）。
 * シナリオの crowds（CrowdDef）ごとに、毎日 start〜end に from を出発し、登山道をたどって to へ向かう人を描く。
 * 位置は時刻だけで決める（乱数は番号のハッシュ。sim の状態にも乱数にも触れない）。終わりに近いほど遅くなる（jam。山頂手前の渋滞）ので、
 * 列が詰まって見える。夜はヘッドランプの光の点を頭に付け、光の列になる。
 * 人形は小さな簡単な形（胴・頭・脚・ザック）を InstancedMesh で描く。主役の人形と見分けやすいよう、小さく、影を落とさない。
 */
import * as THREE from 'three';
import { parseHHMM } from '../sim/core/clock';
import type { CrowdDef, MapRuntime, NodeId, ScenarioDef } from '../sim/types';
import { UNIT } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

/** 一度に描く人数の上限 */
const MAX = 600;
/** 主役の人形に対する大きさ */
const SIZE_F = 0.4;
/** 道の中心からの左右のずれ（主役の人形の高さに対する割合） */
const LANE_F = 0.12;
const DAY = 1440;
/** 上着の色（くすませた登山の服の色） */
const JACKETS = [0xc0392b, 0x2e6da4, 0xe08e2b, 0x3f8f4e, 0x8e44ad, 0xd35d8c, 0x2c3e50, 0xd4b93c, 0x5d6d7e, 0x16a085];

interface Route {
  def: CrowdDef;
  xs: Float32Array;
  zs: Float32Array;
  /** その点に着くまでの時間（分） */
  tm: Float32Array;
  totalMin: number;
  startMin: number;
  /** 出発の時間帯の長さ（分） */
  spanMin: number;
  gapMin: number;
  key: number;
}

/** 0..1 のハッシュ（整数 2 つから） */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** from から to への登山道の道すじ（地点の列。見つからなければ null）。偽の道は通らない */
function findPath(map: MapRuntime, from: NodeId, to: NodeId): { edge: string; forward: boolean }[] | null {
  const prev = new Map<NodeId, { node: NodeId; edge: string; forward: boolean }>();
  const q: NodeId[] = [from];
  const seen = new Set<NodeId>([from]);
  while (q.length > 0) {
    const n = q.shift()!;
    if (n === to) break;
    for (const id of map.adjacency[n] ?? []) {
      const t = map.trails[id];
      if (!t || t.def.kind === 'false' || t.def.from === undefined || t.def.to === undefined) continue;
      const forward = t.def.from === n;
      const next: NodeId = forward ? t.def.to : t.def.from;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { node: n, edge: id, forward });
      q.push(next);
    }
  }
  if (!seen.has(to)) return null;
  const out: { edge: string; forward: boolean }[] = [];
  for (let n = to; n !== from; ) {
    const p = prev.get(n)!;
    out.unshift({ edge: p.edge, forward: p.forward });
    n = p.node;
  }
  return out;
}

function buildRoute(map: MapRuntime, def: CrowdDef, key: number): Route | null {
  const path = findPath(map, def.from, def.to);
  if (!path || path.length === 0) return null;
  const xs: number[] = [];
  const zs: number[] = [];
  const es: number[] = [];
  for (const { edge, forward } of path) {
    const ss = map.trails[edge]!.samples;
    const list = forward ? ss : [...ss].reverse();
    for (const s of list) {
      if (xs.length > 0 && Math.abs(xs[xs.length - 1]! - s.x) < 0.01 && Math.abs(zs[zs.length - 1]! - s.z) < 0.01) continue;
      xs.push(s.x);
      zs.push(s.z);
      es.push(s.elevM);
    }
  }
  if (xs.length < 2) return null;
  const up = es[es.length - 1]! > es[0]!;
  const v = ((def.speedKmh ?? (up ? 1.0 : 2.5)) * 1000) / 60; // m/分
  const jam = Math.min(0.9, Math.max(0, def.jam ?? 0));
  // 道に沿った距離
  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i += 1) cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!);
  const len = cum[cum.length - 1]!;
  // 着くまでの時間（終わりの 4 割で、だんだん遅くなる）
  const tm = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i += 1) {
    const f = len > 0 ? cum[i]! / len : 1;
    const slow = 1 - jam * Math.min(1, Math.max(0, (f - 0.6) / 0.4));
    tm[i] = tm[i - 1]! + (cum[i]! - cum[i - 1]!) / (v * slow);
  }
  const startMin = parseHHMM(def.start);
  let spanMin = parseHHMM(def.end) - startMin;
  if (spanMin <= 0) spanMin += DAY;
  return { def, xs: Float32Array.from(xs), zs: Float32Array.from(zs), tm, totalMin: tm[tm.length - 1]!, startMin, spanMin, gapMin: 60 / Math.max(0.1, def.perHour), key };
}

/** 出発して e 分たった人の位置（m）と進む向き */
function posAt(r: Route, e: number, out: { x: number; z: number; dx: number; dz: number }): void {
  let lo = 0;
  let hi = r.tm.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.tm[mid]! <= e) lo = mid;
    else hi = mid;
  }
  const t0 = r.tm[lo]!;
  const t1 = r.tm[hi]!;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (e - t0) / (t1 - t0))) : 0;
  out.dx = r.xs[hi]! - r.xs[lo]!;
  out.dz = r.zs[hi]! - r.zs[lo]!;
  out.x = r.xs[lo]! + out.dx * f;
  out.z = r.zs[lo]! + out.dz * f;
}

/** 人形の形（高さ 1 の単位。足もとが 0、前が +z）。上着の部分と、そのほか（頭・脚・ザック）に分ける */
function hikerGeometry(): { jacket: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const jacket = new THREE.CapsuleGeometry(0.13, 0.26, 3, 8);
  jacket.translate(0, 0.6, 0);
  const parts: THREE.BufferGeometry[] = [];
  const color = (g: THREE.BufferGeometry, c: number): THREE.BufferGeometry => {
    const col = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const head = new THREE.SphereGeometry(0.1, 10, 8);
  head.translate(0, 0.9, 0);
  parts.push(color(head, 0xe2b58f));
  const hat = new THREE.SphereGeometry(0.105, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  hat.translate(0, 0.92, 0);
  parts.push(color(hat, 0x3a3a3a));
  for (const sx of [-0.06, 0.06]) {
    const leg = new THREE.CylinderGeometry(0.05, 0.045, 0.45, 6);
    leg.translate(sx, 0.225, 0);
    parts.push(color(leg, 0x2f3238));
  }
  const pack = new THREE.BoxGeometry(0.22, 0.28, 0.12);
  pack.translate(0, 0.66, -0.15);
  parts.push(color(pack, 0x4a4f57));
  // まとめる（同じ属性だけ）
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const pp = p.getAttribute('position').array as Float32Array;
    pos.set(pp, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += pp.length / 3;
  }
  const rest = new THREE.BufferGeometry();
  rest.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rest.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  rest.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { jacket, rest };
}

/** ヘッドランプの光の点（中心が明るい丸） */
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,225,1)');
  grd.addColorStop(0.25, 'rgba(255,236,170,0.75)');
  grd.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CrowdsView {
  readonly group = new THREE.Group();
  private readonly routes: Route[];
  private readonly jacket: THREE.InstancedMesh;
  private readonly rest: THREE.InstancedMesh;
  private readonly lamps: THREE.Points;
  private readonly lampPos: Float32Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly p = { x: 0, z: 0, dx: 0, dz: 1 };

  constructor(
    map: MapRuntime,
    scenario: ScenarioDef,
    private readonly heightAt: (x: number, z: number) => number,
    env: EnvUniforms,
  ) {
    this.routes = (scenario.crowds ?? []).map((d, i) => buildRoute(map, d, i + 1)).filter((r): r is Route => r !== null);
    const { jacket, rest } = hikerGeometry();
    const jm = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const rm = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
    injectEnv(jm, env, false, false, { noFade: true });
    injectEnv(rm, env, false, false, { noFade: true });
    this.jacket = new THREE.InstancedMesh(jacket, jm, MAX);
    this.rest = new THREE.InstancedMesh(rest, rm, MAX);
    for (const im of [this.jacket, this.rest]) {
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.jacket.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.lampPos = new Float32Array(MAX * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lampPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lamps = new THREE.Points(lg, new THREE.PointsMaterial({ map: glowTexture(), size: 1, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
    this.lamps.frustumCulled = false;
    this.lamps.visible = false;
    this.group.add(this.jacket, this.rest, this.lamps);
    this.group.visible = this.routes.length > 0;
  }

  /** tMin（補間した時刻）の列を描く。figH は主役の人形の高さ（シーン単位）、night は暗さ（0〜1） */
  update(tMin: number, figH: number, night: number): void {
    if (this.routes.length === 0) return;
    const h = figH * SIZE_F;
    let n = 0;
    for (const r of this.routes) {
      // 出発の時間帯のうち、いま道の上にいる人の番号の範囲（前の日に出た人も）
      const day0 = Math.floor((tMin - r.totalMin - r.spanMin - r.startMin) / DAY);
      const day1 = Math.floor((tMin - r.startMin) / DAY);
      for (let d = day0; d <= day1 && n < MAX; d += 1) {
        const s0 = d * DAY + r.startMin;
        const kLo = Math.max(0, Math.floor((tMin - r.totalMin - s0) / r.gapMin) - 1);
        const kHi = Math.min(Math.floor(r.spanMin / r.gapMin), Math.floor((tMin - s0) / r.gapMin) + 1);
        for (let k = kLo; k <= kHi && n < MAX; k += 1) {
          const hk = hash(r.key * 100003 + d, k);
          const t0 = s0 + (k + hk * 0.8) * r.gapMin;
          const e = tMin - t0;
          if (e < 0 || e > r.totalMin || t0 > s0 + r.spanMin) continue;
          posAt(r, e, this.p);
          const len = Math.hypot(this.p.dx, this.p.dz) || 1;
          const side = (hash(k, r.key * 7 + d) - 0.5) * 2 * LANE_F * figH;
          const sx = this.p.x * UNIT + (-this.p.dz / len) * side;
          const sz = this.p.z * UNIT + (this.p.dx / len) * side;
          const yaw = Math.atan2(this.p.dx, this.p.dz);
          const bob = Math.abs(Math.sin(e * 9 + hk * 6.28)) * 0.03 * h;
          const y = this.heightAt(sx, sz) + bob;
          const hs = h * (0.9 + 0.2 * hash(k + 11, r.key));
          this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
          this.m.compose(this.v.set(sx, y, sz), this.q, this.sc.set(hs, hs, hs));
          this.jacket.setMatrixAt(n, this.m);
          this.rest.setMatrixAt(n, this.m);
          this.col.setHex(JACKETS[Math.floor(hash(k + 3, r.key + d) * JACKETS.length)]!);
          this.jacket.setColorAt(n, this.col);
          // ヘッドランプ（額の少し前）
          this.lampPos[n * 3] = sx + (this.p.dx / len) * 0.12 * hs;
          this.lampPos[n * 3 + 1] = y + 0.93 * hs;
          this.lampPos[n * 3 + 2] = sz + (this.p.dz / len) * 0.12 * hs;
          n += 1;
        }
      }
    }
    this.jacket.count = n;
    this.rest.count = n;
    this.jacket.instanceMatrix.needsUpdate = true;
    this.rest.instanceMatrix.needsUpdate = true;
    if (this.jacket.instanceColor) this.jacket.instanceColor.needsUpdate = true;
    const lit = night > 0.35 && n > 0;
    this.lamps.visible = lit;
    if (lit) {
      const g = this.lamps.geometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      g.setDrawRange(0, n);
      const mat = this.lamps.material as THREE.PointsMaterial;
      mat.size = h * 0.55;
      mat.opacity = Math.min(1, (night - 0.35) / 0.3);
    }
  }

  dispose(): void {
    this.jacket.geometry.dispose();
    this.rest.geometry.dispose();
    (this.jacket.material as THREE.Material).dispose();
    (this.rest.material as THREE.Material).dispose();
    this.lamps.geometry.dispose();
    const lm = this.lamps.material as THREE.PointsMaterial;
    lm.map?.dispose();
    lm.dispose();
  }
}

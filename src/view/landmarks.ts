/**
 * 地図記号の施設と送電線（map.landmarks・map.powerLines。エディターで地理院地図から取り込み、動かせる）。見た目だけ。
 * - 鉄塔: 4 本の脚が上へすぼまる格子の塔と、送電線と直角の腕木 3 段。InstancedMesh
 * - 電線: 送電線ごとに、線に沿った順に並べた鉄塔の腕木の先どうしを、たるみ（径間の 3%）をつけて結ぶ（片側 3 本ずつ）
 * - 寺・神社（鳥居つき）・駅（ホームと駅舎）・交番・学校・郵便局など: 箱と屋根の簡単な模型
 * 箱庭なので、高さは市街地の建物と同じく実際より少し高くする。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LandmarkDef, MapRuntime } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

const HEIGHT_K = 1.6;
/** 鉄塔の高さ（m）と、脚の開き（根元・頂部の半幅）。部材は箱庭の大きな木の間でも見えるよう実際より太くする */
const TOWER_H = 62;
const BASE_HALF = 7;
const TOP_HALF = 1.6;
/** 腕木: 高さの割合と長さ（片側 m） */
const ARMS: [number, number][] = [[0.72, 9], [0.83, 10.5], [0.94, 9]];

/** a から b へ伸びる細い円柱 */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** 鉄塔の形（単位: m。原点が根元の中心、腕木は ±x 方向） */
function towerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const H = TOWER_H;
  const half = (y: number): number => BASE_HALF + (TOP_HALF - BASE_HALF) * (y / H);
  const corner = (y: number, sx: number, sz: number): THREE.Vector3 => new THREE.Vector3(sx * half(y), y, sz * half(y));
  const signs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [sx, sz] of signs) parts.push(strut(corner(0, sx, sz), corner(H, sx, sz), 1.3));
  // 面の筋交い（X）を 6 段
  const levels = [0, 0.18, 0.34, 0.5, 0.64, 0.78, 0.92].map((f) => f * H);
  for (let i = 1; i < levels.length; i += 1) {
    const y0 = levels[i - 1]!;
    const y1 = levels[i]!;
    for (let k = 0; k < 4; k += 1) {
      const [ax, az] = signs[k]!;
      const [bx, bz] = signs[(k + 1) % 4]!;
      parts.push(strut(corner(y0, ax, az), corner(y1, bx, bz), 0.6), strut(corner(y0, bx, bz), corner(y1, ax, az), 0.6));
      parts.push(strut(corner(y1, ax, az), corner(y1, bx, bz), 0.7));
    }
  }
  // 腕木（±x へ張り出す三角の梁）
  for (const [f, len] of ARMS) {
    const y = f * H;
    for (const s of [1, -1]) {
      parts.push(strut(new THREE.Vector3(s * half(y), y, -half(y)), new THREE.Vector3(s * (half(y) + len), y, 0), 0.8));
      parts.push(strut(new THREE.Vector3(s * half(y), y, half(y)), new THREE.Vector3(s * (half(y) + len), y, 0), 0.8));
      parts.push(strut(new THREE.Vector3(s * half(y), y + 2.5, 0), new THREE.Vector3(s * (half(y) + len), y, 0), 0.6));
      // がいし（垂れ下がる短い棒）
      parts.push(strut(new THREE.Vector3(s * (half(y) + len), y, 0), new THREE.Vector3(s * (half(y) + len), y - 3, 0), 0.9));
    }
  }
  // 頂部の架空地線の支え
  parts.push(strut(new THREE.Vector3(-3, H, 0), new THREE.Vector3(3, H, 0), 0.8));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
}

/** 鉄塔の向き（腕木の向き = 線と直角）。前後の鉄塔の方向から */
function lineAngle(prev: LandmarkDef | undefined, cur: LandmarkDef, next: LandmarkDef | undefined): number {
  const a = prev ?? cur;
  const b = next ?? cur;
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/** 線に沿った距離（鉄塔を線の順に並べるため） */
function along(pts: readonly [number, number][], x: number, z: number): number {
  let s = 0;
  let best = { d: Infinity, s: 0 };
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len || 1)));
    const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
    if (d < best.d) best = { d, s: s + t * len };
    s += len;
  }
  return best.s;
}

function buildTowersAndWires(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms, shadows: boolean): THREE.Object3D[] {
  const towers = (map.def.landmarks ?? []).filter((l) => l.kind === 'tower');
  if (towers.length === 0) return [];
  const yk = UNIT * s.vExag * HEIGHT_K;
  const mat = new THREE.MeshStandardMaterial({ color: 0xc4c9ce, roughness: 0.55, metalness: 0.35 });
  injectEnv(mat, env);
  const geo = towerGeometry();
  const mesh = new THREE.InstancedMesh(geo, mat, towers.length);
  mesh.castShadow = shadows;
  const wirePos: number[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let i = 0;
  // 線ごとに並べる（線のない鉄塔は単独）
  const byLine = new Map<string, LandmarkDef[]>();
  for (const t of towers) byLine.set(t.line ?? `_${t.id}`, [...(byLine.get(t.line ?? `_${t.id}`) ?? []), t]);
  for (const [lineId, list] of byLine) {
    const pts = map.def.powerLines?.find((l) => l.id === lineId)?.pts;
    const sorted = pts ? [...list].sort((a, b) => along(pts, a.x, a.z) - along(pts, b.x, b.z)) : list;
    const tops: { x: number; z: number; y: number; ang: number }[] = [];
    sorted.forEach((t, k) => {
      const ang = lineAngle(sorted[k - 1], t, sorted[k + 1]);
      const y = heightAt(t.x * UNIT, t.z * UNIT);
      // 腕木（三 x）を線と直角に: 線の向きを z にそろえる
      q.setFromAxisAngle(up, -ang + Math.PI / 2);
      m4.compose(new THREE.Vector3(t.x * UNIT, y - 0.5 * yk, t.z * UNIT), q, new THREE.Vector3(UNIT * HEIGHT_K * 0.9, yk, UNIT * HEIGHT_K * 0.9));
      mesh.setMatrixAt(i, m4);
      i += 1;
      tops.push({ x: t.x, z: t.z, y, ang });
    });
    // 電線: 隣り合う鉄塔の、同じ腕木の先どうし（たるみつき）
    for (let k = 1; k < tops.length; k += 1) {
      const a = tops[k - 1]!;
      const b = tops[k]!;
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span > 900) continue;
      for (const [f, len] of ARMS)
        for (const side of [1, -1]) {
          const off = (t: typeof a): [number, number, number] => {
            const reach = (BASE_HALF + (TOP_HALF - BASE_HALF) * f + len) * 0.9 * HEIGHT_K * side;
            // 腕木は線と直角（線の向き ang に対して +90°）
            return [t.x + -Math.sin(t.ang) * reach, t.z + Math.cos(t.ang) * reach, t.y + (f * TOWER_H - 3 - 0.5) * yk];
          };
          const [ax, az, ay] = off(a);
          const [bx, bz, by] = off(b);
          const sag = span * 0.03 * yk;
          const N = 10;
          for (let j = 0; j < N; j += 1) {
            for (const u of [j / N, (j + 1) / N]) {
              wirePos.push((ax + (bx - ax) * u) * UNIT, ay + (by - ay) * u - sag * 4 * u * (1 - u), (az + (bz - az) * u) * UNIT);
            }
          }
        }
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const out: THREE.Object3D[] = [mesh];
  if (wirePos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3));
    out.push(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3a3d42, transparent: true, opacity: 0.85 })));
  }
  return out;
}

/** 施設の簡単な模型（単位: m。原点が地面の中心、+x が rotDeg の向き） */
function facility(kind: LandmarkDef['kind'], mats: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, mat: string, x = 0, y = 0, z = 0): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), mats[mat]!);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  /** 寄棟・入母屋ふうの屋根（四角錐を平たく） */
  const hip = (w: number, d: number, h: number, y: number, mat: string): void => {
    const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, mats[mat]!);
    m.scale.set(w * 1.25, h, d * 1.25);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
  };
  switch (kind) {
    case 'temple':
      box(16, 1.2, 12, 'stone');
      box(13, 5, 9, 'wood', 0, 1.2);
      hip(13, 9, 6, 6.2, 'roofDark');
      break;
    case 'shrine':
      box(7, 0.8, 6, 'stone');
      box(5.5, 3.5, 4.5, 'wood', 0, 0.8);
      hip(5.5, 4.5, 3, 4.3, 'roofDark');
      // 鳥居（社殿の前 +x）
      box(0.6, 5, 0.6, 'red', 9, 0, -2.2);
      box(0.6, 5, 0.6, 'red', 9, 0, 2.2);
      box(1, 0.5, 7, 'red', 9, 5);
      box(0.6, 0.4, 5.6, 'red', 9, 4);
      break;
    case 'station':
      box(80, 1.1, 6, 'concrete');
      box(30, 3.2, 0.3, 'roofLight', 0, 4.2, 0);
      box(12, 4.5, 7, 'white', 0, 0, 7);
      hip(12, 7, 2.5, 4.5, 'roofDark');
      break;
    case 'school':
      box(42, 11, 12, 'white');
      box(42.5, 0.6, 12.5, 'concrete', 0, 11);
      box(60, 0.2, 40, 'ground', 0, 0, 30);
      break;
    case 'police':
      box(7, 5.5, 6, 'white');
      hip(7, 6, 2, 5.5, 'roofDark');
      box(0.8, 0.8, 0.8, 'red', 3.6, 4, 0);
      break;
    case 'post':
      box(10, 5, 8, 'white');
      box(10.2, 0.8, 8.2, 'red', 0, 4);
      break;
    case 'hospital':
    case 'office':
    case 'care':
    case 'library':
    case 'fire':
      box(24, 10, 14, kind === 'fire' ? 'red' : 'white');
      box(24.4, 0.6, 14.4, 'concrete', 0, 10);
      break;
    default:
      box(8, 5, 8, 'white');
  }
  return g;
}

export function buildLandmarks(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const list = map.def.landmarks ?? [];
  if (list.length === 0) return group;
  group.add(...buildTowersAndWires(map, s, heightAt, env, shadows));
  const color = (hex: number, rough = 0.85): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough });
    injectEnv(m, env);
    return m;
  };
  const mats: Record<string, THREE.Material> = {
    stone: color(0x8e8a82), wood: color(0x6b4a30), roofDark: color(0x3c4047, 0.6), roofLight: color(0x9aa1a8, 0.6), red: color(0xc0392b, 0.7),
    white: color(0xe6e1d6), concrete: color(0xa3a09a), ground: color(0x8f8270, 0.95),
  };
  const yk = UNIT * s.vExag * HEIGHT_K;
  for (const l of list) {
    if (l.kind === 'tower' || Math.abs(l.x) > map.half || Math.abs(l.z) > map.half) continue;
    const obj = facility(l.kind, mats);
    obj.position.set(l.x * UNIT, heightAt(l.x * UNIT, l.z * UNIT) - 0.3 * yk, l.z * UNIT);
    obj.rotation.y = -((l.rotDeg ?? 0) * Math.PI) / 180;
    obj.scale.set(UNIT * HEIGHT_K * 0.8, yk, UNIT * HEIGHT_K * 0.8);
    obj.name = l.id;
    group.add(obj);
  }
  return group;
}

/** 施設を置いた所の市街地の建物は描かない（同じ建物が 2 つ重なるので）。鉄塔・駅は除く */
export function facilityNear(map: MapRuntime): (x: number, z: number, r: number) => boolean {
  const fs = (map.def.landmarks ?? []).filter((l) => l.kind !== 'tower' && l.kind !== 'station');
  return (x, z, r) => fs.some((l) => Math.hypot(l.x - x, l.z - z) < r);
}

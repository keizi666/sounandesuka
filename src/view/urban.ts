/**
 * 市街地の建物（地理院地図から取り込んだ map.urban.buildings）。道路・鉄道は地面に塗る（groundMasks.ts の B と地形のシェーダー）。
 * 建物は向きのある長方形の箱に、切妻の屋根（2 階まで）か平らな屋上（3 階以上）を載せる。壁と屋根の色は建物ごとに少し変える。
 * 箱庭なので高さは実際より少し高く（HEIGHT_K 倍）して、斜面では低い側の地面まで壁を下ろす。InstancedMesh で数千棟を軽く描く。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

/** 1 階の高さ（m）と、見た目の高さの倍率 */
const FLOOR_M = 3.0;
const HEIGHT_K = 1.6;

const WALLS = [0xe8e2d4, 0xd9d2c3, 0xc9c3b8, 0xefe9df, 0xbdb3a3, 0xd6c8ae, 0x9c9488];
const ROOFS = [0x3d4248, 0x4a3b32, 0x5b2e26, 0x2f3d4f, 0x55585c, 0x6b4a32];

function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 切妻屋根（幅 1・奥行き 1・高さ 1。棟は幅の向き。底が y = 0） */
function gableGeometry(): THREE.BufferGeometry {
  const o = 0.56; // 軒の出（壁より少し外へ）
  const v = [
    // 左右の屋根面（奥行きの +・− 側）
    -o, 0, o, o, 0, o, o, 1, 0, -o, 1, 0,
    o, 0, -o, -o, 0, -o, -o, 1, 0, o, 1, 0,
    // 妻（幅の ± 側の三角）
    -o, 0, -o, -o, 0, o, -o, 1, 0,
    o, 0, o, o, 0, -o, o, 1, 0,
  ];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildUrban(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms, shadows: boolean): THREE.Group {
  const group = new THREE.Group();
  const list = map.def.urban?.buildings ?? [];
  if (list.length === 0) return group;
  const half = map.half;
  const inside = list.filter(([x, z]) => Math.abs(x) < half - 2 && Math.abs(z) < half - 2);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.15 });
  const flatMat = new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9 });
  for (const m of [wallMat, roofMat, flatMat]) injectEnv(m, env);
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const gable = gableGeometry();
  const slab = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const pitched = inside.filter((b) => b[5] <= 2);
  const flat = inside.filter((b) => b[5] > 2);
  const walls = new THREE.InstancedMesh(box, wallMat, inside.length);
  const roofs = new THREE.InstancedMesh(gable, roofMat, Math.max(1, pitched.length));
  const tops = new THREE.InstancedMesh(slab, flatMat, Math.max(1, flat.length));
  roofs.count = pitched.length;
  tops.count = flat.length;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const yk = UNIT * s.vExag;
  let wi = 0;
  let ri = 0;
  let ti = 0;
  for (const b of inside) {
    const [cx, cz, w, d, deg, floors] = b;
    const r = rnd(Math.floor(cx * 7 + cz * 13) ^ 0x51ed);
    const a = (deg * Math.PI) / 180;
    // 角の地面の高さ: いちばん低い所から壁を立て、いちばん高い所から階の高さを足す
    const c = Math.cos(a);
    const sn = Math.sin(a);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
      const x = cx + (u * w * c - v * d * sn) / 2;
      const z = cz + (u * w * sn + v * d * c) / 2;
      const y = heightAt(x * UNIT, z * UNIT);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const wallH = (floors * FLOOR_M * HEIGHT_K + (floors <= 2 ? 0 : 0.8)) * yk * (0.92 + r() * 0.16);
    const base = lo - 0.4 * yk;
    const top = hi + wallH;
    // three の回転は y 軸まわりで +x から −z へ回る向きなので、+x から +z へ回る角は符号を変える
    q.setFromAxisAngle(yAxis, -a);
    m4.compose(new THREE.Vector3(cx * UNIT, base, cz * UNIT), q, new THREE.Vector3(w * UNIT, top - base, d * UNIT));
    walls.setMatrixAt(wi, m4);
    walls.setColorAt(wi, col.setHex(WALLS[Math.floor(r() * WALLS.length)]!).multiplyScalar(0.9 + r() * 0.15));
    wi += 1;
    if (floors <= 2) {
      // 屋根の高さは短い辺の 0.35 倍ほど。棟は長い辺（幅）の向き
      const rh = Math.min(w, d) * 0.35 * yk * HEIGHT_K * 0.7;
      m4.compose(new THREE.Vector3(cx * UNIT, top, cz * UNIT), q, new THREE.Vector3(w * UNIT, rh, d * UNIT));
      roofs.setMatrixAt(ri, m4);
      roofs.setColorAt(ri, col.setHex(ROOFS[Math.floor(r() * ROOFS.length)]!).multiplyScalar(0.85 + r() * 0.25));
      ri += 1;
    } else {
      // 屋上のふち（パラペット）を少し高く見せる薄い板
      m4.compose(new THREE.Vector3(cx * UNIT, top, cz * UNIT), q, new THREE.Vector3(w * 1.02 * UNIT, 0.5 * yk, d * 1.02 * UNIT));
      tops.setMatrixAt(ti, m4);
      ti += 1;
    }
  }
  for (const im of [walls, roofs, tops]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  group.name = 'urban';
  return group;
}

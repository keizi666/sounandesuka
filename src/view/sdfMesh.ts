/**
 * 距離関数（SDF）の形を Marching Cubes でメッシュにする（docs/19 §6。キャラクターとザックに使う）。
 * 形は「部品（カプセル・楕円体・角丸の箱）」のなめらかな和で作る。部品ごとに、色の区分（region）と、動かす骨（bone）を持たせる。
 * 出力: 位置・法線（距離関数の勾配なので滑らか）・区分・骨の重み（近い部品の骨ほど強い。最大 4 本）。
 * 三角形の表は three/examples の MarchingCubes のものを使う（追加の依存なし）。
 */
import * as THREE from 'three';
import { edgeTable, triTable } from 'three/examples/jsm/objects/MarchingCubes.js';

export interface Prim {
  kind: 'capsule' | 'ellipsoid' | 'box';
  /** 世界座標（結合姿勢）→ 部品の座標 への変換 */
  inv: THREE.Matrix4;
  /** capsule: a → b の線分と両端の半径。ellipsoid: 半径 3 つ。box: 半分の大きさと角の丸み */
  a?: THREE.Vector3;
  b?: THREE.Vector3;
  ra?: number;
  rb?: number;
  r?: THREE.Vector3;
  round?: number;
  region: number;
  bone: number;
  /** なめらかにつなぐ幅 */
  k: number;
  /** 布のしわの深さ（0 = なし） */
  wrinkle?: number;
  /** 部品の座標で y がこの値より下を平らに切る（靴底） */
  cutY?: number;
}

const tmp = new THREE.Vector3();

function primDist(p: THREE.Vector3, q: Prim): number {
  tmp.copy(p).applyMatrix4(q.inv);
  let d: number;
  if (q.kind === 'capsule') {
    const a = q.a!;
    const b = q.b!;
    const bax = b.x - a.x;
    const bay = b.y - a.y;
    const baz = b.z - a.z;
    const pax = tmp.x - a.x;
    const pay = tmp.y - a.y;
    const paz = tmp.z - a.z;
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
    d = Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (q.ra! + (q.rb! - q.ra!) * h);
  } else if (q.kind === 'ellipsoid') {
    const r = q.r!;
    const k0 = Math.hypot(tmp.x / r.x, tmp.y / r.y, tmp.z / r.z);
    const k1 = Math.hypot(tmp.x / (r.x * r.x), tmp.y / (r.y * r.y), tmp.z / (r.z * r.z));
    d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r.x, r.y, r.z);
  } else {
    const r = q.r!;
    const rd = q.round ?? 0;
    const qx = Math.abs(tmp.x) - (r.x - rd);
    const qy = Math.abs(tmp.y) - (r.y - rd);
    const qz = Math.abs(tmp.z) - (r.z - rd);
    d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - rd;
  }
  if (q.wrinkle) d += q.wrinkle * Math.sin(tmp.y * 95 + Math.sin(tmp.x * 40 + tmp.z * 31) * 1.6);
  if (q.cutY !== undefined) d = Math.max(d, q.cutY - tmp.y);
  return d;
}

/** なめらかな最小値（多項式）。k が大きいほど広く溶け合う */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / (k || 1e-9);
  return Math.min(a, b) - h * h * k * 0.25;
}

export function sdf(p: THREE.Vector3, prims: Prim[]): number {
  let d = Infinity;
  for (const q of prims) d = d === Infinity ? primDist(p, q) : smin(d, primDist(p, q), q.k);
  return d;
}

export interface SdfMesh {
  geometry: THREE.BufferGeometry;
  /** 頂点ごとの色の区分 */
  regions: Uint8Array;
}

/**
 * prims の形をメッシュにする。cell は格子の細かさ（結合姿勢の座標）。
 * bones を使う場合（bones > 0）は skinIndex / skinWeight も作る。
 */
export function meshSdf(prims: Prim[], cell: number, withSkin: boolean): SdfMesh {
  // 範囲: 各部品を囲む箱（部品の座標の原点と大きさから粗く見積もる）
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const c = new THREE.Vector3();
  for (const q of prims) {
    m.copy(q.inv).invert();
    const pts: THREE.Vector3[] = [];
    let rad = 0;
    if (q.kind === 'capsule') {
      pts.push(q.a!.clone(), q.b!.clone());
      rad = Math.max(q.ra!, q.rb!);
    } else {
      pts.push(new THREE.Vector3());
      rad = Math.max(q.r!.x, q.r!.y, q.r!.z);
    }
    for (const p of pts) {
      c.copy(p).applyMatrix4(m);
      box.expandByPoint(c.clone().addScalar(rad + cell * 2));
      box.expandByPoint(c.clone().addScalar(-rad - cell * 2));
    }
  }
  const nx = Math.ceil((box.max.x - box.min.x) / cell);
  const ny = Math.ceil((box.max.y - box.min.y) / cell);
  const nz = Math.ceil((box.max.z - box.min.z) / cell);
  const sx = nx + 1;
  const sy = ny + 1;
  const field = new Float32Array(sx * sy * (nz + 1));
  const p = new THREE.Vector3();
  for (let z = 0; z <= nz; z += 1) {
    for (let y = 0; y <= ny; y += 1) {
      for (let x = 0; x <= nx; x += 1) {
        p.set(box.min.x + x * cell, box.min.y + y * cell, box.min.z + z * cell);
        field[(z * sy + y) * sx + x] = sdf(p, prims);
      }
    }
  }
  const pos: number[] = [];
  const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] as const;
  const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const val = new Float32Array(8);
  const ev = new Float32Array(36);
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        let idx = 0;
        for (let i = 0; i < 8; i += 1) {
          const o = CORNER[i]!;
          const v = field[((z + o[2]) * sy + (y + o[1])) * sx + (x + o[0])]!;
          val[i] = v;
          if (v < 0) idx |= 1 << i;
        }
        const bits = edgeTable[idx]!;
        if (bits === 0) continue;
        for (let e = 0; e < 12; e += 1) {
          if (!(bits & (1 << e))) continue;
          const [i0, i1] = EDGE[e]!;
          const a = CORNER[i0]!;
          const b = CORNER[i1]!;
          const t = val[i0]! / (val[i0]! - val[i1]! || 1e-9);
          ev[e * 3] = box.min.x + (x + a[0] + (b[0] - a[0]) * t) * cell;
          ev[e * 3 + 1] = box.min.y + (y + a[1] + (b[1] - a[1]) * t) * cell;
          ev[e * 3 + 2] = box.min.z + (z + a[2] + (b[2] - a[2]) * t) * cell;
        }
        for (let t = idx * 16; triTable[t] !== -1; t += 3) {
          for (let k = 0; k < 3; k += 1) {
            const e = triTable[t + k]!;
            pos.push(ev[e * 3]!, ev[e * 3 + 1]!, ev[e * 3 + 2]!);
          }
        }
      }
    }
  }
  const n = pos.length / 3;
  const position = new Float32Array(pos);
  const normal = new Float32Array(n * 3);
  const regions = new Uint8Array(n);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const g = new THREE.Vector3();
  const h = cell * 0.5;
  const dist = new Float32Array(prims.length);
  for (let i = 0; i < n; i += 1) {
    p.set(position[i * 3]!, position[i * 3 + 1]!, position[i * 3 + 2]!);
    // 法線 = 距離関数の勾配
    const d0 = sdf(p, prims);
    g.set(sdf(p.set(position[i * 3]! + h, position[i * 3 + 1]!, position[i * 3 + 2]!), prims) - d0, 0, 0);
    g.y = sdf(p.set(position[i * 3]!, position[i * 3 + 1]! + h, position[i * 3 + 2]!), prims) - d0;
    g.z = sdf(p.set(position[i * 3]!, position[i * 3 + 1]!, position[i * 3 + 2]! + h), prims) - d0;
    g.normalize();
    normal.set([g.x, g.y, g.z], i * 3);
    // 区分と骨: 近い部品から
    p.set(position[i * 3]!, position[i * 3 + 1]!, position[i * 3 + 2]!);
    let best = 0;
    for (let q = 0; q < prims.length; q += 1) {
      dist[q] = primDist(p, prims[q]!);
      if (dist[q]! < dist[best]!) best = q;
    }
    regions[i] = prims[best]!.region;
    if (withSkin) {
      const w = new Map<number, number>();
      for (let q = 0; q < prims.length; q += 1) {
        const wt = Math.exp(-Math.max(0, dist[q]! - dist[best]!) / 0.016);
        if (wt < 0.02) continue;
        w.set(prims[q]!.bone, Math.max(w.get(prims[q]!.bone) ?? 0, wt));
      }
      const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((a, x) => a + x[1], 0) || 1;
      top.forEach(([bone, wt], k) => {
        skinIndex[i * 4 + k] = bone;
        skinWeight[i * 4 + k] = wt / sum;
      });
    }
  }
  // 三角形の向き: 法線と逆なら入れ替える
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cc = new THREE.Vector3();
  const swap = (arr: { [k: number]: number }, size: number, i: number, j: number): void => {
    for (let k = 0; k < size; k += 1) {
      const t = arr[i * size + k]!;
      arr[i * size + k] = arr[j * size + k]!;
      arr[j * size + k] = t;
    }
  };
  for (let i = 0; i < n; i += 3) {
    a.fromArray(position, i * 3);
    b.fromArray(position, (i + 1) * 3).sub(a);
    cc.fromArray(position, (i + 2) * 3).sub(a);
    b.cross(cc);
    if (b.x * normal[i * 3]! + b.y * normal[i * 3 + 1]! + b.z * normal[i * 3 + 2]! < 0) {
      swap(position, 3, i + 1, i + 2);
      swap(normal, 3, i + 1, i + 2);
      swap(skinIndex, 4, i + 1, i + 2);
      swap(skinWeight, 4, i + 1, i + 2);
      const t = regions[i + 1]!;
      regions[i + 1] = regions[i + 2]!;
      regions[i + 2] = t;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  if (withSkin) {
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  }
  geometry.computeBoundingSphere();
  return { geometry, regions };
}

/**
 * 樹木・岩の形（手続き生成。高さ 1 に正規化、原点は根元）。頂点色で陰影（内側・下側を暗く、枝先・上側を明るく）を付ける。
 * 種類ごとに数個の変種を作り、並べたときの繰り返し感を減らす。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type TreeKind = 'broadleaf' | 'conifer' | 'krummholz' | 'shrub' | 'rock';

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

/** 三角形を足していく入れ物 */
class Tris {
  pos: number[] = [];
  col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: THREE.Color, cb: THREE.Color, cc: THREE.Color): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeVertexNormals();
    return g;
  }
}

/** 既存の形に頂点色を付けて非インデックスにする（色は頂点ごとの関数） */
function paint(g: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  const pos = out.getAttribute('position');
  const nor = out.getAttribute('normal');
  const arr = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = f(p, n);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  out.deleteAttribute('uv');
  return out;
}

/** 法線を「中心から外向き」に寄せて、塊を柔らかく見せる */
function soften(g: THREE.BufferGeometry, cx: number, cy: number, cz: number, k = 0.6): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i).sub(new THREE.Vector3(cx, cy, cz)).normalize();
    n.fromBufferAttribute(nor, i).lerp(p, k).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/** でこぼこの塊（葉群・岩）。頂点を位置のハッシュでずらすので、継ぎ目が割れない */
function lump(radius: number, detail: number, rough: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 37.1 / radius + seed) * Math.cos(v.y * 29.3 / radius + seed * 1.7) * Math.sin(v.z * 31.7 / radius + seed * 0.6);
    const h2 = Math.sin((v.x + v.y) * 11 / radius + seed * 2.1) * Math.cos((v.z - v.y) * 9 / radius + seed);
    v.multiplyScalar(1 + rough * (0.6 * h + 0.4 * h2));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

const TRUNK = new THREE.Color(0x4f3b2a);
const TRUNK_LIGHT = new THREE.Color(0x77604a);

function trunk(r0: number, r1: number, h: number, seg: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 3).translate(0, h / 2, 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) + lean * y * y * h);
  }
  return paint(g, (p, n) => TRUNK.clone().lerp(TRUNK_LIGHT, 0.5 + 0.5 * n.x).multiplyScalar(0.75 + 0.25 * Math.min(1, p.y / h + 0.3)));
}

/** 針葉樹: 幹に、枝先が垂れてぎざぎざになった枝の段を重ねる */
function conifer(seed: number, detail: boolean, slim: number, base: THREE.Color): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [trunk(0.036, 0.008, 0.96, detail ? 6 : 4)];
  const tiers = detail ? 8 : 4;
  const spikes = detail ? 9 : 6;
  const t = new Tris();
  const dark = base.clone().multiplyScalar(0.45);
  const tip = base.clone().lerp(new THREE.Color(0x8fae5a), 0.35);
  const apex = new THREE.Vector3();
  const under = new THREE.Vector3();
  for (let i = 0; i < tiers; i += 1) {
    const f = i / (tiers - 1);
    const y0 = 0.15 + 0.7 * Math.pow(f, 0.92);
    const R = (0.3 * Math.pow(1 - f, 0.85) + 0.045) * slim * (0.9 + r() * 0.2);
    const h = (0.25 - 0.1 * f) * (detail ? 1 : 1.7);
    const rot = r() * Math.PI * 2;
    const droop = 0.045 * (1 - f) + 0.01;
    apex.set(0, y0 + h, 0);
    under.set(0, y0 + 0.035, 0);
    const mid = base.clone().multiplyScalar(0.72 + 0.28 * f);
    const tipC = tip.clone().multiplyScalar(0.85 + 0.25 * f);
    const rim: THREE.Vector3[] = [];
    for (let k = 0; k < spikes * 2; k += 1) {
      const a = rot + (k / (spikes * 2)) * Math.PI * 2;
      const out = k % 2 === 0;
      const rr = R * (out ? 0.92 + r() * 0.16 : 0.6 + r() * 0.1);
      rim.push(new THREE.Vector3(Math.cos(a) * rr, y0 - (out ? droop * (0.7 + r() * 0.6) : -0.012), Math.sin(a) * rr));
    }
    for (let k = 0; k < rim.length; k += 1) {
      const a = rim[k]!;
      const b = rim[(k + 1) % rim.length]!;
      const ca = k % 2 === 0 ? tipC : mid;
      const cb = k % 2 === 0 ? mid : tipC;
      t.tri(apex, b, a, mid, cb, ca);
      t.tri(under, a, b, dark, dark, dark);
    }
  }
  parts.push(t.build());
  return mergeGeometries(parts)!;
}

/** 広葉樹: 曲がった幹と枝、陰影のある葉の塊 */
function broadleaf(seed: number, detail: boolean, palette: THREE.Color[], bare: boolean): THREE.BufferGeometry {
  const r = rng(seed);
  const lean = (r() - 0.5) * 0.12;
  const parts: THREE.BufferGeometry[] = [trunk(0.05, 0.022, 0.62, detail ? 7 : 4, lean)];
  const crownY = 0.68;
  const n = detail ? 7 : 3;
  const branch = (x: number, y: number, z: number, len: number, thick: number): void => {
    const g = new THREE.CylinderGeometry(thick * 0.4, thick, len, 4).translate(0, len / 2, 0);
    const dir = new THREE.Vector3(x - lean * 0.5, y - 0.42, z).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)).translate(lean * 0.25, 0.42, 0);
    parts.push(paint(g, () => TRUNK.clone()));
  };
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8;
    const ring = i === 0 ? 0 : 0.14 + r() * 0.1;
    const x = Math.cos(a) * ring + lean * 0.6;
    const z = Math.sin(a) * ring;
    const y = crownY + (i === 0 ? 0.12 : (r() - 0.4) * 0.2);
    const rad = (i === 0 ? 0.25 : 0.15 + r() * 0.07) * (detail ? 1 : 1.25);
    if (detail || bare) branch(x, y, z, Math.hypot(x, y - 0.42, z) * (bare ? 1.15 : 0.9), bare ? 0.016 : 0.014);
    if (bare) {
      // 落葉期: 枝先の細い枝
      for (let k = 0; k < 2; k += 1) branch(x + (r() - 0.5) * 0.25, y + 0.1 + r() * 0.12, z + (r() - 0.5) * 0.25, 0.5 + r() * 0.15, 0.008);
      continue;
    }
    const c = palette[Math.floor(r() * palette.length) % palette.length]!;
    const lo = c.clone().multiplyScalar(0.5);
    const hi = c.clone().lerp(new THREE.Color(0xfff3b0), 0.18);
    const g = lump(rad, detail ? 1 : 0, 0.16, seed + i * 3.3).scale(1, 0.82, 1).translate(x, y, z);
    parts.push(soften(paint(g, (p, nn) => {
      // 上向きの面と外側ほど明るく、樹冠の中心に近い内側は暗い
      const upK = 0.5 + 0.5 * nn.y;
      const outK = Math.min(1, Math.hypot(p.x - lean * 0.6, p.z) / 0.34);
      return lo.clone().lerp(hi, Math.min(1, 0.15 + 0.6 * upK + 0.25 * outK));
    }), x, y, z));
  }
  return mergeGeometries(parts)!;
}

/** ハイマツ・低木: 地をはう低い塊の集まり */
function mound(seed: number, detail: boolean, base: THREE.Color, flat: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = detail ? 5 : 2;
  const lo = base.clone().multiplyScalar(0.5);
  const hi = base.clone().lerp(new THREE.Color(0xa9c070), 0.3);
  for (let i = 0; i < n; i += 1) {
    const a = r() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.2 + r() * 0.22;
    const rad = i === 0 ? 0.38 : 0.2 + r() * 0.14;
    const g = lump(rad, detail ? 1 : 0, 0.2, seed + i * 5.1).scale(1.25, flat, 1.1).translate(Math.cos(a) * d, rad * flat * 0.55, Math.sin(a) * d);
    parts.push(soften(paint(g, (_p, nn) => lo.clone().lerp(hi, Math.max(0, nn.y) * 0.85 + 0.1)), Math.cos(a) * d, 0, Math.sin(a) * d, 0.5));
  }
  return mergeGeometries(parts)!;
}

/** 岩: 角ばった塊（面ごとに陰影が出るよう、法線は面のまま） */
function rock(seed: number, detail: boolean): THREE.BufferGeometry {
  const r = rng(seed);
  const g = lump(0.5, detail ? 1 : 0, 0.3, seed).scale(1 + r() * 0.5, 0.55 + r() * 0.35, 0.9 + r() * 0.4).translate(0, 0.18, 0);
  const base = new THREE.Color(0x8b8780).lerp(new THREE.Color(0x6f6a60), r());
  const moss = new THREE.Color(0x6d7550);
  return paint(g, (p, n) => base.clone().multiplyScalar(0.7 + 0.3 * Math.max(0, n.y) + (r() - 0.5) * 0.06).lerp(moss, p.y < 0.12 && n.y > 0.2 ? 0.35 : 0));
}

/** 種類ごとの変種の一覧 */
export function treeShapes(season: string, detail: boolean): Record<TreeKind, THREE.BufferGeometry[]> {
  const autumn = season === 'autumn';
  const winter = season === 'winter';
  const greens = [new THREE.Color(0x5f8f3a), new THREE.Color(0x4f7d33), new THREE.Color(0x6f9a44)];
  const fall: THREE.Color[][] = [
    [new THREE.Color(0xd9a12a), new THREE.Color(0xc98a24), new THREE.Color(0xb7b040)],
    [new THREE.Color(0xc65a26), new THREE.Color(0xd17a2a), new THREE.Color(0xa8402a)],
    [new THREE.Color(0x9c3324), new THREE.Color(0xb84a2a), new THREE.Color(0xc98a2c)],
  ];
  const pal = (i: number): THREE.Color[] => (autumn ? fall[i % fall.length]! : greens);
  return {
    broadleaf: [0, 1, 2].map((i) => broadleaf(101 + i * 17, detail, pal(i), winter)),
    conifer: [
      conifer(201, detail, 1.0, new THREE.Color(0x2f5a34)),
      conifer(202, detail, 0.78, new THREE.Color(0x274c33)),
      conifer(203, detail, 1.12, new THREE.Color(0x3a6238)),
    ],
    krummholz: [mound(301, detail, new THREE.Color(0x3f6a3a), 0.5), mound(302, detail, new THREE.Color(0x47703c), 0.42)],
    shrub: [mound(401, detail, autumn ? new THREE.Color(0xa8552c) : new THREE.Color(0x6f8a48), 0.8), mound(402, detail, autumn ? new THREE.Color(0xb9942e) : new THREE.Color(0x5f7d40), 0.7)],
    rock: [rock(501, detail), rock(502, detail), rock(503, detail)],
  };
}

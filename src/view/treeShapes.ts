/**
 * 樹木・低木・岩の形（手続き生成。高さ 1 に正規化、原点は根元。docs/19 §7）。
 * 樹冠は「葉のテクスチャを貼った小さな板」を樹冠の体積にばらまき、法線を樹冠の中心から外向きに書き換える
 * （ふわっとした輪郭と滑らかな陰影になる）。針葉樹は、垂れ下がる枝の板を段ごとに不ぞろいに付ける。
 * 樹種ごとに 2 つの変種を作る。near は近景用、far は遠景用（板を減らして大きくする）。
 */
import * as THREE from 'three';
import { ATLAS, atlasUv, type AtlasCell } from './leafTextures';

export type TreeKind = 'buna' | 'mizunara' | 'kaede' | 'kanba' | 'shirabiso' | 'tsuga' | 'karamatsu' | 'sugi' | 'hinoki' | 'haimatsu' | 'shrub' | 'rock';
export const TREE_KINDS: TreeKind[] = ['buna', 'mizunara', 'kaede', 'kanba', 'shirabiso', 'tsuga', 'karamatsu', 'sugi', 'hinoki', 'haimatsu', 'shrub', 'rock'];
export const VARIANTS = 2;

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);

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

/** 頂点を足していく入れ物（非インデックス。position / normal / uv / color） */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  vert(p: V3, n: V3, u: number, v: number, c: THREE.Color): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
  }

  /** 四角い板。a（左下）→ b（右下）→ c（右上）→ d（左上）。uv は cell の全面 */
  quad(a: V3, b: V3, c: V3, d: V3, cell: AtlasCell, normal: (p: V3) => V3, color: (p: V3) => THREE.Color, flipV = false): void {
    const [u0, v0] = atlasUv(cell, 0, flipV ? 1 : 0);
    const [u1, v1] = atlasUv(cell, 1, flipV ? 0 : 1);
    const put = (p: V3, u: number, v: number): void => this.vert(p, normal(p), u, v, color(p));
    put(a, u0, v0);
    put(b, u1, v0);
    put(c, u1, v1);
    put(a, u0, v0);
    put(c, u1, v1);
    put(d, u0, v1);
  }

  /** 曲線に沿った先細りの管（幹・枝）。radius(t) は t = 0..1 での半径 */
  tube(path: V3[], radius: (t: number) => number, color: (p: V3, t: number, ang: number) => THREE.Color, sides: number): void {
    const [su, sv] = atlasUv(ATLAS.solid, 0.5, 0.5);
    const rings: { p: V3; n: V3 }[][] = [];
    for (let i = 0; i < path.length; i += 1) {
      const t = i / (path.length - 1);
      const dir = path[Math.min(path.length - 1, i + 1)]!.clone().sub(path[Math.max(0, i - 1)]!).normalize();
      const side = Math.abs(dir.y) > 0.95 ? v3(1, 0, 0) : v3().crossVectors(UP, dir).normalize();
      const fwd = v3().crossVectors(dir, side).normalize();
      const ring: { p: V3; n: V3 }[] = [];
      for (let k = 0; k <= sides; k += 1) {
        const a = (k / sides) * Math.PI * 2;
        const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
        ring.push({ p: path[i]!.clone().addScaledVector(n, radius(t)), n });
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i += 1) {
      const t0 = i / (rings.length - 1);
      const t1 = (i + 1) / (rings.length - 1);
      for (let k = 0; k < sides; k += 1) {
        const a0 = rings[i]![k]!;
        const a1 = rings[i]![k + 1]!;
        const b0 = rings[i + 1]![k]!;
        const b1 = rings[i + 1]![k + 1]!;
        const ang = (k / sides) * Math.PI * 2;
        const put = (q: { p: V3; n: V3 }, t: number): void => this.vert(q.p, q.n, su, sv, color(q.p, t, ang));
        put(a0, t0);
        put(b0, t1);
        put(a1, t0);
        put(a1, t0);
        put(b0, t1);
        put(b1, t1);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const C = (h: number): THREE.Color => new THREE.Color(h);

/** 幹: 根張りがあり、先細りで、少し曲がる。樹皮の縦の濃淡を頂点色で付ける */
function addTrunk(b: Builder, r: () => number, o: { h: number; r0: number; lean: number; bend: number; color: THREE.Color; sides: number; white?: boolean }): V3[] {
  const path: V3[] = [];
  const phase = r() * 6.28;
  const n = 7;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    path.push(v3(o.lean * t * t * o.h + Math.sin(t * 3.1 + phase) * o.bend, t * o.h, Math.cos(t * 2.3 + phase) * o.bend * 0.7));
  }
  const dark = o.color.clone().multiplyScalar(0.62);
  b.tube(
    path,
    (t) => o.r0 * (1 - 0.72 * t) * (1 + 0.55 * Math.pow(1 - Math.min(1, t * 9), 2)), // 根元で少し広がる
    (p, t, ang) => {
      const streak = 0.5 + 0.5 * Math.sin(ang * 5 + p.y * 40);
      const c = dark.clone().lerp(o.color, 0.35 + 0.65 * streak);
      // ダケカンバ: 白い幹に横縞
      if (o.white && Math.sin(p.y * 90 + ang * 2) > 0.82) c.multiplyScalar(0.55);
      // 根元は暗く（地面との接地感）
      return c.multiplyScalar(0.55 + 0.45 * Math.min(1, t * 5));
    },
    o.sides,
  );
  return path;
}

interface Blob {
  c: V3;
  rx: number;
  ry: number;
}

interface CrownSpec {
  blobs: Blob[];
  cards: number;
  size: number;
  palette: THREE.Color[];
  /** 0 = 詰まった樹冠、1 = 透ける */
  sparse: number;
}

/** 樹冠: 葉の板をばらまく。法線は樹冠全体の中心から外向き */
function addCrown(b: Builder, r: () => number, s: CrownSpec): void {
  const mid = s.blobs.reduce((a, x) => a.add(x.c), v3()).multiplyScalar(1 / s.blobs.length);
  const yMin = Math.min(...s.blobs.map((x) => x.c.y - x.ry));
  const yMax = Math.max(...s.blobs.map((x) => x.c.y + x.ry));
  const rMax = Math.max(...s.blobs.map((x) => Math.hypot(x.c.x, x.c.z) + x.rx));
  for (const blob of s.blobs) {
    const n = Math.max(3, Math.round((s.cards * (blob.rx * blob.ry)) / s.blobs.reduce((a, x) => a + x.rx * x.ry, 0)));
    const base = s.palette[Math.floor(r() * s.palette.length) % s.palette.length]!;
    for (let i = 0; i < n; i += 1) {
      // 外殻寄りに置く。下面は少なめ
      const u = r() * 2 - 0.35;
      const y = Math.max(-0.75, Math.min(1, u));
      const a = r() * Math.PI * 2;
      const rad = Math.sqrt(1 - Math.min(1, y * y));
      const d = v3(Math.cos(a) * rad, y, Math.sin(a) * rad);
      const shell = 0.55 + 0.45 * Math.pow(r(), 0.6 + s.sparse);
      const p = blob.c.clone().add(v3(d.x * blob.rx * shell, d.y * blob.ry * shell, d.z * blob.rx * shell));
      // 板の向き: 外向きを基本に、少しばらつかせる
      const face = d.clone().add(v3((r() - 0.5) * 0.9, (r() - 0.3) * 0.7, (r() - 0.5) * 0.9)).normalize();
      const right = Math.abs(face.y) > 0.92 ? v3(1, 0, 0) : v3().crossVectors(UP, face).normalize();
      const upv = v3().crossVectors(face, right).normalize();
      const roll = r() * Math.PI * 2;
      const rr = right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(upv, Math.sin(roll));
      const uu = v3().crossVectors(face, rr).normalize();
      const sz = s.size * (0.75 + r() * 0.5);
      const tone = base.clone().lerp(s.palette[Math.floor(r() * s.palette.length) % s.palette.length]!, r() * 0.45);
      const normal = (q: V3): V3 => q.clone().sub(mid).normalize().lerp(UP, 0.22).normalize();
      const color = (q: V3): THREE.Color => {
        // 上・外ほど明るく、下・内は暗い（樹冠の中の陰）
        const hy = (q.y - yMin) / Math.max(1e-6, yMax - yMin);
        const out = Math.min(1, Math.hypot(q.x, q.z) / Math.max(1e-6, rMax));
        return tone.clone().multiplyScalar(0.5 + 0.34 * hy + 0.2 * out);
      };
      b.quad(
        p.clone().addScaledVector(rr, -sz).addScaledVector(uu, -sz),
        p.clone().addScaledVector(rr, sz).addScaledVector(uu, -sz),
        p.clone().addScaledVector(rr, sz).addScaledVector(uu, sz),
        p.clone().addScaledVector(rr, -sz).addScaledVector(uu, sz),
        ATLAS.leaf,
        normal,
        color,
      );
    }
  }
}

function addBranch(b: Builder, from: V3, to: V3, r0: number, color: THREE.Color): void {
  const midp = from.clone().lerp(to, 0.5).add(v3(0, from.distanceTo(to) * 0.12, 0));
  b.tube([from, midp, to], (t) => r0 * (1 - 0.7 * t), () => color.clone().multiplyScalar(0.8), 4);
}

interface BroadSpec {
  trunkH: number;
  trunkR: number;
  lean: number;
  bend: number;
  bark: number;
  white?: boolean;
  stems?: number;
  crown: (r: () => number, top: V3) => Blob[];
  cards: number;
  size: number;
  sparse: number;
}

function broadleaf(seed: number, detail: boolean, sp: BroadSpec, palette: THREE.Color[], bare: boolean): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder();
  const stems = sp.stems ?? 1;
  const tops: V3[] = [];
  for (let k = 0; k < stems; k += 1) {
    const ang = (k / stems) * Math.PI * 2 + r();
    const lean = stems > 1 ? 0.28 : sp.lean * (r() - 0.5) * 2;
    const before = b.pos.length;
    const path = addTrunk(b, r, { h: sp.trunkH * (0.85 + r() * 0.3), r0: sp.trunkR * (stems > 1 ? 0.6 : 1), lean, bend: sp.bend, color: C(sp.bark), sides: detail ? 7 : 4, white: sp.white });
    if (stems > 1) {
      // 株立ち: 幹ごとに外へ倒す向きを変える
      for (let i = before; i < b.pos.length; i += 3) {
        const x = b.pos[i]!;
        const z = b.pos[i + 2]!;
        b.pos[i] = x * Math.cos(ang) - z * Math.sin(ang);
        b.pos[i + 2] = x * Math.sin(ang) + z * Math.cos(ang);
      }
      const t = path[path.length - 1]!;
      tops.push(v3(t.x * Math.cos(ang) - t.z * Math.sin(ang), t.y, t.x * Math.sin(ang) + t.z * Math.cos(ang)));
    } else tops.push(path[path.length - 1]!);
  }
  const top = tops.reduce((a, x) => a.add(x), v3()).multiplyScalar(1 / tops.length);
  const blobs = sp.crown(r, top);
  // 枝: 幹の上部から各葉群の中心へ
  if (detail || bare) for (const bl of blobs) addBranch(b, tops[Math.floor(r() * tops.length)]!.clone().multiplyScalar(0.82), bl.c.clone().lerp(top, 0.25), sp.trunkR * 0.32, C(sp.bark));
  if (bare) {
    // 落葉期: 枝先の細い枝だけ
    for (const bl of blobs) for (let k = 0; k < 3; k += 1) addBranch(b, bl.c.clone().lerp(top, 0.3), bl.c.clone().add(v3((r() - 0.5) * bl.rx * 2, bl.ry * (0.3 + r() * 0.8), (r() - 0.5) * bl.rx * 2)), sp.trunkR * 0.14, C(sp.bark));
  } else {
    addCrown(b, r, { blobs, cards: detail ? sp.cards : Math.max(8, Math.round(sp.cards / 4.5)), size: sp.size * (detail ? 1 : 1.9), palette, sparse: sp.sparse });
  }
  return b.build();
}

interface ConiferSpec {
  bark: number;
  /** 段の半径（t = 0 が最下段、1 が頂） */
  radius: (t: number) => number;
  tiers: number;
  boughs: number;
  droop: number;
  /** 段ごとの不ぞろいさ */
  ragged: number;
  topLean: number;
  firstY: number;
  missing: number;
}

function conifer(seed: number, detail: boolean, sp: ConiferSpec, base: THREE.Color, bare: boolean): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder();
  const path = addTrunk(b, r, { h: 0.97, r0: 0.022, lean: sp.topLean * (r() - 0.3), bend: 0.006, color: C(sp.bark), sides: detail ? 6 : 4 });
  const at = (y: number): V3 => {
    const f = Math.min(path.length - 1.001, (y / 0.97) * (path.length - 1));
    const i = Math.floor(f);
    return path[i]!.clone().lerp(path[i + 1]!, f - i);
  };
  if (bare) return b.build();
  const tiers = detail ? sp.tiers : Math.max(4, Math.round(sp.tiers * 0.45));
  const boughs = detail ? sp.boughs : Math.max(4, sp.boughs - 2);
  const dark = base.clone().multiplyScalar(0.5);
  const light = base.clone().lerp(C(0xb9cf7a), 0.3);
  for (let i = 0; i < tiers; i += 1) {
    const t = i / (tiers - 1);
    const y = sp.firstY + (0.93 - sp.firstY) * Math.pow(t, 0.9);
    const R = sp.radius(t) * (1 + (r() - 0.5) * sp.ragged);
    const rot = r() * Math.PI * 2;
    const c0 = at(y);
    for (let k = 0; k < boughs; k += 1) {
      if (r() < sp.missing) continue;
      const a = rot + (k / boughs) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const len = R * (0.75 + r() * 0.5) * (detail ? 1 : 1.25);
      const droop = sp.droop * len * (0.6 + r() * 0.8);
      const out = v3(Math.cos(a), 0, Math.sin(a));
      const tan = v3(-Math.sin(a), 0, Math.cos(a));
      const tip = c0.clone().addScaledVector(out, len).add(v3(0, -droop, 0));
      const root = c0.clone().add(v3(0, len * 0.16, 0));
      const w = len * (detail ? 0.62 : 0.85);
      const normal = (): V3 => out.clone().multiplyScalar(0.55).add(v3(0, 0.84, 0)).normalize();
      const color = (q: V3): THREE.Color => {
        // 幹に近いほど暗く、枝先は明るい。上の段ほど明るい
        const outK = Math.min(1, Math.hypot(q.x - c0.x, q.z - c0.z) / Math.max(1e-6, len));
        return dark.clone().lerp(light, 0.15 + 0.6 * outK + 0.25 * t);
      };
      b.quad(tip.clone().addScaledVector(tan, -w), tip.clone().addScaledVector(tan, w), root.clone().addScaledVector(tan, w), root.clone().addScaledVector(tan, -w), ATLAS.needle, normal, color);
    }
  }
  // 頂: 尖った先（上向きの枝を 3 枚、交差させる）
  const topP = at(0.9);
  for (let k = 0; k < 3; k += 1) {
    const a = (k / 3) * Math.PI + r();
    const tan = v3(Math.cos(a), 0, Math.sin(a));
    const w = 0.045;
    const lo = topP.clone();
    const hi = topP.clone().add(v3(0, 0.14, 0));
    b.quad(lo.clone().addScaledVector(tan, -w), lo.clone().addScaledVector(tan, w), hi.clone().addScaledVector(tan, w), hi.clone().addScaledVector(tan, -w), ATLAS.needle, (q) => v3(q.x - topP.x, 0.6, q.z - topP.z).normalize(), () => light.clone(), true);
  }
  return b.build();
}

/** ハイマツ: 地をはう枝が放射状に広がり、先が持ち上がる */
function creeping(seed: number, detail: boolean, base: THREE.Color): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder();
  const n = detail ? 20 : 9;
  const dark = base.clone().multiplyScalar(0.5);
  const light = base.clone().lerp(C(0xc4d98a), 0.3);
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const len = 0.45 + r() * 0.55;
    const out = v3(Math.cos(a), 0, Math.sin(a));
    const tan = v3(-Math.sin(a), 0, Math.cos(a));
    const c0 = out.clone().multiplyScalar(r() * 0.25).add(v3(0, 0.12 + r() * 0.2, 0));
    const tip = c0.clone().addScaledVector(out, len * 0.8).add(v3(0, 0.35 + r() * 0.6, 0));
    const w = len * 0.55;
    b.quad(tip.clone().addScaledVector(tan, -w), tip.clone().addScaledVector(tan, w), c0.clone().addScaledVector(tan, w), c0.clone().addScaledVector(tan, -w), ATLAS.needle, () => out.clone().multiplyScalar(0.35).add(v3(0, 0.94, 0)).normalize(), (q) => dark.clone().lerp(light, Math.min(1, q.y * 1.3 + 0.1)));
  }
  return b.build();
}

/** 岩: 角ばった塊。面ごとの明るさを頂点色で付ける */
function rock(seed: number, detail: boolean): THREE.BufferGeometry {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(0.5, detail ? 1 : 0);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const p = v3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    const h = Math.sin(p.x * 37.1 + seed) * Math.cos(p.y * 29.3 + seed * 1.7) * Math.sin(p.z * 31.7 + seed * 0.6);
    p.multiplyScalar(1 + 0.3 * h);
    pos.setXYZ(i, p.x * (1 + r() * 0.0), p.y * 0.62, p.z);
  }
  g.translate(0, 0.2, 0);
  g.computeVertexNormals();
  const base = C(0x8e8c88).lerp(C(0x6f6a60), r());
  const moss = C(0x5e8a4a);
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const uv = new Float32Array(pos.count * 2);
  const [su, sv] = atlasUv(ATLAS.solid, 0.5, 0.5);
  const n = v3();
  for (let i = 0; i < pos.count; i += 1) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = base.clone().multiplyScalar(0.72 + 0.28 * Math.max(0, n.y)).lerp(moss, n.y > 0.7 && p.y > 0.3 ? 0.22 : 0);
    col.set([c.r, c.g, c.b], i * 3);
    uv.set([su, sv], i * 2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const BROAD: Record<'buna' | 'mizunara' | 'kaede' | 'kanba' | 'shrub', BroadSpec> = {
  // ブナ: まっすぐ太い灰色の幹、横に広い卵形の樹冠が 3〜4 層
  buna: { trunkH: 0.5, trunkR: 0.048, lean: 0.03, bend: 0.008, bark: 0x9a978c, cards: 64, size: 0.115, sparse: 0.1, crown: (r, top) => [
    { c: v3(top.x, 0.74, top.z), rx: 0.3, ry: 0.2 },
    { c: v3(top.x + 0.16, 0.62, top.z + 0.06), rx: 0.2, ry: 0.13 },
    { c: v3(top.x - 0.17, 0.64, top.z - 0.08), rx: 0.2, ry: 0.13 },
    { c: v3(top.x + (r() - 0.5) * 0.1, 0.9, top.z), rx: 0.17, ry: 0.11 },
  ] },
  // ミズナラ: 曲がった幹、横に張る枝、いびつで低い樹冠
  mizunara: { trunkH: 0.44, trunkR: 0.05, lean: 0.14, bend: 0.03, bark: 0x4b3a2c, cards: 56, size: 0.12, sparse: 0.3, crown: (r, top) => [
    { c: v3(top.x + 0.2, 0.6, top.z), rx: 0.2, ry: 0.13 },
    { c: v3(top.x - 0.22, 0.66, top.z + 0.1), rx: 0.19, ry: 0.12 },
    { c: v3(top.x, 0.8, top.z - 0.12), rx: 0.22, ry: 0.15 },
    { c: v3(top.x - 0.05, 0.56, top.z - 0.24 * (r() + 0.4)), rx: 0.15, ry: 0.1 },
  ] },
  // カエデ: 細い幹の株立ち、小さく丸い樹冠が段になる。背は低い
  kaede: { trunkH: 0.5, trunkR: 0.03, lean: 0.2, bend: 0.015, bark: 0x5a4a3c, stems: 3, cards: 52, size: 0.095, sparse: 0.2, crown: (r, top) => [
    { c: v3(top.x + 0.17, 0.62, top.z + 0.05), rx: 0.17, ry: 0.1 },
    { c: v3(top.x - 0.16, 0.7, top.z - 0.1), rx: 0.17, ry: 0.1 },
    { c: v3(top.x + 0.02, 0.82, top.z + 0.12 * (r() - 0.5)), rx: 0.19, ry: 0.11 },
    { c: v3(top.x - 0.04, 0.54, top.z + 0.2), rx: 0.14, ry: 0.08 },
  ] },
  // ダケカンバ: 白い幹が斜めに曲がる。樹冠はまばらで透ける
  kanba: { trunkH: 0.62, trunkR: 0.036, lean: 0.3, bend: 0.045, bark: 0xe9e3d6, white: true, cards: 34, size: 0.1, sparse: 0.9, crown: (r, top) => [
    { c: v3(top.x + 0.1, 0.76, top.z), rx: 0.2, ry: 0.13 },
    { c: v3(top.x - 0.16, 0.68, top.z + 0.1 * (r() - 0.5)), rx: 0.15, ry: 0.1 },
    { c: v3(top.x + 0.02, 0.9, top.z - 0.08), rx: 0.14, ry: 0.09 },
  ] },
  // 低木（高山帯の草紅葉の中の灌木）
  shrub: { trunkH: 0.25, trunkR: 0.05, lean: 0.1, bend: 0.02, bark: 0x5a4a3c, stems: 3, cards: 26, size: 0.2, sparse: 0.2, crown: (_r, top) => [
    { c: v3(top.x, 0.55, top.z), rx: 0.42, ry: 0.3 },
    { c: v3(top.x + 0.25, 0.4, top.z + 0.1), rx: 0.28, ry: 0.2 },
  ] },
};

const CONIFER: Record<'shirabiso' | 'tsuga' | 'karamatsu' | 'sugi' | 'hinoki', ConiferSpec> = {
  // オオシラビソ: 細い尖塔。下枝が長く、枝先が垂れる
  shirabiso: { bark: 0x5b5148, radius: (t) => 0.31 * Math.pow(1 - t, 0.78) + 0.045, tiers: 11, boughs: 7, droop: 0.42, ragged: 0.3, topLean: 0.02, firstY: 0.14, missing: 0.08 },
  // コメツガ: 樹頂が傾き、枝が不ぞろいに横へ伸びる。やや丸い
  tsuga: { bark: 0x4a382a, radius: (t) => 0.36 * Math.pow(Math.sin(Math.min(1, t * 0.9 + 0.12) * Math.PI), 0.7) * (1 - 0.35 * t) + 0.07, tiers: 9, boughs: 7, droop: 0.22, ragged: 0.6, topLean: 0.16, firstY: 0.24, missing: 0.16 },
  // カラマツ: 細く高い。枝は疎らで水平、葉は軽い
  karamatsu: { bark: 0x5d4636, radius: (t) => 0.25 * Math.pow(1 - t, 0.9) + 0.04, tiers: 10, boughs: 6, droop: 0.08, ragged: 0.5, topLean: 0.03, firstY: 0.3, missing: 0.3 },
  // スギ（植林）: まっすぐで細長い円錐。下枝は打たれて幹が見え、枝は密で先がやや垂れる。樹皮は赤褐色
  sugi: { bark: 0x6e4430, radius: (t) => 0.17 * Math.pow(1 - t, 0.85) + 0.03, tiers: 13, boughs: 8, droop: 0.18, ragged: 0.18, topLean: 0.01, firstY: 0.38, missing: 0.05 },
  // ヒノキ（植林）: スギより丸みのある円錐。枝は水平に広がり、葉は濃い青緑
  hinoki: { bark: 0x6a4a3a, radius: (t) => 0.24 * Math.pow(Math.sin(Math.min(1, t * 0.8 + 0.2) * Math.PI), 0.6) * (1 - 0.45 * t) + 0.04, tiers: 11, boughs: 8, droop: 0.1, ragged: 0.22, topLean: 0.02, firstY: 0.34, missing: 0.06 },
};

export interface TreeShapes {
  geo: Record<TreeKind, THREE.BufferGeometry[]>;
}

/** 季節ごとの葉の色（docs/19 §3 のパレット） */
function palettes(season: string): Record<'buna' | 'mizunara' | 'kaede' | 'kanba' | 'shrub' | 'karamatsu', THREE.Color[]> {
  if (season === 'autumn') {
    return {
      buna: [C(0xe8b92f), C(0xdb9a2b), C(0xdb7a2b)],
      mizunara: [C(0xdb7a2b), C(0xb8622a), C(0xc98f38)],
      kaede: [C(0xc2402e), C(0xd4502c), C(0xa8322a)],
      kanba: [C(0xf0cc3a), C(0xe8b92f)],
      shrub: [C(0xc2402e), C(0xdb7a2b), C(0xb58a4a)],
      karamatsu: [C(0xe0a92e)],
    };
  }
  const g = season === 'spring' ? [C(0x9ccf5a), C(0x86c04e), C(0xb3d76a)] : [C(0x4f8f3e), C(0x5e9a46), C(0x437f3a)];
  return { buna: g, mizunara: [g[2]!, g[0]!], kaede: [g[1]!, C(0x6aa84c)], kanba: [C(0x7fb64e), g[0]!], shrub: [C(0x5e8a4a), g[1]!], karamatsu: [C(0x7fae4c)] };
}

export function treeShapes(season: string, detail: boolean): TreeShapes {
  const winter = season === 'winter';
  const pal = palettes(season);
  const two = <T,>(f: (i: number) => T): T[] => Array.from({ length: VARIANTS }, (_, i) => f(i));
  return {
    geo: {
      buna: two((i) => broadleaf(101 + i * 17, detail, BROAD.buna, pal.buna, winter)),
      mizunara: two((i) => broadleaf(131 + i * 19, detail, BROAD.mizunara, pal.mizunara, winter)),
      kaede: two((i) => broadleaf(161 + i * 23, detail, BROAD.kaede, pal.kaede, winter)),
      kanba: two((i) => broadleaf(191 + i * 29, detail, BROAD.kanba, pal.kanba, winter)),
      shrub: two((i) => broadleaf(221 + i * 31, detail, BROAD.shrub, pal.shrub, winter)),
      shirabiso: two((i) => conifer(301 + i * 13, detail, CONIFER.shirabiso, C(0x2f5d45), false)),
      tsuga: two((i) => conifer(331 + i * 11, detail, CONIFER.tsuga, C(0x34603c), false)),
      karamatsu: two((i) => conifer(361 + i * 7, detail, CONIFER.karamatsu, pal.karamatsu[0]!, winter)),
      sugi: two((i) => conifer(371 + i * 13, detail, CONIFER.sugi, C(0x34592f), false)),
      hinoki: two((i) => conifer(381 + i * 17, detail, CONIFER.hinoki, C(0x284f3f), false)),
      haimatsu: two((i) => creeping(401 + i * 5, detail, C(0x5e8a4a))),
      rock: two((i) => rock(501 + i * 3, detail)),
    },
  };
}

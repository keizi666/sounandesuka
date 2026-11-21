/**
 * 野生動物の模型（熊・ヒグマ・鹿・カモシカ・イノシシ・サル）。登山者の人形（figureModel.ts）と同じ作り方:
 * 距離関数のなめらかな和を Marching Cubes で 1 つのメッシュにし、骨にスキニングする。輪郭線は背面法線法。
 * 寸法は実物のメートル（足元が原点、正面が +z）。人形と同じく頭をやや大きめにした、玩具のような形。
 *   root → body（胴の中心）→ neck → head / body → tail / body → 脚 4 本（upper → lower → foot）
 */
import * as THREE from 'three';
import type { AnimalSpecies } from '../sim/types';
import { outlineMaterial } from './figureModel';
import { meshSdf, type Prim, type SdfMesh } from './sdfMesh';

/** 色の区分 */
const R = { fur: 0, dark: 1, light: 2, face: 3, horn: 4 } as const;

interface Spec {
  /** 胴の長さ・胴の半径（横・縦）・肩の高さ */
  len: number;
  rx: number;
  ry: number;
  shoulderH: number;
  legR: number;
  neckLen: number;
  /** 首の傾き（水平から上へ、ラジアン） */
  neckUp: number;
  neckR: number;
  headR: number;
  snoutLen: number;
  snoutR: number;
  earR: number;
  /** 耳の位置（0 = 頭の横、1 = 頭のてっぺん） */
  earUp: number;
  tailLen: number;
  tailR: number;
  colors: [number, number, number, number, number];
  hump?: boolean;
  crescent?: boolean;
  rump?: boolean;
  belly?: boolean;
  antlers?: boolean;
  horns?: boolean;
  /** サル: 顔とお尻が赤い・手足が長い */
  primate?: boolean;
}

const SPECS: Record<AnimalSpecies, Spec> = {
  bear: { len: 1.15, rx: 0.3, ry: 0.32, shoulderH: 0.72, legR: 0.1, neckLen: 0.2, neckUp: 0.15, neckR: 0.16, headR: 0.2, snoutLen: 0.13, snoutR: 0.08, earR: 0.065, earUp: 0.9, tailLen: 0.06, tailR: 0.04, colors: [0x1d1b1e, 0x121014, 0xe9e3d2, 0x6b5a4c, 0x000000], crescent: true },
  brownBear: { len: 1.6, rx: 0.42, ry: 0.45, shoulderH: 1.05, legR: 0.14, neckLen: 0.28, neckUp: 0.05, neckR: 0.22, headR: 0.26, snoutLen: 0.18, snoutR: 0.1, earR: 0.075, earUp: 0.9, tailLen: 0.07, tailR: 0.05, colors: [0x5b3e27, 0x3a281b, 0x7a5a3c, 0x8a6a4a, 0x000000], hump: true },
  deer: { len: 0.95, rx: 0.19, ry: 0.23, shoulderH: 0.88, legR: 0.045, neckLen: 0.42, neckUp: 0.95, neckR: 0.08, headR: 0.12, snoutLen: 0.16, snoutR: 0.055, earR: 0.06, earUp: 0.75, tailLen: 0.13, tailR: 0.04, colors: [0x6e5a46, 0x2a221c, 0xf1ece2, 0x5a4838, 0xd8cbb0], rump: true, belly: true },
  serow: { len: 0.85, rx: 0.2, ry: 0.25, shoulderH: 0.74, legR: 0.055, neckLen: 0.3, neckUp: 0.6, neckR: 0.12, headR: 0.13, snoutLen: 0.13, snoutR: 0.065, earR: 0.055, earUp: 0.75, tailLen: 0.07, tailR: 0.035, colors: [0x4b4743, 0x242120, 0xc9c0b0, 0x3e3a36, 0x1d1b1a], horns: true, belly: true },
  boar: { len: 0.95, rx: 0.24, ry: 0.3, shoulderH: 0.68, legR: 0.055, neckLen: 0.12, neckUp: -0.1, neckR: 0.2, headR: 0.17, snoutLen: 0.22, snoutR: 0.085, earR: 0.05, earUp: 0.85, tailLen: 0.16, tailR: 0.025, colors: [0x3f3329, 0x1f1915, 0x5a4a3e, 0x8a6e62, 0xe8e0cc], hump: true },
  monkey: { len: 0.42, rx: 0.14, ry: 0.16, shoulderH: 0.46, legR: 0.045, neckLen: 0.08, neckUp: 0.6, neckR: 0.08, headR: 0.11, snoutLen: 0.03, snoutR: 0.06, earR: 0.035, earUp: 0.35, tailLen: 0.08, tailR: 0.03, colors: [0x8c7862, 0x6a5848, 0xb3a28c, 0xd4736a, 0x000000], primate: true },
};

export interface AnimalLeg {
  upper: THREE.Bone;
  lower: THREE.Bone;
  foot: THREE.Bone;
  front: boolean;
  side: 1 | -1;
}

export interface AnimalRig {
  root: THREE.Group;
  body: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  tail: THREE.Bone;
  legs: AnimalLeg[];
  spec: Spec;
  /** 胴の中心の高さ（結合姿勢） */
  bodyY: number;
  materials: THREE.Material[];
  litMaterials: THREE.MeshStandardMaterial[];
  dispose(): void;
}

interface Skel {
  root: THREE.Group;
  body: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  tail: THREE.Bone;
  legs: AnimalLeg[];
  bones: THREE.Bone[];
  bodyY: number;
  upperLen: number;
  lowerLen: number;
}

function buildSkel(s: Spec): Skel {
  const bones: THREE.Bone[] = [];
  const bone = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const root = new THREE.Group();
  const bodyY = s.shoulderH - s.ry * 0.85;
  const body = bone(root, 0, bodyY, 0);
  const neck = bone(body, 0, s.ry * 0.45, s.len * 0.4);
  const head = bone(neck, 0, Math.sin(s.neckUp) * s.neckLen, Math.cos(s.neckUp) * s.neckLen);
  const tail = bone(body, 0, s.ry * 0.35, -s.len * 0.5);
  const hipY = -s.ry * 0.35;
  const legLen = bodyY + hipY;
  const upperLen = legLen * 0.52;
  const lowerLen = legLen - upperLen;
  const legs: AnimalLeg[] = [];
  for (const front of [true, false]) {
    for (const side of [1, -1] as const) {
      const upper = bone(body, side * s.rx * 0.6, hipY, (front ? 1 : -1) * s.len * 0.33);
      const lower = bone(upper, 0, -upperLen, 0);
      const foot = bone(lower, 0, -lowerLen, 0);
      legs.push({ upper, lower, foot, front, side });
    }
  }
  return { root, body, neck, head, tail, legs, bones, bodyY, upperLen, lowerLen };
}

function prims(sk: Skel, s: Spec): Prim[] {
  const out: Prim[] = [];
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const idx = (b: THREE.Bone): number => sk.bones.indexOf(b);
  const inv = (b: THREE.Object3D): THREE.Matrix4 => new THREE.Matrix4().copy(b.matrixWorld).invert();
  const cap = (b: THREE.Bone, a: THREE.Vector3, bb: THREE.Vector3, ra: number, rb: number, region: number, k: number): void => {
    out.push({ kind: 'capsule', inv: inv(b), a, b: bb, ra, rb, region, bone: idx(b), k });
  };
  const ell = (b: THREE.Bone, c: THREE.Vector3, r: THREE.Vector3, region: number, k: number): void => {
    const m = new THREE.Matrix4().copy(b.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    out.push({ kind: 'ellipsoid', inv: m.invert(), r, region, bone: idx(b), k });
  };
  const L = s.len;
  // 胴（前を少し太く）
  ell(sk.body, v(0, 0, -L * 0.08), v(s.rx, s.ry * 0.92, L * 0.42), R.fur, 0.04);
  ell(sk.body, v(0, s.ry * 0.08, L * 0.2), v(s.rx * 1.05, s.ry, L * 0.3), R.fur, 0.06);
  if (s.hump) ell(sk.body, v(0, s.ry * 0.55, L * 0.22), v(s.rx * 0.75, s.ry * 0.5, L * 0.2), R.fur, 0.08);
  if (s.belly) ell(sk.body, v(0, -s.ry * 0.55, 0), v(s.rx * 0.7, s.ry * 0.38, L * 0.3), R.light, 0.03);
  if (s.rump) ell(sk.body, v(0, s.ry * 0.12, -L * 0.45), v(s.rx * 0.55, s.ry * 0.5, 0.06), R.light, 0.015);
  // ツキノワグマの胸の白い三日月（V の字）
  if (s.crescent) for (const sx of [-1, 1]) cap(sk.body, v(sx * s.rx * 0.62, s.ry * 0.3, L * 0.43), v(0, -s.ry * 0.12, L * 0.5), 0.032, 0.03, R.light, 0.012);
  if (s.primate) ell(sk.body, v(0, -s.ry * 0.2, -L * 0.5), v(s.rx * 0.55, s.ry * 0.45, 0.04), R.face, 0.02);
  // 首と頭
  const headAt = sk.head.position.clone();
  cap(sk.neck, v(0, 0, -s.neckR * 0.3), headAt.clone().multiplyScalar(0.9), s.neckR, s.neckR * 0.85, R.fur, 0.05);
  const H = s.headR;
  ell(sk.head, v(0, H * 0.1, H * 0.15), v(H * 0.95, H * 0.92, H), s.primate ? R.fur : R.fur, 0.04);
  // 鼻づら（下向きに少し傾ける）。サルは平らな赤い顔
  if (s.primate) {
    ell(sk.head, v(0, H * 0.02, H * 0.78), v(H * 0.62, H * 0.6, H * 0.32), R.face, 0.02);
  } else {
    cap(sk.head, v(0, -H * 0.1, H * 0.6), v(0, -H * 0.28, H * 0.6 + s.snoutLen), s.snoutR * 1.25, s.snoutR, s.horns || s.antlers ? R.fur : R.face, 0.05);
    ell(sk.head, v(0, -H * 0.22, H * 0.62 + s.snoutLen), v(s.snoutR * 0.9, s.snoutR * 0.7, s.snoutR * 0.45), R.dark, 0.015);
  }
  // 耳
  for (const sx of [-1, 1]) {
    const ex = sx * H * (0.95 - s.earUp * 0.45);
    const ey = H * (0.15 + s.earUp * 0.75);
    ell(sk.head, v(ex, ey, -H * 0.05), v(s.earR * (s.primate ? 0.5 : 0.75), s.earR * (s.antlers || s.horns ? 1.4 : 1), s.earR * 0.5), R.fur, 0.02);
  }
  // 脚と足
  for (const l of sk.legs) {
    const ru = s.legR * (l.front ? 1 : 1.15);
    cap(l.upper, v(0, s.legR * 0.8, 0), v(0, -sk.upperLen, 0), ru * 1.35, ru, R.fur, 0.06);
    cap(l.lower, v(0, 0, 0), v(0, -sk.lowerLen + s.legR * 0.5, 0), ru * 0.85, ru * 0.7, s.primate ? R.fur : R.fur, 0.03);
    ell(l.foot, v(0, s.legR * 0.35, s.legR * (s.primate ? 0.6 : 0.3)), v(ru * 0.85, s.legR * 0.45, ru * (s.primate ? 1.4 : 1.05)), R.dark, 0.02);
  }
  // 尻尾
  cap(sk.tail, v(0, 0, 0), v(0, -s.tailLen * 0.55, -s.tailLen), s.tailR, s.tailR * 0.7, s.rump ? R.light : R.fur, 0.03);
  return out;
}

const meshCache = new Map<AnimalSpecies, { m: SdfMesh; skel: () => Skel }>();

function paint(regions: Uint8Array, palette: THREE.Color[]): Float32Array {
  const out = new Float32Array(regions.length * 3);
  for (let i = 0; i < regions.length; i += 1) {
    const c = palette[regions[i]!] ?? palette[0]!;
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

/** 角（枝角・短い角）と目は、メッシュとは別の形として頭の骨に付ける */
function addHeadParts(head: THREE.Bone, s: Spec, stag: boolean, mats: THREE.Material[], lit: THREE.MeshStandardMaterial[]): void {
  const H = s.headR;
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x141014 });
  mats.push(eyeMat);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(H * 0.12, 10, 8), eyeMat);
    e.position.set(sx * H * (s.primate ? 0.3 : 0.55), H * 0.25, H * (s.primate ? 0.95 : 0.72));
    head.add(e);
  }
  const hornMat = new THREE.MeshStandardMaterial({ color: s.colors[4], roughness: 0.7 });
  mats.push(hornMat);
  lit.push(hornMat);
  if (s.horns) {
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(H * 0.13, H * 0.75, 8), hornMat);
      h.position.set(sx * H * 0.3, H * 1.05, -H * 0.05);
      h.rotation.x = -0.45;
      h.castShadow = true;
      head.add(h);
    }
  }
  if (s.antlers && stag) {
    // 雄の枝角（3 本の枝の短い角。秋の雄）
    const r = H * 0.07;
    const seg = (parent: THREE.Object3D, len: number, rx: number, rz: number): THREE.Object3D => {
      const g = new THREE.Group();
      g.rotation.set(rx, 0, rz);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 6), hornMat);
      m.position.y = len / 2;
      m.castShadow = true;
      g.add(m);
      const tip = new THREE.Object3D();
      tip.position.y = len;
      g.add(tip);
      parent.add(g);
      return tip;
    };
    for (const sx of [-1, 1]) {
      const base = new THREE.Object3D();
      base.position.set(sx * H * 0.35, H * 0.9, -H * 0.1);
      head.add(base);
      const t1 = seg(base, H * 1.4, -0.35, -sx * 0.45);
      seg(base, H * 0.8, 0.7, -sx * 0.2);
      const t2 = seg(t1, H * 1.1, -0.2, sx * 0.2);
      seg(t1, H * 0.7, 0.6, -sx * 0.3);
      seg(t2, H * 0.5, 0.4, sx * 0.1);
    }
  }
}

/** 模型を作る。stag: 雄の鹿（枝角あり） */
export function buildAnimal(species: AnimalSpecies, stag: boolean, tint: number): AnimalRig {
  const s = SPECS[species];
  let hit = meshCache.get(species);
  if (!hit) {
    const sk0 = buildSkel(s);
    sk0.root.updateMatrixWorld(true);
    hit = { m: meshSdf(prims(sk0, s), Math.max(0.012, s.len * 0.022), true), skel: () => buildSkel(s) };
    meshCache.set(species, hit);
  }
  const sk = hit.skel();
  sk.root.updateMatrixWorld(true);
  const palette = s.colors.map((c) => new THREE.Color(c).offsetHSL(0, 0, tint));
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) geo.setAttribute(name, hit.m.geometry.getAttribute(name));
  geo.setAttribute('color', new THREE.BufferAttribute(paint(hit.m.regions, palette), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, s.shoulderH * 0.5, 0), s.len * 1.5);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.castShadow = true;
  skinned.frustumCulled = false;
  const skeleton = new THREE.Skeleton(sk.bones);
  sk.root.add(skinned);
  skinned.bind(skeleton);
  const outMat = outlineMaterial(Math.max(0.006, s.len * 0.012));
  const outline = new THREE.SkinnedMesh(geo, outMat);
  outline.frustumCulled = false;
  sk.root.add(outline);
  outline.bind(skeleton, skinned.bindMatrix);
  const materials: THREE.Material[] = [mat, outMat];
  const litMaterials = [mat];
  addHeadParts(sk.head, s, stag, materials, litMaterials);
  return {
    root: sk.root,
    body: sk.body,
    neck: sk.neck,
    head: sk.head,
    tail: sk.tail,
    legs: sk.legs,
    spec: s,
    bodyY: sk.bodyY,
    materials,
    litMaterials,
    dispose() {
      geo.dispose();
      for (const m of materials) m.dispose();
      sk.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry !== geo) o.geometry.dispose();
      });
    },
  };
}

/** 種類の寸法（動き・並びの計算用） */
export function animalSpec(species: AnimalSpecies): Spec {
  return SPECS[species];
}

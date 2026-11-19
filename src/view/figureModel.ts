/**
 * 登山者の人形のモデル（docs/19 §6）。4.5 頭身で、頭・手・登山靴をやや大きくした、可愛さと登山者らしさを両立する形。
 * 体は距離関数（SDF）のなめらかな和を Marching Cubes でメッシュにした、1 つの連続したメッシュ（sdfMesh.ts）。
 * 骨（THREE.Bone）にスキニングし、figureMotion.ts が骨の角度を与える。高さ 1.0 に正規化、足元が原点、正面が +z、+x が左手側。
 *   root → body（倒れるときに回す）→ hips → spine（胸）→ neck（頭）/ 肩 → 肘 → 手 / hips → 股 → 膝 → 足首
 * 装備（ザック・帽子・フード・ストック・ヘッドランプ）は形として作り、骨に付ける。輪郭線は背面法線法。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ClimberDef } from '../sim/types';
import { meshSdf, type Prim, type SdfMesh } from './sdfMesh';

export interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
}

/** 寸法（身長 1.0。4.5 頭身） */
export const DIM = {
  ankleY: 0.048,
  shin: 0.165,
  thigh: 0.19,
  hipsY: 0.418,
  hipHalf: 0.062,
  spineY: 0.03,
  shoulderHalf: 0.132,
  shoulderY: 0.232,
  upperArm: 0.125,
  foreArm: 0.112,
  neckY: 0.288,
  headR: 0.115,
};

/** 色の区分 */
const R = { skin: 0, jacket: 1, pants: 2, boots: 3, glove: 4, hat: 5, hair: 6, strap: 7, trim: 8, pack: 9, packDark: 10 } as const;

export interface FigureRig {
  root: THREE.Group;
  body: THREE.Object3D;
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  neck: THREE.Object3D;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  hood: THREE.Object3D;
  hat: THREE.Object3D;
  packCover: THREE.Object3D;
  bivy: THREE.Mesh;
  poleL: THREE.Object3D | null;
  poleR: THREE.Object3D | null;
  lamp: THREE.Mesh | null;
  lampBeam: THREE.Mesh | null;
  marker: THREE.Group;
  ring: THREE.Mesh;
  /** 照明を受ける素材（霧・夜・トゥーン調を注入する対象） */
  litMaterials: THREE.MeshStandardMaterial[];
  /** 見た目の更新: 雨具（0..1）、灰色化（0..1）、濡れ（0..1） */
  setLook(rain: number, grey: number, wet: number): void;
  /** 目を閉じる（意識がないとき） */
  setEyes(open: boolean): void;
  dims: typeof DIM;
  dispose(): void;
}

function hsl(color: THREE.Color, ds: number, dl: number): THREE.Color {
  const h = { h: 0, s: 0, l: 0 };
  color.getHSL(h);
  return new THREE.Color().setHSL(h.h, Math.min(1, Math.max(0, h.s + ds)), Math.min(1, Math.max(0, h.l + dl)));
}

/** ID から決まる 0〜1 の値（人ごとの違い） */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

interface Skeleton {
  root: THREE.Group;
  body: THREE.Bone;
  hips: THREE.Bone;
  spine: THREE.Bone;
  neck: THREE.Bone;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  bones: THREE.Bone[];
}

function buildSkeleton(build: number): Skeleton {
  const D = DIM;
  const bones: THREE.Bone[] = [];
  const bone = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const root = new THREE.Group();
  const body = bone(root, 0, 0, 0);
  const hips = bone(body, 0, D.hipsY, 0);
  const spine = bone(hips, 0, D.spineY, 0);
  const neck = bone(spine, 0, D.neckY, 0);
  const arm = (side: 1 | -1): Limb => {
    const upper = bone(spine, side * D.shoulderHalf * build, D.shoulderY, 0);
    const lower = bone(upper, 0, -D.upperArm, 0);
    const end = bone(lower, 0, -D.foreArm, 0);
    return { upper, lower, end };
  };
  const leg = (side: 1 | -1): Limb => {
    const upper = bone(hips, side * D.hipHalf * build, -0.015, 0);
    const lower = bone(upper, 0, -D.thigh, 0);
    const end = bone(lower, 0, -D.shin, 0);
    return { upper, lower, end };
  };
  return { root, body, hips, spine, neck, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), bones };
}

interface BodyOpts {
  build: number;
  female: boolean;
  hat: boolean;
  helmet: boolean;
  gloves: boolean;
}

/** 体の部品（結合姿勢の骨の位置に置く） */
function bodyPrims(sk: Skeleton, o: BodyOpts): Prim[] {
  const prims: Prim[] = [];
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const idx = (b: THREE.Object3D): number => sk.bones.indexOf(b as THREE.Bone);
  const inv = (b: THREE.Object3D): THREE.Matrix4 => new THREE.Matrix4().copy(b.matrixWorld).invert();
  const cap = (b: THREE.Object3D, a: THREE.Vector3, bb: THREE.Vector3, ra: number, rb: number, region: number, k = 0.03, extra: Partial<Prim> = {}): void => {
    prims.push({ kind: 'capsule', inv: inv(b), a, b: bb, ra, rb, region, bone: idx(b), k, ...extra });
  };
  const ell = (b: THREE.Object3D, c: THREE.Vector3, r: THREE.Vector3, region: number, k = 0.03, extra: Partial<Prim> = {}): void => {
    const m = new THREE.Matrix4().copy(b.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    prims.push({ kind: 'ellipsoid', inv: m.invert(), r, region, bone: idx(b), k, ...extra });
  };
  const w = o.build * (o.female ? 0.95 : 1);
  const D = DIM;
  // 腰と胴（短めでずんぐり）。ジャケットは腰まで覆う
  ell(sk.hips, v(0, -0.012, 0), v(0.108 * w, 0.078, 0.09 * w), R.pants);
  ell(sk.spine, v(0, 0.045, 0.004), v(0.118 * w, 0.1, 0.096 * w), R.jacket, 0.04, { wrinkle: 0.0016 });
  ell(sk.spine, v(0, 0.15, 0.002), v(0.128 * w, 0.12, 0.1 * w), R.jacket, 0.05);
  cap(sk.spine, v(-0.085 * w, 0.228, 0), v(0.085 * w, 0.228, 0), 0.058, 0.058, R.jacket, 0.05);
  // 裾と襟（濃い色）
  ell(sk.spine, v(0, -0.03, 0.003), v(0.122 * w, 0.034, 0.1 * w), R.trim, 0.02);
  cap(sk.spine, v(0, 0.262, 0.004), v(0, 0.296, 0.006), 0.05, 0.046, R.trim, 0.02);
  // 首と頭
  cap(sk.neck, v(0, -0.02, 0), v(0, 0.04, 0), 0.036, 0.036, R.skin, 0.02);
  ell(sk.neck, v(0, 0.135, 0.008), v(D.headR * 0.98, D.headR * 1.04, D.headR * 0.98), R.skin, 0.02);
  // 鼻: 顔はアイコンの絵を貼るので、立体の鼻は頭の中へ小さく縮めて隠す（体の色は部位の順番で塗るので、抜くと帽子などの色がずれる）
  ell(sk.neck, v(0, 0.12, 0.03), v(0.004, 0.004, 0.004), R.skin, 0.004);
  for (const sx of [-1, 1]) ell(sk.neck, v(sx * 0.113, 0.128, 0.004), v(0.014, 0.024, 0.02), R.skin, 0.012); // 耳
  if (o.helmet) {
    ell(sk.neck, v(0, 0.178, 0.004), v(0.134, 0.098, 0.136), R.hat, 0.006, { cutY: -0.035 });
  } else if (o.hat) {
    // ニット帽: 折り返しと、てっぺんのぼんぼん
    ell(sk.neck, v(0, 0.19, 0), v(0.123, 0.092, 0.123), R.hat, 0.01, { cutY: -0.04 });
    ell(sk.neck, v(0, 0.158, 0), v(0.128, 0.022, 0.128), R.hat, 0.01);
    ell(sk.neck, v(0, 0.292, -0.004), v(0.034, 0.034, 0.034), R.hat, 0.014);
  } else {
    ell(sk.neck, v(0, 0.178, -0.014), v(0.121, 0.094, 0.121), R.hair, 0.012, { cutY: -0.02 });
    if (o.female) ell(sk.neck, v(0, 0.1, -0.1), v(0.07, 0.07, 0.05), R.hair, 0.02);
  }
  // 腕と手（手は大きめのミトン形）
  for (const a of [sk.armL, sk.armR]) {
    cap(a.upper, v(0, 0.005, 0), v(0, -D.upperArm, 0), 0.052 * w, 0.045 * w, R.jacket, 0.035);
    cap(a.lower, v(0, 0, 0), v(0, -D.foreArm + 0.012, 0), 0.044 * w, 0.041 * w, R.jacket, 0.02);
    ell(a.end, v(0, -0.036, 0.004), v(0.04, 0.05, 0.046), o.gloves ? R.glove : R.skin, 0.014);
    ell(a.end, v(0.0, -0.03, 0.04), v(0.016, 0.026, 0.018), o.gloves ? R.glove : R.skin, 0.014); // 親指
  }
  // 脚と登山靴（靴は大きく、靴底は平ら）
  for (const l of [sk.legL, sk.legR]) {
    cap(l.upper, v(0, 0.005, 0), v(0, -D.thigh, 0), 0.07 * w, 0.058 * w, R.pants, 0.03);
    cap(l.lower, v(0, 0, 0), v(0, -D.shin + 0.03, 0), 0.056 * w, 0.05 * w, R.pants, 0.02);
    cap(l.end, v(0, 0.04, 0), v(0, 0.0, 0.004), 0.053, 0.056, R.boots, 0.012);
    cap(l.end, v(0, -0.004, 0), v(0, -0.008, 0.078), 0.058, 0.052, R.boots, 0.02, { cutY: -D.ankleY + 0.004 });
  }
  // ザックの肩ベルト（胸の前を通る）
  for (const sx of [-1, 1]) {
    cap(sk.spine, v(sx * 0.066 * w, 0.262, -0.02), v(sx * 0.08 * w, 0.2, 0.086 * w), 0.0125, 0.0125, R.strap, 0.008);
    cap(sk.spine, v(sx * 0.08 * w, 0.2, 0.086 * w), v(sx * 0.094 * w, 0.06, 0.082 * w), 0.0125, 0.0125, R.strap, 0.008);
    cap(sk.spine, v(sx * 0.094 * w, 0.06, 0.082 * w), v(sx * 0.1 * w, 0.01, 0.0), 0.012, 0.012, R.strap, 0.008);
  }
  return prims;
}

const bodyCache = new Map<string, SdfMesh>();
const packCache = new Map<string, SdfMesh>();

/** ザック（角丸の箱をなめらかにつないだ形。雨蓋・前ポケット・サイドポケット） */
function packMesh(pk: number): SdfMesh {
  const key = pk.toFixed(2);
  const hit = packCache.get(key);
  if (hit) return hit;
  const at = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z).invert();
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const prims: Prim[] = [
    { kind: 'box', inv: at(0, 0, 0), r: v(0.092 * pk, 0.135 * pk, 0.062 * pk), round: 0.045 * pk, region: R.pack, bone: 0, k: 0.02 },
    { kind: 'box', inv: at(0, 0.13 * pk, -0.004), r: v(0.084 * pk, 0.04 * pk, 0.064 * pk), round: 0.03 * pk, region: R.packDark, bone: 0, k: 0.012 },
    { kind: 'box', inv: at(0, -0.035 * pk, -0.062 * pk), r: v(0.058 * pk, 0.062 * pk, 0.024 * pk), round: 0.02 * pk, region: R.packDark, bone: 0, k: 0.014 },
    { kind: 'capsule', inv: at(0, 0, 0), a: v(-0.092 * pk, -0.1 * pk, 0), b: v(-0.092 * pk, -0.01 * pk, 0), ra: 0.027 * pk, rb: 0.024 * pk, region: R.packDark, bone: 0, k: 0.012 },
    { kind: 'capsule', inv: at(0, 0, 0), a: v(0.092 * pk, -0.1 * pk, 0), b: v(0.092 * pk, -0.01 * pk, 0), ra: 0.027 * pk, rb: 0.024 * pk, region: R.packDark, bone: 0, k: 0.012 },
  ];
  const m = meshSdf(prims, 0.011, false);
  packCache.set(key, m);
  return m;
}

/** 区分ごとの色から頂点色を作る */
function paint(regions: Uint8Array, palette: THREE.Color[], target: Float32Array, grey: number): void {
  const g = 0.553;
  for (let i = 0; i < regions.length; i += 1) {
    const c = palette[regions[i]!] ?? palette[0]!;
    target[i * 3] = c.r + (g - c.r) * grey;
    target[i * 3 + 1] = c.g + (g - c.g) * grey;
    target[i * 3 + 2] = c.b + (g - c.b) * grey;
  }
}

/** 輪郭線（背面法線法）: 裏面だけを、法線の向きに少し膨らませて濃い色で描く */
function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x2a2433, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize(normal) * ${thickness.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => `hk-outline-${thickness}`;
  return m;
}

export function buildFigure(def: ClimberDef): FigureRig {
  const D = DIM;
  const color = new THREE.Color(def.color);
  // 体格は 3 段階に丸める（形を使い回すため）
  const buildRaw = Math.min(1.14, Math.max(0.9, 0.78 + def.weightKg / 280));
  const build = Math.round((buildRaw - 0.9) / 0.12) * 0.12 + 0.9;
  const opts: BodyOpts = { build, female: def.sex === 'f', hat: def.gear.hat, helmet: def.gear.helmet, gloves: def.gear.gloves !== 'none' };
  const sk = buildSkeleton(build);
  const { root, body, hips, spine, neck, armL, armR, legL, legR } = sk;

  // 結合姿勢: 腕と脚を少し開く（開かないと、腕が胴に、脚どうしが溶けてくっつく）
  armL.upper.rotation.z = 0.75;
  armR.upper.rotation.z = -0.75;
  legL.upper.rotation.z = 0.16;
  legR.upper.rotation.z = -0.16;
  root.updateMatrixWorld(true);
  const key = `${build.toFixed(2)}|${opts.female}|${opts.hat}|${opts.helmet}|${opts.gloves}`;
  let bm = bodyCache.get(key);
  if (!bm) {
    bm = meshSdf(bodyPrims(sk, opts), 0.0115, true);
    bodyCache.set(key, bm);
  }

  // 色（区分ごと）
  const PANTS = [0x2b2f3a, 0x23324a, 0x45492f, 0x57503c, 0x33302e, 0x3a3f4a];
  const jacketBase = color.clone();
  const shellBase = hsl(color, -0.05, 0.07);
  const palette: THREE.Color[] = [];
  palette[R.skin] = new THREE.Color().setHSL(0.07, 0.5, 0.7 + hash01(def.id, 2) * 0.08);
  palette[R.jacket] = jacketBase.clone();
  palette[R.pants] = new THREE.Color(PANTS[Math.floor(hash01(def.id, 1) * PANTS.length) % PANTS.length]!);
  palette[R.boots] = new THREE.Color(0x4a3426);
  palette[R.glove] = new THREE.Color(0x2a2d33);
  // ヘルメットもその人の色に（白一色だと誰か分からない。ユーザーの指定）。帽子より少し明るく、つやのある色
  palette[R.hat] = def.gear.helmet ? hsl(color, 0.05, 0.06) : hsl(color, -0.1, -0.08 + hash01(def.id, 5) * 0.22);
  palette[R.hair] = def.age >= 58 ? new THREE.Color(0xbdb9b2) : new THREE.Color().setHSL(0.08, 0.35, 0.1 + hash01(def.id, 3) * 0.1);
  const packC = new THREE.Color().setHSL((hash01(def.id, 4) * 0.5 + 0.55) % 1, 0.5, 0.36);
  palette[R.strap] = hsl(packC, -0.1, -0.14);
  palette[R.trim] = hsl(color, -0.1, -0.17);
  palette[R.pack] = packC;
  palette[R.packDark] = hsl(packC, -0.1, -0.13);

  const litMaterials: THREE.MeshStandardMaterial[] = [];
  const lit = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
    litMaterials.push(m);
    return m;
  };

  // 体（スキニング）。形と骨の重みは使い回し、色だけ人ごとに持つ
  const bodyGeo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) bodyGeo.setAttribute(name, bm.geometry.getAttribute(name));
  bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.2);
  const bodyColors = new Float32Array(bm.regions.length * 3);
  paint(bm.regions, palette, bodyColors, 0);
  const bodyColorAttr = new THREE.BufferAttribute(bodyColors, 3);
  bodyGeo.setAttribute('color', bodyColorAttr);
  const bodyMat = lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }));
  const skinned = new THREE.SkinnedMesh(bodyGeo, bodyMat);
  skinned.castShadow = true;
  skinned.frustumCulled = false;
  const skeleton = new THREE.Skeleton(sk.bones);
  root.add(skinned);
  skinned.bind(skeleton);
  const outline = new THREE.SkinnedMesh(bodyGeo, outlineMaterial(0.0085));
  outline.frustumCulled = false;
  root.add(outline);
  outline.bind(skeleton, skinned.bindMatrix);
  // 結合が済んだら、基本の姿勢（腕と脚を下ろす）に戻す
  armL.upper.rotation.z = 0;
  armR.upper.rotation.z = 0;
  legL.upper.rotation.z = 0;
  legR.upper.rotation.z = 0;

  // 顔: 目・眉・口（頭の骨に付ける）
  const dark = new THREE.MeshBasicMaterial({ color: 0x2a2433 });
  const eyes: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.0165, 12, 10), dark, sx * 0.044, 0.13, 0.108);
    eye.scale.set(0.82, 1.2, 0.5);
    eye.castShadow = false;
    eye.userData['faceFeature'] = true;
    neck.add(eye);
    eyes.push(eye);
    const glint = mesh(new THREE.SphereGeometry(0.005, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.004, 0.006, 0.014);
    glint.castShadow = false;
    eye.add(glint);
    const brow = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.004), dark, sx * 0.044, 0.164, 0.108);
    brow.rotation.z = sx * -0.1;
    brow.castShadow = false;
    brow.userData['faceFeature'] = true;
    neck.add(brow);
    const cheek = mesh(new THREE.SphereGeometry(0.017, 10, 8), new THREE.MeshBasicMaterial({ color: 0xf2a08c, transparent: true, opacity: 0.55 }), sx * 0.07, 0.098, 0.094);
    cheek.scale.set(1, 0.7, 0.3);
    cheek.castShadow = false;
    cheek.userData['faceFeature'] = true;
    neck.add(cheek);
  }
  const mouth = mesh(new THREE.BoxGeometry(0.02, 0.005, 0.004), dark, 0, 0.082, 0.119);
  mouth.castShadow = false;
  mouth.userData['faceFeature'] = true;
  neck.add(mouth);

  // 帽子は体のメッシュの一部。表示の切替用に空の入れ物を持つ（フードをかぶると隠れる部分はない）
  const hat = new THREE.Group();
  neck.add(hat);

  // フード（雨具を着たとき）: 頭を後ろから包む
  const shellMat = lit(new THREE.MeshStandardMaterial({ color: shellBase, roughness: 0.45, side: THREE.DoubleSide }));
  const hood = new THREE.Group();
  // 球の殻の「開いた側」を顔の前へ向ける（顔のまわりだけ開く）
  const hoodShell = mesh(new THREE.SphereGeometry(D.headR * 1.19, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.7), shellMat, 0, 0.142, -0.004);
  hoodShell.rotation.x = -1.32;
  hood.add(hoodShell);
  hood.visible = false;
  neck.add(hood);

  // ヘッドランプ
  let lamp: THREE.Mesh | null = null;
  let lampBeam: THREE.Mesh | null = null;
  if (def.gear.headlamp.has) {
    const band = mesh(new THREE.TorusGeometry(D.headR * 1.04, 0.007, 6, 24), lit(new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 })), 0, 0.165, 0.004);
    band.rotation.x = Math.PI / 2;
    neck.add(band);
    const lm = new THREE.MeshStandardMaterial({ color: 0x2a2d33, emissive: 0xfff2c0, emissiveIntensity: 0, roughness: 0.3 });
    lamp = mesh(new RoundedBoxGeometry(0.036, 0.026, 0.02, 2, 0.006), lm, 0, 0.165, D.headR * 1.06);
    neck.add(lamp);
    const beamGeo = new THREE.ConeGeometry(0.32, 1.3, 20, 1, true);
    beamGeo.translate(0, -0.65, 0);
    beamGeo.rotateX(-Math.PI / 2 - 0.32);
    lampBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    lampBeam.position.set(0, 0.165, D.headR * 1.1);
    neck.add(lampBeam);
  }

  // ザック（荷物の重さで大きさが変わる。形は 3 段階）
  const pk = Math.round(Math.min(1.25, Math.max(0.85, 0.72 + def.packKg / 30)) * 5) / 5;
  const pm = packMesh(pk);
  const packGeo = new THREE.BufferGeometry();
  packGeo.setAttribute('position', pm.geometry.getAttribute('position'));
  packGeo.setAttribute('normal', pm.geometry.getAttribute('normal'));
  const packColors = new Float32Array(pm.regions.length * 3);
  paint(pm.regions, palette, packColors, 0);
  const packColorAttr = new THREE.BufferAttribute(packColors, 3);
  packGeo.setAttribute('color', packColorAttr);
  const packMat = lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const pack = new THREE.Group();
  pack.position.set(0, 0.125, -0.098 * build - 0.058 * pk);
  spine.add(pack);
  pack.add(mesh(packGeo, packMat), new THREE.Mesh(packGeo, outlineMaterial(0.0085)));
  if (def.gear.bivy !== 'none' || def.gear.tent) {
    const roll = mesh(new THREE.CapsuleGeometry(0.03 * pk, 0.13 * pk, 6, 12), lit(new THREE.MeshStandardMaterial({ color: def.gear.tent ? 0x3d6b4a : 0x7d8a99, roughness: 0.9 })), 0, 0.2 * pk, 0);
    roll.rotation.z = Math.PI / 2;
    pack.add(roll);
  }
  // ザックカバー（雨具を着たとき）
  const packCover = mesh(new RoundedBoxGeometry(0.2 * pk, 0.33 * pk, 0.15 * pk, 5, 0.06 * pk), lit(new THREE.MeshStandardMaterial({ color: 0xf0b62a, roughness: 0.5 })), 0, 0.02 * pk, -0.006);
  packCover.visible = false;
  pack.add(packCover);

  // ストック
  const metal = lit(new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.35, metalness: 0.7 }));
  const grip = lit(new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }));
  const pole = (limb: Limb): THREE.Object3D => {
    const g = new THREE.Group();
    const len = 0.5;
    g.add(mesh(new THREE.CylinderGeometry(0.006, 0.0045, len, 6), metal, 0, -len / 2 + 0.05, 0));
    g.add(mesh(new THREE.CapsuleGeometry(0.011, 0.05, 4, 8), grip, 0, 0.03, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.022, 0.003, 0.012, 8), grip, 0, -len + 0.085, 0));
    g.position.set(0, -0.036, 0.012);
    limb.end.add(g);
    return g;
  };
  const poleL = def.gear.trekkingPoles ? pole(armL) : null;
  const poleR = def.gear.trekkingPoles ? pole(armR) : null;

  // ツェルト・シート（ビバーク中に体を覆う）: 頭からかぶった布
  const bivyMat = new THREE.MeshStandardMaterial({ color: def.gear.bivy === 'none' ? 0xc9ced6 : 0xd97b1f, roughness: def.gear.bivy === 'none' ? 0.25 : 0.7, metalness: def.gear.bivy === 'none' ? 0.6 : 0, side: THREE.DoubleSide });
  litMaterials.push(bivyMat);
  const bivyGeo = new THREE.LatheGeometry(
    [[0.001, 0.6], [0.07, 0.59], [0.12, 0.55], [0.16, 0.46], [0.2, 0.3], [0.25, 0.14], [0.3, 0.03], [0.32, 0.0]].map(([r, y]) => new THREE.Vector2(r!, y!)),
    40,
  );
  {
    const pos = bivyGeo.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const low = 1 - y / 0.6;
      const f = 1 + low * (0.09 * Math.sin(a * 7 + 1.3) + 0.05 * Math.sin(a * 13 + y * 20));
      pos.setXYZ(i, x * f, y, z * f * (1 + 0.25 * low));
    }
    bivyGeo.computeVertexNormals();
  }
  const bivy = mesh(bivyGeo, bivyMat, 0, 0, 0.1);
  bivy.visible = false;
  root.add(bivy);

  // 選択の目印（頭上の矢印）と足元の輪
  const marker = new THREE.Group();
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.13, 4), new THREE.MeshBasicMaterial({ color: def.color, depthTest: false, transparent: true, opacity: 0.95 }));
  arrow.rotation.x = Math.PI;
  arrow.position.y = 1.3;
  arrow.renderOrder = 20;
  marker.add(arrow);
  root.add(marker);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.27, 32), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  root.add(ring);

  let lastRain = -1;
  let lastGrey = -1;
  const baseRough = litMaterials.map((m) => m.roughness);
  const baseColor = litMaterials.map((m) => m.color.clone());
  const GREY = new THREE.Color(0x8d8d8d);
  return {
    root, body, hips, spine, neck, armL, armR, legL, legR, hood, hat, packCover, bivy, poleL, poleR, lamp, lampBeam, marker, ring, litMaterials,
    setLook(rain, grey, wet) {
      // 色の塗り直しは、変わったときだけ（頂点色を書き換える）
      if (Math.abs(rain - lastRain) > 0.02 || Math.abs(grey - lastGrey) > 0.02) {
        lastRain = rain;
        lastGrey = grey;
        palette[R.jacket] = jacketBase.clone().lerp(shellBase, rain);
        paint(bm.regions, palette, bodyColors, grey * 0.9);
        bodyColorAttr.needsUpdate = true;
        paint(pm.regions, palette, packColors, grey * 0.9);
        packColorAttr.needsUpdate = true;
        litMaterials.forEach((m, i) => {
          if (!m.vertexColors) m.color.copy(baseColor[i]!).lerp(GREY, grey * 0.9);
        });
      }
      // 雨具は生地につやがあり、濡れるとさらにつやが出る
      litMaterials.forEach((m, i) => {
        m.roughness = Math.max(0.3, baseRough[i]! - (m === bodyMat ? 0.22 * rain : 0) - 0.3 * wet);
      });
    },
    setEyes(open) {
      for (const e of eyes) e.scale.y = open ? 1.2 : 0.16;
    },
    dims: D,
    dispose() {
      bodyGeo.dispose();
      packGeo.dispose();
      skeleton.dispose();
      for (const m of litMaterials) m.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== bodyGeo && m.geometry !== packGeo) m.geometry.dispose();
      });
    },
  };
}

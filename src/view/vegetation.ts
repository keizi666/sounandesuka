/**
 * 樹木（docs/10 §5.2）。種類ごとに枝葉の形を作り分けた InstancedMesh。
 * 近景用（幹＋葉群）と遠景用（簡略形）を距離で切り替える。秋は広葉樹が紅葉、冬は落葉。
 * 配置は植生クラスに従い、位置・大きさ・色の個体差は描画用の乱数（view では Math.random 可。ここではシード付き）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

/** 樹木の見た目の拡大率（ジオラマの模型の木はやや大きめに作る） */
export const TREE_SCALE = 2.2;

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

function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** 種類ごとの形（高さ 1 に正規化。原点は根元） */
function shapes(season: string, detail: boolean): Record<string, THREE.BufferGeometry> {
  const trunk = new THREE.Color(0x5a4330);
  const seg = detail ? 7 : 5;
  const leafB = new THREE.Color(season === 'autumn' ? 0xb8742e : 0x5e8a3c);
  const leafB2 = new THREE.Color(season === 'autumn' ? 0x9e3f24 : 0x4f7a34);
  const conifer = new THREE.Color(0x2f4f2c);
  const pine = new THREE.Color(0x4a6838);
  const shrub = new THREE.Color(0x6a7c45);

  // 広葉樹: 幹 + 枝分かれした葉群（球を 3〜4 個）
  const bTrunk = new THREE.CylinderGeometry(0.035, 0.055, 0.5, seg).translate(0, 0.25, 0);
  const bParts = [colored(bTrunk, trunk)];
  if (season !== 'winter') {
    const blobs: [number, number, number, number][] = detail
      ? [[0, 0.68, 0, 0.3], [0.17, 0.58, 0.05, 0.22], [-0.15, 0.6, -0.08, 0.22], [0.02, 0.86, 0.04, 0.2]]
      : [[0, 0.7, 0, 0.32]];
    blobs.forEach(([x, y, z, r], i) => bParts.push(colored(new THREE.IcosahedronGeometry(r, detail ? 1 : 0).translate(x, y, z), i % 2 ? leafB2 : leafB)));
  } else {
    for (const a of [0, 2.1, 4.2]) bParts.push(colored(new THREE.CylinderGeometry(0.01, 0.02, 0.4, 4).rotateZ(0.6).rotateY(a).translate(0, 0.62, 0), trunk));
  }
  // 針葉樹: 幹 + 段になった円錐
  const cParts = [colored(new THREE.CylinderGeometry(0.025, 0.04, 0.25, seg).translate(0, 0.125, 0), trunk)];
  const tiers = detail ? [[0.28, 0.42, 0.2], [0.22, 0.34, 0.45], [0.15, 0.28, 0.68]] : [[0.25, 0.85, 0.15]];
  for (const [r, h, y] of tiers) cParts.push(colored(new THREE.ConeGeometry(r!, h!, seg).translate(0, y! + h! / 2, 0), conifer));
  // ハイマツ: 低い塊
  const kParts = [colored(new THREE.IcosahedronGeometry(0.5, detail ? 1 : 0).scale(1.3, 0.45, 1.1).translate(0, 0.2, 0), pine)];
  // 低木
  const sParts = [colored(new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.7, 1).translate(0, 0.28, 0), shrub)];
  return {
    broadleaf: mergeGeometries(bParts)!,
    conifer: mergeGeometries(cParts)!,
    krummholz: mergeGeometries(kParts)!,
    shrub: mergeGeometries(sParts)!,
  };
}

interface Instance {
  kind: 'broadleaf' | 'conifer' | 'krummholz' | 'shrub';
  x: number;
  y: number;
  z: number;
  h: number;
  rot: number;
  tint: number;
}

/** 植生クラスから樹木を配置する（count はおおよその総数） */
export function placeTrees(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, count: number): Instance[] {
  const r = rng(0x7aee5 ^ map.n);
  const forest: number[] = [];
  for (let i = 0; i < map.n * map.n; i += 1) {
    const v = map.veg[i]!;
    if (v === VegClass.BROADLEAF || v === VegClass.CONIFER || v === VegClass.KRUMMHOLZ) forest.push(i);
  }
  if (forest.length === 0) return [];
  const per = count / forest.length;
  const out: Instance[] = [];
  for (const i of forest) {
    let k = Math.floor(per) + (r() < per - Math.floor(per) ? 1 : 0);
    const v = map.veg[i]!;
    while (k-- > 0) {
      const x = (-map.half + ((i % map.n) + r() - 0.5) * map.cell) * UNIT;
      const z = (-map.half + (Math.floor(i / map.n) + r() - 0.5) * map.cell) * UNIT;
      let kind: Instance['kind'] = v === VegClass.BROADLEAF ? 'broadleaf' : v === VegClass.CONIFER ? 'conifer' : 'krummholz';
      if (v === VegClass.BROADLEAF && r() < 0.12) kind = 'conifer';
      if (v === VegClass.KRUMMHOLZ && r() < 0.2) kind = 'shrub';
      const hM = kind === 'krummholz' ? 2 + r() * 1.5 : kind === 'shrub' ? 1.5 + r() : kind === 'conifer' ? 14 + r() * 10 : 12 + r() * 8;
      out.push({ kind, x, y: heightAt(x, z) - 0.0005, z, h: hM * UNIT * TREE_SCALE * s.vExag, rot: r() * Math.PI * 2, tint: 0.85 + r() * 0.3 });
    }
  }
  return out;
}

export interface Vegetation {
  group: THREE.Group;
  /** カメラの距離で近景・遠景を切り替える */
  update(camera: THREE.Camera): void;
}

export function buildVegetation(instances: Instance[], season: string, env: EnvUniforms, shadows: boolean): Vegetation {
  const group = new THREE.Group();
  const near = shapes(season, true);
  const far = shapes(season, false);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
  injectEnv(mat, env);
  const meshes: { near: THREE.InstancedMesh; far: THREE.InstancedMesh }[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const kind of ['broadleaf', 'conifer', 'krummholz', 'shrub'] as const) {
    const list = instances.filter((t) => t.kind === kind);
    if (list.length === 0) continue;
    const mk = (geo: THREE.BufferGeometry): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        const w = kind === 'krummholz' ? t.h * 2.2 : t.h * 0.7;
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(w, t.h, w));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setScalar(t.tint));
      });
      im.castShadow = shadows;
      im.receiveShadow = shadows;
      im.frustumCulled = false;
      return im;
    };
    const pair = { near: mk(near[kind]!), far: mk(far[kind]!) };
    group.add(pair.near, pair.far);
    meshes.push(pair);
  }
  const camPos = new THREE.Vector3();
  return {
    group,
    update(camera) {
      camera.getWorldPosition(camPos);
      // 箱庭全体を見下ろす距離では簡略形
      const nearView = camPos.length() < 2.2;
      for (const p of meshes) {
        p.near.visible = nearView;
        p.far.visible = !nearView;
      }
    },
  };
}

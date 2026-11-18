/**
 * 樹木（docs/10 §5.2）。種類ごとに枝葉の形を作り分けた InstancedMesh。
 * 近景用（幹＋葉群）と遠景用（簡略形）を距離で切り替える。秋は広葉樹が紅葉、冬は落葉。
 * 配置は植生クラスに従い、位置・大きさ・色の個体差は描画用の乱数（view では Math.random 可。ここではシード付き）。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';
import { treeShapes, type TreeKind } from './treeShapes';

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

interface Instance {
  kind: TreeKind;
  /** 変種の番号 */
  variant: number;
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
  const out: Instance[] = [];
  // 岩: 岩場・崖に多く、高山帯の草地にもまばらに置く
  const rockCells: number[] = [];
  for (let i = 0; i < map.n * map.n; i += 1) {
    const v = map.veg[i]!;
    if (v === VegClass.ROCK || v === VegClass.CLIFF || (v === VegClass.ALPINE && r() < 0.12)) rockCells.push(i);
  }
  const rocks = Math.min(rockCells.length, Math.floor(count * 0.18));
  for (let k = 0; k < rocks; k += 1) {
    const i = rockCells[Math.floor(r() * rockCells.length)]!;
    const x = (-map.half + ((i % map.n) + r() - 0.5) * map.cell) * UNIT;
    const z = (-map.half + (Math.floor(i / map.n) + r() - 0.5) * map.cell) * UNIT;
    const hM = 0.8 + r() * r() * 5;
    out.push({ kind: 'rock', variant: Math.floor(r() * 3), x, y: heightAt(x, z) - 0.0002, z, h: hM * UNIT * TREE_SCALE * s.vExag, rot: r() * Math.PI * 2, tint: 0.85 + r() * 0.3 });
  }
  if (forest.length === 0) return out;
  const per = count / forest.length;
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
      out.push({ kind, variant: Math.floor(r() * 3), x, y: heightAt(x, z) - 0.0005, z, h: hM * UNIT * TREE_SCALE * s.vExag, rot: r() * Math.PI * 2, tint: 0.85 + r() * 0.3 });
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
  const near = treeShapes(season, true);
  const far = treeShapes(season, false);
  // 樹木は風で揺れる。岩は揺れない
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  injectEnv(mat, env, false, true);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  injectEnv(rockMat, env);
  const meshes: { near: THREE.InstancedMesh; far: THREE.InstancedMesh }[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  for (const kind of ['broadleaf', 'conifer', 'krummholz', 'shrub', 'rock'] as const) {
    const variants = near[kind].length;
    for (let v = 0; v < variants; v += 1) {
      const list = instances.filter((t) => t.kind === kind && t.variant % variants === v);
      if (list.length === 0) continue;
      const mk = (geo: THREE.BufferGeometry): THREE.InstancedMesh => {
        const im = new THREE.InstancedMesh(geo, kind === 'rock' ? rockMat : mat, list.length);
        list.forEach((t, i) => {
          q.setFromAxisAngle(up, t.rot);
          const w = kind === 'krummholz' ? t.h * 2.2 : kind === 'rock' ? t.h * 1.6 : kind === 'shrub' ? t.h * 1.3 : t.h * 0.78;
          m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(w, t.h, w));
          im.setMatrixAt(i, m4);
          // 個体ごとに明るさと色味を少し変える
          const warm = (t.tint - 1) * 0.5;
          im.setColorAt(i, col.setRGB(t.tint + warm, t.tint, t.tint - warm));
        });
        im.castShadow = shadows;
        im.receiveShadow = shadows;
        im.frustumCulled = false;
        return im;
      };
      const pair = { near: mk(near[kind][v]!), far: mk(far[kind][v]!) };
      group.add(pair.near, pair.far);
      meshes.push(pair);
    }
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

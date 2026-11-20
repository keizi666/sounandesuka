/**
 * 植生の配置と描画（docs/19 §7）。
 * - 樹種は標高・地形・沢や森林限界からの近さで決め、低周波のノイズで「同じ樹種のまとまり」を作る。
 * - 配置は、最小間隔を守る散布（ポアソンディスク風）に、疎密のノイズと林縁の間引きを掛ける。登山道の上には置かない。
 * - 描画は区画ごとの InstancedMesh。カメラに近い区画だけ近景用の形にし、遠い区画は板の少ない遠景用にする。
 *   下草（笹・草）は近い区画でだけ描く。
 * 位置・大きさの個体差は描画用のシード付き乱数（シミュレーションには関係しない）。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { VegClass } from '../sim/types';
import { ATLAS, atlasUv, vegetationAtlas } from './leafTextures';
import { fromSceneY, UNIT, type ViewScale } from './scale';
import { buriedFraction } from './snowCover';
import { injectEnv, type EnvUniforms } from './terrainMaterial';
import { TREE_KINDS, treeShapes, VARIANTS, type TreeKind } from './treeShapes';

/** 樹木の見た目の拡大率（人形より木のほうが高く見える比率にする。docs/19 §6） */
export const TREE_SCALE = 4.0;
/** 区画の分割数（一辺） */
const GRID = 4;

type Kind = TreeKind | 'grass';

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

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** なめらかなノイズ（0..1）。x・z はメートル、scaleM は模様の大きさ */
function noise(x: number, z: number, scaleM: number, seed = 0): number {
  const fx = x / scaleM + seed * 13.7;
  const fz = z / scaleM + seed * 7.3;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const ux = tx * tx * (3 - 2 * tx);
  const uz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export interface Instance {
  kind: Kind;
  variant: number;
  x: number;
  y: number;
  z: number;
  /** 高さ（シーン単位） */
  h: number;
  /** 幅の倍率（高さに対して） */
  w: number;
  rot: number;
  tint: number;
}

/** 樹高の範囲（m）と幅の倍率 */
const SIZE: Record<TreeKind, { h: [number, number]; w: number }> = {
  buna: { h: [16, 24], w: 1.0 },
  mizunara: { h: [13, 19], w: 1.1 },
  kaede: { h: [7, 11], w: 1.15 },
  kanba: { h: [9, 14], w: 1.0 },
  shirabiso: { h: [14, 22], w: 0.85 },
  tsuga: { h: [11, 17], w: 1.0 },
  karamatsu: { h: [18, 26], w: 0.8 },
  sugi: { h: [24, 34], w: 0.75 },
  hinoki: { h: [18, 26], w: 0.85 },
  haimatsu: { h: [1.2, 2.0], w: 3.2 },
  shrub: { h: [1.0, 1.8], w: 1.6 },
  rock: { h: [0.6, 3.0], w: 1.6 },
};

/**
 * 雪に埋もれるもの（ユーザーの指定: 雪山は雪山として描く）。雪線より上の下草は雪の下に隠れ、
 * ハイマツ・低木は大半が埋もれて、ところどころ頭だけが出る。高い木はそのまま（枝の上の雪はシェーダーで白くする）。
 */
export function buryUnderSnow(list: Instance[], s: ViewScale, lineM: number): Instance[] {
  if (!Number.isFinite(lineM)) return list;
  const out: Instance[] = [];
  for (const t of list) {
    const bf = buriedFraction(fromSceneY(s, t.y), lineM);
    if (bf <= 0) {
      out.push(t);
      continue;
    }
    const h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
    if (t.kind === 'grass') {
      if (h > bf * 1.6) out.push(t);
    } else if (t.kind === 'haimatsu' || t.kind === 'shrub') {
      if (h > bf * 0.75) out.push({ ...t, h: t.h * (1 - 0.55 * bf) });
    } else out.push(t);
  }
  return out;
}

/** 樹木・岩・下草を配置する（count は樹木のおおよその総数） */
export function placeTrees(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, count: number): Instance[] {
  const r = rng(0x7aee5 ^ map.n);
  const n = map.n;
  const out: Instance[] = [];
  const vegAt = (gx: number, gz: number): number => map.veg[Math.min(n - 1, Math.max(0, gz)) * n + Math.min(n - 1, Math.max(0, gx))]!;
  const isForest = (v: number): boolean => v === VegClass.BROADLEAF || v === VegClass.CONIFER;
  const forestLine = map.def.vegetation?.forestLine ?? 2400;

  // 登山道の近く（置かない範囲）: 道の標本点を粗い格子に入れておく
  const TRAIL_CELL = 24;
  const trailGrid = new Map<number, [number, number][]>();
  const tk = (x: number, z: number): number => Math.floor(x / TRAIL_CELL) * 100003 + Math.floor(z / TRAIL_CELL);
  for (const t of Object.values(map.trails)) {
    if (t.def.kind === 'false') continue;
    for (const p of t.samples) {
      const k = tk(p.x, p.z);
      let list = trailGrid.get(k);
      if (!list) trailGrid.set(k, (list = []));
      list.push([p.x, p.z]);
    }
  }
  const trailDist = (x: number, z: number): number => {
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const list = trailGrid.get(tk(x + dx * TRAIL_CELL, z + dz * TRAIL_CELL));
        if (!list) continue;
        for (const [px, pz] of list) best = Math.min(best, Math.hypot(px - x, pz - z));
      }
    }
    return best;
  };

  // 最小間隔を守るための格子
  const MIN_D = 11;
  const taken = new Map<number, [number, number][]>();
  const pk = (x: number, z: number): number => Math.floor(x / MIN_D) * 100003 + Math.floor(z / MIN_D);
  const tooClose = (x: number, z: number, d: number): boolean => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const list = taken.get(pk(x + dx * MIN_D, z + dz * MIN_D));
        if (!list) continue;
        for (const [px, pz] of list) if (Math.hypot(px - x, pz - z) < d) return true;
      }
    }
    return false;
  };
  const take = (x: number, z: number): void => {
    const k = pk(x, z);
    let list = taken.get(k);
    if (!list) taken.set(k, (list = []));
    list.push([x, z]);
  };

  const push = (kind: Kind, x: number, z: number, hM: number, w: number, variant = Math.floor(r() * VARIANTS)): void => {
    const sx = x * UNIT;
    const sz = z * UNIT;
    out.push({ kind, variant, x: sx, y: heightAt(sx, sz) - 0.0006, z: sz, h: hM * UNIT * TREE_SCALE * s.vExag, w, rot: r() * Math.PI * 2, tint: 0.9 + r() * 0.2 });
  };

  /** その場所の樹種。低周波ノイズで、同じ樹種がまとまって生える */
  const species = (x: number, z: number, gx: number, gz: number, v: number): TreeKind => {
    const elev = map.heights[gz * n + gx]!;
    const slope = map.slopeDeg[gz * n + gx]!;
    const patch = noise(x, z, 260, 1);
    const fine = r();
    let nearStream = false;
    for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-3, -3], [3, 3]] as const) if (vegAt(gx + ox, gz + oz) === VegClass.STREAM) nearStream = true;
    if (v === VegClass.BROADLEAF) {
      if (nearStream && fine < 0.65) return 'kaede';
      // 道沿いの明るい林にはカラマツ
      if (trailDist(x, z) < 45 && patch > 0.45 && fine < 0.4) return 'karamatsu';
      if (patch < 0.34) return fine < 0.75 ? 'mizunara' : 'kaede';
      if (patch > 0.72) return fine < 0.5 ? 'kaede' : 'buna';
      return fine < 0.8 ? 'buna' : fine < 0.92 ? 'mizunara' : 'shirabiso';
    }
    // 針葉樹林: 森林限界より十分低いところ（奥多摩のような山の中腹以下）はスギ・ヒノキの植林。
    // 谷・沢沿い・斜面の下部はスギ、尾根・斜面の上部はヒノキ（植林の通例）
    const toLine = forestLine - elev;
    if (toLine > 900) {
      const tpi = map.tpi[gz * n + gx] ?? 0;
      const wet = (nearStream ? 0.35 : 0) - tpi / 40 + (patch - 0.5) * 0.6;
      return wet > 0 ? (fine < 0.88 ? 'sugi' : 'hinoki') : fine < 0.85 ? 'hinoki' : 'sugi';
    }
    // 森林限界に近いほどダケカンバが混じる。急な尾根・岩場はコメツガ
    if (toLine < 180 && fine < 0.5 - toLine / 500) return 'kanba';
    if (slope > 32 || patch < 0.3) return fine < 0.75 ? 'tsuga' : 'shirabiso';
    return fine < 0.82 ? 'shirabiso' : fine < 0.93 ? 'tsuga' : 'kanba';
  };

  // 樹木: 候補のセルを引いて、疎密・林縁・最小間隔で採否を決める
  const forest: number[] = [];
  const low: number[] = [];
  const rocky: number[] = [];
  for (let i = 0; i < n * n; i += 1) {
    const v = map.veg[i]!;
    if (isForest(v)) forest.push(i);
    else if (v === VegClass.KRUMMHOLZ) low.push(i);
    else if (v === VegClass.ROCK || v === VegClass.CLIFF || v === VegClass.ALPINE) rocky.push(i);
  }
  const cellXZ = (i: number): [number, number, number, number] => {
    const gx = i % n;
    const gz = Math.floor(i / n);
    return [-map.half + (gx + r() - 0.5) * map.cell, -map.half + (gz + r() - 0.5) * map.cell, gx, gz];
  };
  let placed = 0;
  for (let tries = 0; tries < count * 6 && placed < count && forest.length > 0; tries += 1) {
    const i = forest[Math.floor(r() * forest.length)]!;
    const [x, z, gx, gz] = cellXZ(i);
    const v = map.veg[i]!;
    // 疎密: 大きな模様で密林と疎林を作る
    let p = 0.3 + 0.7 * THREE.MathUtils.smoothstep(noise(x, z, 190, 2) * 0.65 + noise(x, z, 60, 3) * 0.35, 0.3, 0.62);
    // 林縁: 隣が林でないところは間引く
    let edge = 0;
    for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) if (!isForest(vegAt(gx + ox, gz + oz))) edge += 1;
    p *= 1 - edge * 0.2;
    if (r() > p) continue;
    const td = trailDist(x, z);
    if (td < 10) continue;
    const kind = species(x, z, gx, gz, v);
    const sz = SIZE[kind];
    const hM = sz.h[0] + r() * (sz.h[1] - sz.h[0]);
    // 植林（スギ・ヒノキ）は密に植わっている
    if (tooClose(x, z, MIN_D * (kind === 'kaede' || kind === 'kanba' ? 0.7 : kind === 'sugi' || kind === 'hinoki' ? 0.75 : 1))) continue;
    take(x, z);
    push(kind, x, z, hM * (td < 30 ? 0.85 : 1), sz.w);
    placed += 1;
  }
  // ハイマツ帯: 低いかたまりで覆う。ところどころ灌木
  const lowCount = Math.min(low.length * 2, Math.floor(count * 0.45));
  for (let k = 0; k < lowCount; k += 1) {
    const [x, z] = cellXZ(low[Math.floor(r() * low.length)]!);
    if (trailDist(x, z) < 5) continue;
    const kind: TreeKind = r() < 0.85 ? 'haimatsu' : 'shrub';
    const sz = SIZE[kind];
    push(kind, x, z, sz.h[0] + r() * (sz.h[1] - sz.h[0]), sz.w * (0.8 + r() * 0.6));
  }
  // 岩と、高山帯の灌木
  const rockCount = Math.min(rocky.length, Math.floor(count * 0.3));
  for (let k = 0; k < rockCount; k += 1) {
    const i = rocky[Math.floor(r() * rocky.length)]!;
    const v = map.veg[i]!;
    const [x, z] = cellXZ(i);
    if (trailDist(x, z) < 4) continue;
    if (v === VegClass.ALPINE) {
      if (r() < 0.3) push('shrub', x, z, 0.8 + r() * 0.8, SIZE.shrub.w);
      else if (r() < 0.25) push('rock', x, z, 0.5 + r() * r() * 2, SIZE.rock.w);
    } else push('rock', x, z, 0.6 + r() * r() * 3.2, SIZE.rock.w * (0.8 + r() * 0.6));
  }
  // 下草: 林の中は笹、高山帯は草。林床の岩と倒木の代わりに、苔むした岩を少し
  const under = Math.floor(count * 2.2);
  const ground = [...forest, ...low, ...rocky.filter((i) => map.veg[i] === VegClass.ALPINE)];
  for (let k = 0; k < under && ground.length > 0; k += 1) {
    const i = ground[Math.floor(r() * ground.length)]!;
    const [x, z] = cellXZ(i);
    if (trailDist(x, z) < 3) continue;
    if (isForest(map.veg[i]!) && r() < 0.06) push('rock', x, z, 0.5 + r() * 1.2, SIZE.rock.w);
    else if (map.veg[i] === VegClass.ALPINE) push('grass', x, z, 0.35 + r() * 0.4, 1.6, 1);
    else push('grass', x, z, 0.9 + r() * 1.1, 1.3, 0);
  }
  return out;
}

/** 下草の形: 交差する 2 枚の板 */
function grassGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const [u0, v0] = atlasUv(ATLAS.grass, 0, 0);
  const [u1, v1] = atlasUv(ATLAS.grass, 1, 1);
  for (const a of [0.3, 0.3 + Math.PI / 2]) {
    const dx = Math.cos(a) * 0.5;
    const dz = Math.sin(a) * 0.5;
    const quad: [number, number, number, number, number][] = [
      [-dx, 0, -dz, u0, v0], [dx, 0, dz, u1, v0], [dx, 1, dz, u1, v1],
      [-dx, 0, -dz, u0, v0], [dx, 1, dz, u1, v1], [-dx, 1, -dz, u0, v1],
    ];
    for (const [x, y, z, u, v] of quad) {
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      uv.push(u, v);
      const k = 0.55 + 0.45 * y;
      col.push(k, k, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export interface Vegetation {
  group: THREE.Group;
  /** カメラからの距離で、区画ごとに近景・遠景を切り替える */
  update(camera: THREE.Camera): void;
  /** 計測用: 樹木の数と、いま近景になっている区画の数 */
  stats(): { trees: number; nearChunks: number; meshes: number };
}

export function buildVegetation(instances: Instance[], season: string, env: EnvUniforms, shadows: boolean): Vegetation {
  const group = new THREE.Group();
  const near = treeShapes(season, true);
  const far = treeShapes(season, false);
  const atlas = vegetationAtlas();
  // 葉の板・幹: アルファテスト、両面、風で揺れる、木ごとに色がゆらぐ、縁の光
  const leafMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  injectEnv(leafMat, env, false, true, { rim: 0.55, vary: true, leaf: true });
  const rockMat = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.96, flatShading: true });
  injectEnv(rockMat, env, false, false, { rim: 0.15 });
  const grassGeo = grassGeometry();
  const autumn = season === 'autumn';
  const sasa = new THREE.Color(season === 'winter' ? 0x8a8f6a : 0x6f9a48);
  const alpineGrass = new THREE.Color(autumn ? 0xb99a52 : 0x9ab25c);

  // 区画の範囲
  let half = 0;
  for (const t of instances) half = Math.max(half, Math.abs(t.x), Math.abs(t.z));
  half = Math.max(half, 0.001);
  const chunkOf = (t: Instance): number => {
    const cx = Math.min(GRID - 1, Math.max(0, Math.floor(((t.x + half) / (2 * half)) * GRID)));
    const cz = Math.min(GRID - 1, Math.max(0, Math.floor(((t.z + half) / (2 * half)) * GRID)));
    return cz * GRID + cx;
  };
  const buckets = new Map<string, Instance[]>();
  for (const t of instances) {
    const key = `${t.kind}|${t.variant % VARIANTS}|${chunkOf(t)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }

  interface Chunk {
    center: THREE.Vector3;
    near: THREE.InstancedMesh[];
    far: THREE.InstancedMesh[];
  }
  const chunks: Chunk[] = Array.from({ length: GRID * GRID }, (_, i) => ({
    center: new THREE.Vector3(-half + ((i % GRID) + 0.5) * ((2 * half) / GRID), 0, -half + (Math.floor(i / GRID) + 0.5) * ((2 * half) / GRID)),
    near: [],
    far: [],
  }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let meshCount = 0;
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Instance[], cast: boolean, tintOf: (t: Instance) => THREE.Color): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.h * t.w, t.h, t.h * t.w));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, tintOf(t));
    });
    im.castShadow = cast;
    im.receiveShadow = shadows;
    im.computeBoundingSphere();
    meshCount += 1;
    group.add(im);
    return im;
  };
  const plain = (t: Instance): THREE.Color => col.setScalar(t.tint);
  for (const [key, list] of buckets) {
    const [kind, variant, chunk] = key.split('|') as [Kind, string, string];
    const ch = chunks[Number(chunk)]!;
    const v = Number(variant);
    for (const t of list) ch.center.y = Math.max(ch.center.y, t.y);
    if (kind === 'grass') {
      // 下草は近い区画だけ。林の中は笹の緑、高山帯は草紅葉（variant で分けてある）
      ch.near.push(mk(grassGeo, leafMat, list, false, (t) => col.copy(t.variant % 2 === 0 ? sasa : alpineGrass).multiplyScalar(t.tint)));
      continue;
    }
    const mat = kind === 'rock' ? rockMat : leafMat;
    ch.near.push(mk(near.geo[kind][v]!, mat, list, shadows, plain));
    ch.far.push(mk(far.geo[kind][v]!, mat, list, shadows, plain));
  }
  const chunkSize = (2 * half) / GRID;
  const nearDist = Math.max(0.9, chunkSize * 1.15);
  const camPos = new THREE.Vector3();
  let nearChunks = 0;
  const trees = instances.filter((t) => t.kind !== 'grass' && t.kind !== 'rock').length;
  void TREE_KINDS;
  return {
    group,
    update(camera) {
      camera.getWorldPosition(camPos);
      nearChunks = 0;
      for (const ch of chunks) {
        const isNear = camPos.distanceTo(ch.center) < nearDist;
        if (isNear) nearChunks += 1;
        for (const m of ch.near) m.visible = isNear;
        for (const m of ch.far) m.visible = !isNear;
      }
    },
    stats: () => ({ trees, nearChunks, meshes: meshCount }),
  };
}

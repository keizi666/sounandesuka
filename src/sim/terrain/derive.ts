/**
 * 派生レイヤー（docs/04 §4）: 傾斜・方位・TPI・風の露出・流量・沢・植生・崖・空の見通し・電波。
 * セル寸法は grid.cell を使う（可変マップ対応）。
 */
import { DEG, datan, datan2, PI } from '../core/dmath';
import { deriveSeed, hashString32 } from '../core/rng';
import { TUNING, type Tuning } from '../tuning';
import { VegClass, type MapDef } from '../types';
import { computeRadioCoverage } from './coverage';
import { flowAccumulation } from './flow';
import { isProcedural, NOISE_SALT } from './generate';
import { createNoise2D, fbm } from './noise';
import { vertexX, vertexZ, type HeightGrid } from './sample';

export interface DerivedLayers {
  slopeDeg: Float32Array;
  aspect: Float32Array;
  tpi: Float32Array;
  exposure: Float32Array;
  flowAcc: Float32Array;
  stream: Uint8Array;
  veg: Uint8Array;
  cliff: Uint8Array;
  skyView: Float32Array;
  radio: Float32Array;
}

/** 植生クラスごとの森林か（空の見通し・電波の補正用） */
export function isForest(v: number): boolean {
  return v === VegClass.BROADLEAF || v === VegClass.CONIFER;
}

const N8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * 傾斜は 8 近傍への最大勾配（度）。滑らかな斜面では勾配とほぼ同じで、
 * 滝のような 1 セル幅の段差も取りこぼさない（DECISIONS）。
 */
export function computeSlope(g: HeightGrid): Float32Array {
  const { n, cell, heights: h } = g;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const i = iz * n + ix;
      let best = 0;
      for (const [dx, dz] of N8) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const d = dx !== 0 && dz !== 0 ? cell * Math.SQRT2 : cell;
        const s = Math.abs(h[i]! - h[z * n + x]!) / d;
        if (s > best) best = s;
      }
      out[i] = datan(best) / DEG;
    }
  }
  return out;
}

/** 斜面方位（rad、北=0、時計回り。斜面が向いている＝下っていく方向） */
export function computeAspect(g: HeightGrid): Float32Array {
  const { n, cell, heights: h } = g;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const xm = Math.max(0, ix - 1);
      const xp = Math.min(n - 1, ix + 1);
      const zm = Math.max(0, iz - 1);
      const zp = Math.min(n - 1, iz + 1);
      const dhdx = (h[iz * n + xp]! - h[iz * n + xm]!) / ((xp - xm) * cell);
      const dhdz = (h[zp * n + ix]! - h[zm * n + ix]!) / ((zp - zm) * cell);
      // 下り方向 = (-dhdx, -dhdz)。北は -z なので北成分は +dhdz
      let a = datan2(-dhdx, dhdz);
      if (a < 0) a += 2 * PI;
      out[iz * n + ix] = a;
    }
  }
  return out;
}

/** 1 次元の箱型平均（範囲内の値だけで割る）を行・列に掛ける */
function boxBlur(src: Float64Array, n: number, r: number): Float64Array {
  const tmp = new Float64Array(n * n);
  const out = new Float64Array(n * n);
  const prefix = new Float64Array(n + 1);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) prefix[ix + 1] = prefix[ix]! + src[iz * n + ix]!;
    for (let ix = 0; ix < n; ix += 1) {
      const a = Math.max(0, ix - r);
      const b = Math.min(n - 1, ix + r);
      tmp[iz * n + ix] = (prefix[b + 1]! - prefix[a]!) / (b - a + 1);
    }
  }
  for (let ix = 0; ix < n; ix += 1) {
    for (let iz = 0; iz < n; iz += 1) prefix[iz + 1] = prefix[iz]! + tmp[iz * n + ix]!;
    for (let iz = 0; iz < n; iz += 1) {
      const a = Math.max(0, iz - r);
      const b = Math.min(n - 1, iz + r);
      out[iz * n + ix] = (prefix[b + 1]! - prefix[a]!) / (b - a + 1);
    }
  }
  return out;
}

/** TPI = 標高 − 半径 R の平均。半径 R/2 の箱型平均を 2 回掛けて近似する */
export function computeTpi(g: HeightGrid, radiusM: number): Float32Array {
  const n = g.n;
  const r = Math.max(1, Math.round(radiusM / 2 / g.cell));
  const src = Float64Array.from(g.heights);
  const mean = boxBlur(boxBlur(src, n, r), n, r);
  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) out[i] = src[i]! - mean[i]!;
  return out;
}

/** 空の見通し: 8 方位・半径 R の地平線仰角 φ から mean(cos²φ)。箱庭の外は平地 */
export function computeSkyView(g: HeightGrid, radiusM: number, outsideElevM: number): Float32Array {
  const { n, cell, heights: h } = g;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const h0 = h[iz * n + ix]!;
      let sum = 0;
      for (const [dx, dz] of N8) {
        const stepD = dx !== 0 && dz !== 0 ? cell * Math.SQRT2 : cell;
        let maxTan = 0;
        for (let k = 1; k * stepD <= radiusM; k += 1) {
          const x = ix + dx * k;
          const z = iz + dz * k;
          const he = x < 0 || z < 0 || x >= n || z >= n ? outsideElevM : h[z * n + x]!;
          const tn = (he - h0) / (k * stepD);
          if (tn > maxTan) maxTan = tn;
        }
        // cos²(atan(t)) = 1 / (1 + t²)
        sum += 1 / (1 + maxTan * maxTan);
      }
      out[iz * n + ix] = sum / N8.length;
    }
  }
  return out;
}

export interface DeriveOptions {
  /** 電波圏を計算するか（重いので Worker 側で行う場合は false） */
  radio?: boolean;
  tuning?: Tuning;
}

export function deriveLayers(def: MapDef, g: HeightGrid, opts: DeriveOptions = {}): DerivedLayers {
  const tuning = opts.tuning ?? TUNING;
  const dt = tuning.derive;
  const { n, cell } = g;
  const N = n * n;
  const outsideElevM = def.terrain.baseElevation;

  const slopeDeg = computeSlope(g);
  const aspect = computeAspect(g);
  const tpi = computeTpi(g, dt.tpiRadiusM);
  const exposure = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    exposure[i] = Math.min(dt.exposureMax, Math.max(dt.exposureMin, 1 + tpi[i]! / dt.exposureTpiDivisor));
  }

  const flowAcc = flowAccumulation(g, g.heights, dt.fillEpsilonM);
  const stream = new Uint8Array(N);
  const cellArea = cell * cell;
  for (let i = 0; i < N; i += 1) stream[i] = flowAcc[i]! * cellArea > dt.streamAreaM2 ? 1 : 0;

  // 崖: 急傾斜、または滝の段差セル
  const cliff = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) if (slopeDeg[i]! > dt.cliffSlopeDeg) cliff[i] = 1;
  if (isProcedural(def)) {
    for (const k of def.terrain.knickpoints) markKnickCliff(g, cliff, k.x, k.z, k.radius, k.drop * dt.knickCliffDropRatio);
  }

  // 植生（判定順: CLIFF → STREAM → ROCK → 標高）
  const vg = def.vegetation;
  const vegSeed = isProcedural(def)
    ? deriveSeed(def.terrain.seed, NOISE_SALT.forestLine)
    : deriveSeed(hashString32(def.id), NOISE_SALT.forestLine);
  const forestNoise = createNoise2D(vegSeed);
  const band = vg.krummholzBandM ?? dt.krummholzBandM;
  const noiseScale = tuning.terrain.forestLineNoiseScaleM;
  const veg = new Uint8Array(N);
  for (let iz = 0; iz < n; iz += 1) {
    const z = vertexZ(g, iz);
    for (let ix = 0; ix < n; ix += 1) {
      const i = iz * n + ix;
      const x = vertexX(g, ix);
      const e = g.heights[i]!;
      let v: number;
      if (cliff[i]) v = VegClass.CLIFF;
      else if (stream[i]) v = VegClass.STREAM;
      else if (slopeDeg[i]! > dt.rockSlopeDeg) v = VegClass.ROCK;
      else {
        const fl = vg.forestLine + vg.forestLineNoise * fbm(forestNoise, x / noiseScale, z / noiseScale, 3);
        if (e < vg.broadleafLine) v = VegClass.BROADLEAF;
        else if (e < fl) v = VegClass.CONIFER;
        else if (e < fl + band && slopeDeg[i]! < dt.krummholzMaxSlopeDeg) v = VegClass.KRUMMHOLZ;
        else v = VegClass.ALPINE;
      }
      veg[i] = v;
    }
  }
  // vegetation.overrides（エディターの塗り直し）は P13 で適用する

  const skyView = computeSkyView(g, dt.skyViewRadiusM, outsideElevM);
  for (let i = 0; i < N; i += 1) if (isForest(veg[i]!)) skyView[i]! *= dt.skyViewForestFactor;

  let radio: Float32Array;
  if (opts.radio === false) radio = new Float32Array(N);
  else {
    radio = computeRadioCoverage(g, def.radio.stations, outsideElevM, tuning);
    for (let i = 0; i < N; i += 1) if (isForest(veg[i]!)) radio[i]! *= tuning.radio.forestFactor;
    // radio.paint（エディターの塗り直し）は P13 で適用する
  }

  return { slopeDeg, aspect, tpi, exposure, flowAcc, stream, veg, cliff, skyView, radio };
}

/** 滝の半径内で、隣接セルへの落差が minDrop 以上のセルを崖にする */
function markKnickCliff(g: HeightGrid, cliff: Uint8Array, cx: number, cz: number, r: number, minDrop: number): void {
  const { n, heights: h } = g;
  for (let iz = 0; iz < n; iz += 1) {
    const z = vertexZ(g, iz);
    if (Math.abs(z - cz) > r) continue;
    for (let ix = 0; ix < n; ix += 1) {
      const x = vertexX(g, ix);
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > r * r) continue;
      const i = iz * n + ix;
      for (const [dx, dz] of N8) {
        const xx = ix + dx;
        const zz = iz + dz;
        if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
        if (Math.abs(h[i]! - h[zz * n + xx]!) >= minDrop) {
          cliff[i] = 1;
          break;
        }
      }
    }
  }
}

/**
 * 大気（空の色・太陽と月の光の色）。作者のアプリ「ジオノスタルジカ」の大気の区画と同じ考え方と係数（Bruneton 2017）。
 * 空気の分子（レイリー散乱）・かすみ（ミー散乱）・オゾンの吸収を、球殻の大気の中で視線に沿って足し合わせる（1 回散乱）。
 * 光源への道が地球に遮られる所は地球の影で光らないので、日没後は上空だけが明るい薄明の空になる。
 * 一度散った光がもう一度散って届く分は、天頂の明るさ × 視線のかすみ具合で見積もる（地球の影の空が真っ黒に抜けないように）。
 *
 * 空の色は「光源の高さ」ごとに、視線の高さ × 光源との方位の差 の表（LUT）にしてシェーダーに渡す。
 */
import * as THREE from 'three';

const R0 = 6360000;
const R1 = 6420000;
const RAYLEIGH = [5.8e-6, 13.5e-6, 33.1e-6];
const RAYLEIGH_H = 8000;
const HAZE = 21e-6;
const HAZE_TILT = [Math.pow(680 / 550, -1.3), 1, Math.pow(440 / 550, -1.3)];
const HAZE_H = 1200;
const HAZE_G = 0.76;
const HAZE_MU_MAX = 0.9;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
/** 目の高さ（m）。山の上なので空気が薄いぶん、空は濃い青になる */
const EYE_H = 2000;
const VIEW_N = 20;
const LIGHT_N = 6;
const AMBIENT = 0.5;
/** 光源がこれより低いときは、この高さで解いた色のまま、1° につき DIM_PER_DEG 桁ずつ暗くする */
export const SOURCE_EL_MIN = -5;
export const DIM_PER_DEG = 0.35;

const dens = [0, 0, 0];
function density(h: number): void {
  dens[0] = Math.exp(-h / RAYLEIGH_H);
  dens[1] = Math.exp(-h / HAZE_H);
  dens[2] = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
}
function toTop(r: number, mu: number): number {
  const b = r * mu;
  return -b + Math.sqrt(Math.max(0, b * b - r * r + R1 * R1));
}
function hitsGround(r: number, mu: number): boolean {
  if (mu >= 0) return false;
  const b = r * mu;
  return b * b - r * r + R0 * R0 >= 0;
}
const col = [0, 0, 0];
function column(x: number, y: number, z: number, r: number, dx: number, dy: number, dz: number, n: number): boolean {
  const mu = (x * dx + y * dy + z * dz) / r;
  if (hitsGround(r, mu)) return false;
  const L = toTop(r, mu);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const a = i / n;
    const b = (i + 1) / n;
    const m = (a + b) / 2;
    const t = L * m * m;
    const dt = L * (b * b - a * a);
    const px = x + dx * t;
    const py = y + dy * t;
    const pz = z + dz * t;
    density(Math.sqrt(px * px + py * py + pz * pz) - R0);
    s0 += dens[0]! * dt;
    s1 += dens[1]! * dt;
    s2 += dens[2]! * dt;
  }
  col[0] = s0;
  col[1] = s1;
  col[2] = s2;
  return true;
}
const tau = (c: number, s0: number, s1: number, s2: number): number => RAYLEIGH[c]! * s0 + HAZE * HAZE_TILT[c]! * 1.11 * s1 + OZONE[c]! * s2;

/** 視線（高さ el・光源との方位の差 dAz、度）の空の明るさ（線形 RGB、光源の強さ 1）。out[3..5] は視線のかすみ具合 */
function radiance(el: number, dAz: number, lel: number, out: number[]): number[] {
  const D = Math.PI / 180;
  const ce = Math.cos(el * D);
  const vx = ce * Math.sin(dAz * D);
  const vy = ce * Math.cos(dAz * D);
  const vz = Math.sin(el * D);
  const cl = Math.cos(lel * D);
  const lx = 0;
  const ly = cl;
  const lz = Math.sin(lel * D);
  const mu = vx * lx + vy * ly + vz * lz;
  const pR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = HAZE_G;
  const mh = Math.min(mu, HAZE_MU_MAX);
  const pM = ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mh * mh))) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mh, 1.5));
  const r0 = R0 + EYE_H;
  const L = hitsGround(r0, vz) ? 0 : toTop(r0, vz);
  let o0 = 0;
  let o1 = 0;
  let o2 = 0;
  const acc = [0, 0, 0];
  for (let i = 0; i < VIEW_N; i += 1) {
    const a = i / VIEW_N;
    const b = (i + 1) / VIEW_N;
    const m = (a + b) / 2;
    const t = L * m * m;
    const dt = L * (b * b - a * a);
    const x = vx * t;
    const y = vy * t;
    const z = r0 + vz * t;
    const r = Math.sqrt(x * x + y * y + z * z);
    density(r - R0);
    const d0 = dens[0]! * dt;
    const d1 = dens[1]! * dt;
    const d2 = dens[2]! * dt;
    const h0 = o0 + d0 / 2;
    const h1 = o1 + d1 / 2;
    const h2 = o2 + d2 / 2;
    o0 += d0;
    o1 += d1;
    o2 += d2;
    if (!column(x, y, z, r, lx, ly, lz, LIGHT_N)) continue;
    const s0 = h0 + col[0]!;
    const s1 = h1 + col[1]!;
    const s2 = h2 + col[2]!;
    for (let c = 0; c < 3; c += 1) acc[c] = acc[c]! + (RAYLEIGH[c]! * pR * d0 + HAZE * HAZE_TILT[c]! * pM * d1) * Math.exp(-tau(c, s0, s1, s2));
  }
  for (let k = 0; k < 3; k += 1) {
    out[k] = acc[k]!;
    out[3 + k] = 1 - Math.exp(-tau(k, o0, o1, o2));
  }
  return out;
}

const tmp = [0, 0, 0, 0, 0, 0];
function skyLight(el: number, dAz: number, lel: number, zen: number[], out: number[]): number[] {
  radiance(el, dAz, lel, tmp);
  for (let c = 0; c < 3; c += 1) out[c] = tmp[c]! + AMBIENT * zen[c]! * tmp[3 + c]!;
  return out;
}
const luma = (c: number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** 高さ el の光源から目に届く光の、色ごとの割合（天頂にあるときを 1）。地平線より下は地平線の値 */
const zenCol = (() => {
  const r0 = R0 + EYE_H;
  column(0, 0, r0, r0, 0, 0, 1, LIGHT_N * 2);
  return [col[0]!, col[1]!, col[2]!];
})();
const transMemo = new Map<number, [number, number, number]>();
export function transmittance(elDeg: number): [number, number, number] {
  const key = Math.round(THREE.MathUtils.clamp(elDeg, -2, 90) * 10);
  const hit = transMemo.get(key);
  if (hit) return hit;
  const r0 = R0 + EYE_H;
  const e = (Math.max(-1.5, key / 10) * Math.PI) / 180;
  const ok = column(0, 0, r0, r0, Math.cos(e), 0, Math.sin(e), LIGHT_N * 3);
  const out: [number, number, number] = ok ? [0, 1, 2].map((c) => Math.exp(tau(c, zenCol[0]!, zenCol[1]!, zenCol[2]!) - tau(c, col[0]!, col[1]!, col[2]!))) as [number, number, number] : [0, 0, 0];
  transMemo.set(key, out);
  return out;
}

// ---- 空の LUT（視線の高さ × 光源との方位の差） ----
export const LUT_EL = 40;
export const LUT_AZ = 32;
/** 表の行 i の視線の高さ（度）。地平線の近くを細かく */
export function lutEl(i: number): number {
  const t = i / (LUT_EL - 1);
  return -8 + 98 * t * t;
}

export interface SkyLut {
  /** 光源の強さ 1 での線形 RGB（LUT_EL 行 × LUT_AZ 列）。CALIB 済み */
  data: Float32Array;
  /** 空ぜんたいの明るさ（目が慣れる先の目安） */
  meter: number;
  /** 上半分の空の平均の色（地面を照らす空の光） */
  ambient: THREE.Color;
}

/** 昼（光源 45°）の天頂の明るさをそろえる係数。ACES の画で深い青になる程度 */
let calib = 0;
function computeRaw(lel: number): SkyLut {
  const zen = radiance(90, 0, lel, [0, 0, 0, 0, 0, 0]);
  const data = new Float32Array(LUT_EL * LUT_AZ * 3);
  const v = [0, 0, 0];
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let ambN = 0;
  for (let i = 0; i < LUT_EL; i += 1) {
    const el = lutEl(i);
    for (let j = 0; j < LUT_AZ; j += 1) {
      const dAz = (j / (LUT_AZ - 1)) * 180;
      skyLight(Math.max(el, 0.2), dAz, lel, zen, v);
      // 地平線より下（遠くの山の向こう）は、地平線の色を少し暗くしたもの
      const f = el < 0 ? 0.75 + 0.25 * (1 + el / 8) : 1;
      // 薄明の空: 3 色だけで解くと、オゾンが緑を吸って赤紫に寄りすぎる。実際の薄明の天頂は深い青なので、
      // 太陽の側の地平線（夕焼けの残り）を除いて、赤を抑える
      if (lel < 0.5) {
        const twi = Math.min(1, (0.5 - lel) / 5);
        const glow = Math.exp(-Math.pow(dAz / 55, 2)) * Math.exp(-Math.pow(Math.max(el, 0) / 14, 2));
        v[0] = v[0]! * (1 - 0.5 * twi * (1 - glow));
        v[1] = v[1]! * (1 + 0.12 * twi * (1 - glow));
      }
      const k = (i * LUT_AZ + j) * 3;
      data[k] = v[0]! * f;
      data[k + 1] = v[1]! * f;
      data[k + 2] = v[2]! * f;
      if (el > 3) {
        const w = Math.cos((el * Math.PI) / 180) * (j === 0 || j === LUT_AZ - 1 ? 0.5 : 1);
        ar += v[0]! * w;
        ag += v[1]! * w;
        ab += v[2]! * w;
        ambN += w;
      }
    }
  }
  const meterDirs: [number, number][] = [[90, 0], [1, 0], [1, 90], [1, 180], [12, 0], [12, 180]];
  let meter = 0;
  for (const [e, a] of meterDirs) meter += luma(skyLight(e, a, lel, zen, v));
  meter /= meterDirs.length;
  return { data, meter, ambient: new THREE.Color(ar / ambN, ag / ambN, ab / ambN) };
}

const lutMemo = new Map<number, SkyLut>();
/** 光源の高さ el（度）の空の表。0.25° 刻みで覚えておく。el が SOURCE_EL_MIN より低いときは、その高さの表（暗くするのは呼ぶ側） */
export function skyLut(elDeg: number): SkyLut {
  if (calib === 0) {
    const day = computeRaw(45);
    // 天頂の色が昼の青（線形の輝度 0.17）になるように
    const zi = (LUT_EL - 1) * LUT_AZ * 3;
    calib = 0.17 / luma([day.data[zi]!, day.data[zi + 1]!, day.data[zi + 2]!]);
    DAY_METER = day.meter * calib;
  }
  const key = Math.round(Math.max(elDeg, SOURCE_EL_MIN) * 4);
  const hit = lutMemo.get(key);
  if (hit) return hit;
  const raw = computeRaw(key / 4);
  for (let i = 0; i < raw.data.length; i += 1) raw.data[i] = raw.data[i]! * calib;
  const out = { data: raw.data, meter: raw.meter * calib, ambient: raw.ambient.multiplyScalar(calib) };
  if (lutMemo.size > 600) lutMemo.clear();
  lutMemo.set(key, out);
  return out;
}

/** 昼（太陽 45°）の空ぜんたいの明るさ。明るさの慣れの基準 */
export let DAY_METER = 1;

/** 光源が SOURCE_EL_MIN より低いときの暗くなり方（1 = そのまま） */
export function deepTwilightDim(elDeg: number): number {
  return elDeg >= SOURCE_EL_MIN ? 1 : Math.pow(10, -(SOURCE_EL_MIN - elDeg) * DIM_PER_DEG);
}

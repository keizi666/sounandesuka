/**
 * 太陽・月・星の位置（見た目だけ。シミュレーションの明るさの判定は sim/weather/sun.ts のまま）。
 * 計算は作者のアプリ「雨かしらR」「ジオノスタルジカ」と同じ式: 太陽と月は簡略式（月は Meeus）、
 * 恒星は J2000 から歳差でその日に回し、地方恒星時と緯度で地平座標へ。
 * 地平座標はシーンと同じ向き（x 東・y 上・z 南）。
 */
import * as THREE from 'three';
import type { ScenarioDef } from '../sim/types';

const RAD = Math.PI / 180;

/** シナリオの時刻（日本時間の開始日 0 時からの分）を UTC のミリ秒に */
export function scenarioDateMs(scenario: ScenarioDef, tMin: number): number {
  const [y, m, d] = scenario.startDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) - 9 * 3600e3 + tMin * 60e3;
}

const j2000Days = (ms: number): number => ms / 86400000 + 2440587.5 - 2451545.0;

function sunEquatorial(n: number): { ra: number; dec: number } {
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  return { ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec: Math.asin(Math.sin(eps) * Math.sin(lam)) };
}

function moonEquatorial(n: number): { ra: number; dec: number; distKm: number; eps: number } {
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const L = (218.316 + 13.176396 * n) * RAD;
  const M = (134.963 + 13.064993 * n) * RAD;
  const F = (93.272 + 13.22935 * n) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M);
  const b = 5.128 * RAD * Math.sin(F);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)),
    distKm: 385001 - 20905 * Math.cos(M),
    eps,
  };
}

/** 赤道座標（その日）→ 地平座標（x 東・y 上・z 南）の行列 */
function eqToHorizon(n: number, latDeg: number, lonDeg: number, out: THREE.Matrix3): THREE.Matrix3 {
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const L = (gmst * 15 + lonDeg) * RAD;
  const ph = latDeg * RAD;
  const sL = Math.sin(L);
  const cL = Math.cos(L);
  const sp = Math.sin(ph);
  const cp = Math.cos(ph);
  return out.set(-sL, cL, 0, cp * cL, cp * sL, sp, sp * cL, sp * sL, -cp);
}

/** 歳差（J2000 → その日。IAU 1976 の 1 次の項） */
function precession(n: number, out: THREE.Matrix3): THREE.Matrix3 {
  const T = n / 36525;
  const as = RAD / 3600;
  const ze = 2306.2181 * T * as;
  const z = 2306.2181 * T * as;
  const th = 2004.3109 * T * as;
  const R3 = (m: THREE.Matrix3, a: number): THREE.Matrix3 => m.set(Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1);
  const R2 = (m: THREE.Matrix3, a: number): THREE.Matrix3 => m.set(Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a));
  const a = new THREE.Matrix3();
  R3(out, -z);
  out.multiply(R2(a, th));
  out.multiply(R3(a, -ze));
  return out;
}

/** J2000 の赤道座標 → 銀河座標（銀河の北極 赤経 192.86°・赤緯 27.13°、銀経 0° は射手座の方向） */
const EQ_TO_GAL = new THREE.Matrix3().set(
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.44482963, 0.7469822445,
  -0.867666149, -0.1980763734, 0.4559837762,
);

/** 大気差（度）。見かけの高さ = 幾何学的な高さ + これ */
function refractionDeg(elDeg: number): number {
  if (elDeg < -2) return 0;
  const h = Math.max(elDeg, -1.9);
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
}

export interface SkyState {
  /** 太陽・月の向き（単位ベクトル。大気差を含む見かけの位置） */
  sunDir: THREE.Vector3;
  sunElDeg: number;
  moonDir: THREE.Vector3;
  moonElDeg: number;
  /** 月の光って見える割合（0 新月〜1 満月） */
  moonFrac: number;
  /** 満月に対する月の明るさ（位相角による。半月で約 0.1） */
  moonBright: number;
  /** 月の視半径（度） */
  moonRadiusDeg: number;
  /** 月の北（黄道の北極の向き）を画面に投げた向き（月の円盤の上） */
  moonUp: THREE.Vector3;
  /** J2000 の赤道座標の向き → 地平座標 */
  starMatrix: THREE.Matrix3;
  /** 地平座標 → 銀河座標（天の川） */
  horToGal: THREE.Matrix3;
}

export function skyState(ms: number, latDeg: number, lonDeg: number, out?: SkyState): SkyState {
  const n = j2000Days(ms);
  const H = eqToHorizon(n, latDeg, lonDeg, new THREE.Matrix3());
  const s = sunEquatorial(n);
  const sunDir = (out?.sunDir ?? new THREE.Vector3()).set(Math.cos(s.dec) * Math.cos(s.ra), Math.cos(s.dec) * Math.sin(s.ra), Math.sin(s.dec)).applyMatrix3(H).normalize();
  let sunEl = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) / RAD;
  sunEl += refractionDeg(sunEl);
  liftTo(sunDir, sunEl);
  const m = moonEquatorial(n);
  const moonDir = (out?.moonDir ?? new THREE.Vector3()).set(Math.cos(m.dec) * Math.cos(m.ra), Math.cos(m.dec) * Math.sin(m.ra), Math.sin(m.dec)).applyMatrix3(H).normalize();
  // 地球の中心から見た位置なので、地上からは視差のぶん低く見える（最大 1° ほど）
  const par = Math.asin(6371 / m.distKm) * Math.sqrt(Math.max(0, 1 - moonDir.y * moonDir.y));
  let moonEl = Math.asin(THREE.MathUtils.clamp(moonDir.y, -1, 1)) / RAD - par / RAD;
  moonEl += refractionDeg(moonEl);
  liftTo(moonDir, moonEl);
  const cosPhi = Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra);
  const elong = Math.acos(THREE.MathUtils.clamp(cosPhi, -1, 1));
  const phaseDeg = 180 - elong / RAD; // 位相角（満月で 0）
  const moonFrac = (1 - Math.cos(elong)) / 2;
  // 月の等級: −12.73 + 0.026|α| + 4×10⁻⁹ α⁴（満月を 1 とした明るさ）
  const moonBright = Math.pow(10, -0.4 * (0.026 * phaseDeg + 4e-9 * phaseDeg ** 4));
  const north = new THREE.Vector3(0, -Math.sin(m.eps), Math.cos(m.eps)).applyMatrix3(H);
  const moonUp = (out?.moonUp ?? new THREE.Vector3()).copy(north).addScaledVector(moonDir, -north.dot(moonDir)).normalize();
  const starMatrix = (out?.starMatrix ?? new THREE.Matrix3()).copy(H).multiply(precession(n, new THREE.Matrix3()));
  // 地平 → 赤道（その日）→ J2000（歳差の逆）→ 銀河
  const horToEq = new THREE.Matrix3().copy(starMatrix).invert();
  const horToGal = (out?.horToGal ?? new THREE.Matrix3()).copy(EQ_TO_GAL).multiply(horToEq);
  return {
    sunDir,
    sunElDeg: sunEl,
    moonDir,
    moonElDeg: moonEl,
    moonFrac,
    moonBright: elong < 0.02 ? 0 : moonBright,
    moonRadiusDeg: 0.2725 * (384400 / m.distKm),
    moonUp,
    starMatrix,
    horToGal,
  };
}

/** 向きの方位はそのまま、高さを elDeg に */
function liftTo(v: THREE.Vector3, elDeg: number): void {
  const h = Math.hypot(v.x, v.z) || 1e-9;
  const c = Math.cos(elDeg * RAD);
  v.set((v.x / h) * c, Math.sin(elDeg * RAD), (v.z / h) * c);
}

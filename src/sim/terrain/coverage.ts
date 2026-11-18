/**
 * 電波圏（docs/04 §7）。各セル（地上 rxHeightM）から各局（局標高＋アンテナ高）への見通しを判定する。
 * Worker からも呼べる純関数（P8 で Worker 化）。
 */
import { TUNING, type Tuning } from '../tuning';
import type { RadioStationDef } from '../types';
import { sampleElevOr, vertexX, vertexZ, type HeightGrid } from './sample';

/** 1 地点から 1 局への強度 0..1 */
export function stationStrength(
  g: HeightGrid,
  outsideElevM: number,
  x: number,
  z: number,
  groundElevM: number,
  st: RadioStationDef,
  tuning: Tuning = TUNING,
): number {
  const rt = tuning.radio;
  const dx = st.x - x;
  const dz = st.z - z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist >= st.rangeM) return 0;
  const h0 = groundElevM + rt.rxHeightM;
  const h1 = st.elevM + st.antennaM;
  const interval = Math.max(rt.minSampleM, rt.sampleCells * g.cell);
  const steps = Math.max(1, Math.ceil(dist / interval));
  // これ以上遮られると回折でも 0 になる遮蔽量。超えたら打ち切る
  const zeroAt = rt.diffractionBase * rt.diffractionScaleM;
  let obstruction = -Infinity;
  for (let k = 1; k < steps; k += 1) {
    const f = k / steps;
    const terr = sampleElevOr(g, x + dx * f, z + dz * f, outsideElevM);
    const o = terr - (h0 + (h1 - h0) * f);
    if (o > obstruction) {
      obstruction = o;
      if (obstruction >= zeroAt) return 0;
    }
  }
  if (obstruction <= 0) return 1 - dist / st.rangeM;
  return Math.max(0, rt.diffractionBase - obstruction / rt.diffractionScaleM);
}

/** 全セルの電波強度（森林補正前）。全局の max */
export function computeRadioCoverage(
  g: HeightGrid,
  stations: readonly RadioStationDef[],
  outsideElevM: number,
  tuning: Tuning = TUNING,
): Float32Array {
  const n = g.n;
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz += 1) {
    const z = vertexZ(g, iz);
    for (let ix = 0; ix < n; ix += 1) {
      const i = iz * n + ix;
      const x = vertexX(g, ix);
      const ground = g.heights[i]!;
      let best = 0;
      for (const st of stations) {
        // 見通しがあっても今の最大を超えられない局は計算しない
        const dx = st.x - x;
        const dz = st.z - z;
        const upper = Math.max(1 - Math.sqrt(dx * dx + dz * dz) / st.rangeM, tuning.radio.diffractionBase);
        if (upper <= best) continue;
        const s = stationStrength(g, outsideElevM, x, z, ground, st, tuning);
        if (s > best) best = s;
      }
      out[i] = best;
    }
  }
  return out;
}

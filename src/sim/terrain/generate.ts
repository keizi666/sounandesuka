/**
 * 手続き生成の地形（docs/04 §3.2）。作者が置いた尾根・谷・段差（滝）に従い、ノイズと熱侵食で細部を足す。
 * 乱数は terrain.seed から派生したものだけを使う。
 */
import { DEG, dpow, dtan } from '../core/dmath';
import { deriveSeed } from '../core/rng';
import { TUNING, type Tuning } from '../tuning';
import type { MapDef, ProceduralTerrainDef } from '../types';
import { lerp, nearestOnPolyline, newNearest, preparePolyline, smoothstep, type PreparedPolyline } from './geom';
import { createNoise2D, fbm, ridged } from './noise';
import { gridGeom, vertexX, vertexZ, type GridGeom } from './sample';

/** ノイズの種類ごとのシード派生番号 */
export const NOISE_SALT = { fbm: 1, ridged: 2, forestLine: 3 } as const;

interface RidgeP {
  pl: PreparedPolyline;
  width: number;
  power: number;
}
interface ValleyP {
  id: string;
  pl: PreparedPolyline;
  width: number;
}
interface KnickP {
  valleyIndex: number;
  x: number;
  z: number;
  along: number;
  drop: number;
  radius: number;
}

export function isProcedural(def: MapDef): def is MapDef & { terrain: ProceduralTerrainDef } {
  return def.terrain.type === undefined || def.terrain.type === 'procedural';
}

export function generateProceduralHeights(
  def: MapDef & { terrain: ProceduralTerrainDef },
  tuning: Tuning = TUNING,
): Float32Array {
  const t = def.terrain;
  const tt = tuning.terrain;
  const g = gridGeom(def.size, def.resolution);
  const n = g.n;
  const fbmN = createNoise2D(deriveSeed(t.seed, NOISE_SALT.fbm));
  const ridN = createNoise2D(deriveSeed(t.seed, NOISE_SALT.ridged));
  const ridges: RidgeP[] = t.ridges.map((r) => ({ pl: preparePolyline(r.points), width: r.width, power: r.power }));
  const valleys: ValleyP[] = t.valleys.map((v) => ({ id: v.id, pl: preparePolyline(v.points), width: v.width }));
  const tmp = newNearest();
  const knicks: KnickP[] = t.knickpoints.map((k) => {
    const vi = valleys.findIndex((v) => v.id === k.valley);
    if (vi < 0) throw new Error(`knickpoint "${k.id}" の谷 "${k.valley}" がありません`);
    const along = nearestOnPolyline(valleys[vi]!.pl, k.x, k.z, tmp).along;
    return { valleyIndex: vi, x: k.x, z: k.z, along, drop: k.drop, radius: k.radius };
  });
  const valleyNear = valleys.map(() => newNearest());
  const stepW = tt.knickStepCells * g.cell;

  const h = new Float64Array(n * n);
  for (let iz = 0; iz < n; iz += 1) {
    const z = vertexZ(g, iz);
    for (let ix = 0; ix < n; ix += 1) {
      const x = vertexX(g, ix);
      // 1. 基盤
      const b =
        t.baseElevation +
        t.baseTilt.dx * x +
        t.baseTilt.dz * z +
        t.noise.fbmAmp * fbm(fbmN, x / t.noise.fbmScale, z / t.noise.fbmScale, t.noise.octaves);
      // 2. 尾根（全尾根の max）
      let hv = b;
      let domHl = -Infinity;
      let domD = Infinity;
      let domInfl = 0;
      for (const r of ridges) {
        const q = nearestOnPolyline(r.pl, x, z, tmp);
        const infl = dpow(1 - smoothstep(0, r.width, q.d), r.power);
        const rv = b + (q.v - b) * infl;
        if (rv > hv) {
          hv = rv;
          domHl = q.v;
          domD = q.d;
          domInfl = infl;
        }
      }
      // 3. 岩稜の細部（尾根の高い所だけ。ポリライン上では弱める）
      if (domInfl > 0) {
        const above = smoothstep(t.noise.ridgedAbove - tt.ridgedBlendM, t.noise.ridgedAbove + tt.ridgedBlendM, domHl);
        if (above > 0) {
          const onLine = lerp(tt.ridgedOnPolylineFactor, 1, smoothstep(0, tt.ridgedPolylineFadeM, domD));
          const rn = ridged(ridN, x / t.noise.ridgedScale, z / t.noise.ridgedScale, t.noise.octaves);
          hv += t.noise.ridgedAmp * rn * above * onLine * domInfl;
        }
      }
      // 4. 谷の刻み（重なる所は深い方）
      let cut = 0;
      for (let vi = 0; vi < valleys.length; vi += 1) {
        const v = valleys[vi]!;
        const q = nearestOnPolyline(v.pl, x, z, valleyNear[vi]!);
        const c = q.v * dpow(1 - smoothstep(0, v.width, q.d), 2);
        if (c > cut) cut = c;
      }
      hv -= cut;
      // 5. 段差（滝）: 下流側の谷の中心付近を drop 下げる。下流で徐々に戻す
      for (const k of knicks) {
        const q = valleyNear[k.valleyIndex]!;
        if (q.d >= k.radius) continue;
        const along = q.along;
        const longF =
          smoothstep(k.along, k.along + stepW, along) *
          (1 - smoothstep(k.along + tt.knickFadeStartM, k.along + tt.knickFadeEndM, along));
        const latF = 1 - smoothstep(k.radius * tt.knickLateralInner, k.radius, q.d);
        hv -= k.drop * longF * latF;
      }
      h[iz * n + ix] = hv;
    }
  }

  // 6. 熱侵食（滝の周りは除外して段差を残す）
  const exclude = new Uint8Array(n * n);
  for (const k of knicks) {
    const r = k.radius * tt.erosionExcludeFactor;
    markDisc(g, exclude, k.x, k.z, r);
  }
  thermalErosion(g, h, t.erosion.thermalIterations, dtan(t.erosion.talusDeg * DEG), tuning.terrain.erosionRate, exclude);

  return Float32Array.from(h);
}

function markDisc(g: GridGeom, mask: Uint8Array, cx: number, cz: number, r: number): void {
  const n = g.n;
  for (let iz = 0; iz < n; iz += 1) {
    const dz = vertexZ(g, iz) - cz;
    if (Math.abs(dz) > r) continue;
    for (let ix = 0; ix < n; ix += 1) {
      const dx = vertexX(g, ix) - cx;
      if (dx * dx + dz * dz <= r * r) mask[iz * n + ix] = 1;
    }
  }
}

// 前方 4 近傍（各ペアを 1 回だけ扱う）: [dx, dz]
const PAIR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

/**
 * 熱侵食。安息角を超える隣接差の超過分を、高い方から低い方へ一定割合ずつ移す。
 * 全ペアの移動量を先に集めてから適用するので、走査順に結果が依存しない（決定論）。
 */
export function thermalErosion(
  g: GridGeom,
  h: Float64Array,
  iterations: number,
  tanTalus: number,
  rate: number,
  exclude: Uint8Array,
): void {
  const n = g.n;
  const delta = new Float64Array(n * n);
  const K = PAIR_OFFSETS.length;
  const lim = new Float64Array(K);
  const offX = new Int32Array(K);
  const offI = new Int32Array(K);
  for (let k = 0; k < K; k += 1) {
    const [dx, dz] = PAIR_OFFSETS[k]!;
    lim[k] = tanTalus * g.cell * Math.sqrt(dx * dx + dz * dz);
    offX[k] = dx;
    offI[k] = dz * n + dx;
  }
  for (let it = 0; it < iterations; it += 1) {
    delta.fill(0);
    for (let iz = 0; iz < n; iz += 1) {
      const lastRow = iz === n - 1;
      for (let ix = 0; ix < n; ix += 1) {
        const i = iz * n + ix;
        if (exclude[i]) continue;
        for (let k = 0; k < K; k += 1) {
          const jx = ix + offX[k]!;
          if (jx < 0 || jx >= n || (lastRow && k > 0)) continue;
          const j = i + offI[k]!;
          if (exclude[j]) continue;
          const diff = h[i]! - h[j]!;
          const ex = Math.abs(diff) - lim[k]!;
          if (ex <= 0) continue;
          const a = rate * ex;
          if (diff > 0) {
            delta[i]! -= a;
            delta[j]! += a;
          } else {
            delta[i]! += a;
            delta[j]! -= a;
          }
        }
      }
    }
    for (let i = 0; i < h.length; i += 1) h[i]! += delta[i]!;
  }
}

/**
 * 地理院地図（ベクトルタイル）の植生記号から、植生の塗り（vegetation.overrides）を作る（docs/16、docs/15 §4）。
 * 地形図の植生記号は面の境界を持たず、その植生の範囲の中に一定の間隔で置かれた点なので、各セルに「いちばん近い記号」の植生を当てる
 * （遠すぎるセルは自動のまま）。塗り替えるのは森林のセルと、傾斜だけで「岩」「崖」とされたセルのうち steepForestMaxDeg まで
 * （奥多摩のような山では 40〜58° の急斜面も植林や自然林に覆われている。地形図で森林の記号があるなら森）。沢とそれより急な崖は残す。
 * 見た目と植生の分類だけを変える（転落・道外の判定は傾斜で決まるので、急斜面の危険は変わらない）。
 */
import { VegClass, type GridOverride, type MapRuntime } from '../../sim/types';
import { encodeGrid } from '../../sim/terrain/codec';
import { decodeMvtPoints } from './mvt';
import { toXZ } from './projection';
import { GSI_BASE, tileToLonLat } from './tiles';

/** 地理院ベクトルタイル（最適化ベクトルタイル）。植生記号は注記の層 Anno の vt_code */
export const GSI_VECTOR_ZOOM = 16;
export function vectorTileUrl(z: number, x: number, y: number): string {
  return `${GSI_BASE}/optimal_bvmap-v1/${z}/${x}/${y}.pbf`;
}

/** 植生記号の vt_code（地理院ベクトルタイルの注記分類）→ このシミュレーターの植生。森林以外（田・畑・荒地など）は扱わない */
export const VEG_SYMBOL: Record<number, { name: string; veg: number }> = {
  6321: { name: '広葉樹林', veg: VegClass.BROADLEAF },
  6322: { name: '針葉樹林', veg: VegClass.CONIFER },
};

export interface VegSymbol {
  lat: number;
  lon: number;
  code: number;
}

/** タイル 1 枚から植生記号を取り出す */
export function vegSymbolsFromTile(buf: Uint8Array, z: number, tx: number, ty: number): VegSymbol[] {
  const out: VegSymbol[] = [];
  for (const p of decodeMvtPoints(buf, ['Anno'])) {
    const code = Number(p.props['vt_code']);
    if (!VEG_SYMBOL[code]) continue;
    const ll = tileToLonLat(tx + p.x / p.extent, ty + p.y / p.extent, z);
    out.push({ lat: ll.lat, lon: ll.lon, code });
  }
  return out;
}

/** なめらかな値ノイズ（0..1）。境界を地形らしく揺らすためだけに使う（決定的） */
function valueNoise(x: number, z: number): number {
  const h = (i: number, j: number): number => {
    let t = (i * 374761393 + j * 668265263) | 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
  const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
  return a + (b - a) * sz;
}

/**
 * 記号から塗りを作る。maxDistM より遠いセルは自動のまま。
 * 返り値の counts は塗ったセルの数（植生ごと）
 */
export function vegOverridesFromSymbols(
  map: MapRuntime,
  lat0: number,
  lon0: number,
  symbols: readonly VegSymbol[],
  maxDistM = 350,
  jitterM = 120,
  steepForestMaxDeg = 58,
): { overrides: GridOverride; counts: Record<string, number> } {
  const n = map.n;
  const pts = symbols.map((s) => ({ ...toXZ(lat0, lon0, s), veg: VEG_SYMBOL[s.code]!.veg }));
  const grid = new Uint8Array(n * n);
  const counts: Record<string, number> = {};
  // 近い記号を探すための格子（maxDistM ごとのバケツ）
  const B = maxDistM;
  const buckets = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / B)},${Math.floor(p.z / B)}`;
    const arr = buckets.get(k);
    if (arr) arr.push(p);
    else buckets.set(k, [p]);
  }
  for (let iz = 0; iz < n; iz += 1) {
    const z = iz * map.cell - map.half;
    for (let ix = 0; ix < n; ix += 1) {
      const i = iz * n + ix;
      const v = map.veg[i]!;
      if (v !== VegClass.BROADLEAF && v !== VegClass.CONIFER && v !== VegClass.ROCK && !(v === VegClass.CLIFF && map.slopeDeg[i]! < steepForestMaxDeg)) continue;
      // 境界が直線にならないよう、探す位置を ±jitterM ほど揺らす（2 つの周期を重ねる）
      const x0 = ix * map.cell - map.half;
      const jx = (valueNoise(x0 / 180, z / 180) - 0.5) * jitterM + (valueNoise(x0 / 60 + 31, z / 60 + 17) - 0.5) * jitterM * 0.4;
      const jz = (valueNoise(x0 / 180 + 53, z / 180 + 71) - 0.5) * jitterM + (valueNoise(x0 / 60 + 97, z / 60 + 5) - 0.5) * jitterM * 0.4;
      const x = x0 + jx;
      const zz = z + jz;
      const bx = Math.floor(x / B);
      const bz = Math.floor(zz / B);
      let best = maxDistM * maxDistM;
      let veg = -1;
      for (let dz = -1; dz <= 1; dz += 1)
        for (let dx = -1; dx <= 1; dx += 1)
          for (const p of buckets.get(`${bx + dx},${bz + dz}`) ?? []) {
            const d = (p.x - x) * (p.x - x) + (p.z - zz) * (p.z - zz);
            if (d < best) (best = d), (veg = p.veg);
          }
      if (veg < 0) continue;
      grid[i] = veg + 1;
      const name = veg === VegClass.CONIFER ? 'conifer' : 'broadleaf';
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return { overrides: encodeGrid(grid), counts };
}

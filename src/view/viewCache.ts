/**
 * シナリオ開始時に作る 3D のデータのキャッシュ（ユーザーの指定: 同じ地図・同じ条件なら作り直さない）。
 * - 地面のマスクの画素（地図で決まる）
 * - 地形のメッシュの頂点（地図・季節・画質・鉛直誇張で決まる）
 * - 木の配置（地図・画質・鉛直誇張で決まる。雪に埋もれる分はあとで外す）
 * 画面を開く前に loadViewPre で読み、SceneView に渡す。SceneView が作ったものは saveViewPre で入れる。
 */
import { cacheGet, cacheKey, cachePut } from '../app/cacheStore';
import { mapHash } from '../app/data';
import type { MapRuntime } from '../sim/types';
import type { TerrainArrays } from './terrainMesh';
import type { Instance } from './vegetation';

export interface ViewPre {
  masks?: Uint8ClampedArray;
  terrain?: TerrainArrays;
  trees?: Instance[];
}

export interface ViewKeys {
  masks: string;
  terrain: string;
  trees: string;
}

export function viewKeys(map: MapRuntime, season: string, quality: string, vExag: number): ViewKeys {
  const h = mapHash(map.def);
  const vx = vExag.toFixed(3);
  return {
    masks: cacheKey('masks', h),
    terrain: cacheKey('terrain', h, season, quality, vx),
    trees: cacheKey('trees', h, quality, vx),
  };
}

export async function loadViewPre(keys: ViewKeys): Promise<ViewPre> {
  const [masks, terrain, trees] = await Promise.all([cacheGet<Uint8ClampedArray>(keys.masks), cacheGet<TerrainArrays>(keys.terrain), cacheGet<Instance[]>(keys.trees)]);
  return { ...(masks ? { masks } : {}), ...(terrain ? { terrain } : {}), ...(trees ? { trees } : {}) };
}

/** 新しく作ったものだけ入れる（キャッシュから読んだものは入れ直さない） */
export function saveViewPre(keys: ViewKeys, made: ViewPre): void {
  if (made.masks) void cachePut(keys.masks, made.masks);
  if (made.terrain) void cachePut(keys.terrain, made.terrain);
  if (made.trees) void cachePut(keys.trees, made.trees);
}

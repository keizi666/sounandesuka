/**
 * 投影（docs/16 §1）: 局所接平面（正距円筒の近似）。原点 = エリア中心、x 東・z 南（メートル）。
 */
export const EARTH_R = 6378137;
const D = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export function toXZ(lat0: number, lon0: number, p: LatLon): { x: number; z: number } {
  return { x: (p.lon - lon0) * D * EARTH_R * Math.cos(lat0 * D), z: -(p.lat - lat0) * D * EARTH_R };
}

export function toLatLon(lat0: number, lon0: number, x: number, z: number): LatLon {
  return { lat: lat0 - z / (D * EARTH_R), lon: lon0 + x / (D * EARTH_R * Math.cos(lat0 * D)) };
}

/** 一辺に応じた解像度（docs/16 §3.1）。一辺はセルが整数メートルになるよう丸める */
export function gridFor(sizeM: number): { size: number; resolution: 257 | 385 | 513; cell: number } {
  const resolution = sizeM < 4000 ? 257 : sizeM < 6000 ? 385 : 513;
  const cell = Math.max(1, Math.round(sizeM / (resolution - 1)));
  return { size: cell * (resolution - 1), resolution, cell };
}

/** エリアの外接矩形（緯度経度） */
export function bboxOf(lat0: number, lon0: number, sizeM: number): { south: number; west: number; north: number; east: number } {
  const a = toLatLon(lat0, lon0, -sizeM / 2, sizeM / 2);
  const b = toLatLon(lat0, lon0, sizeM / 2, -sizeM / 2);
  return { south: a.lat, west: a.lon, north: b.lat, east: b.lon };
}

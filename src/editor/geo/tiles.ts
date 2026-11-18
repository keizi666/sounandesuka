/**
 * Web メルカトルのタイル座標（docs/16 §1）と地理院タイルの URL（docs/15 §4 の表のものだけ）。
 */
export const GSI_BASE = 'https://cyberjapandata.gsi.go.jp/xyz';
export type BaseLayer = 'std' | 'pale' | 'seamlessphoto' | 'hillshademap';

export function tileUrl(layer: BaseLayer | 'dem_png' | 'dem5a_png', z: number, x: number, y: number): string {
  const ext = layer === 'seamlessphoto' ? 'jpg' : 'png';
  return `${GSI_BASE}/${layer}/${z}/${x}/${y}.${ext}`;
}

/** 緯度経度 → タイル内の連続座標（ズーム z） */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

export function tileToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** 地理院の標高タイルの画素 → 標高 m（無効値は null。docs/16 §3.2） */
export function demPixelToElev(r: number, g: number, b: number): number | null {
  const x = r * 65536 + g * 256 + b;
  if (x === 8388608) return null;
  return x < 8388608 ? x * 0.01 : (x - 16777216) * 0.01;
}

/** 矩形を覆うタイルの一覧 */
export function tilesCovering(b: { south: number; west: number; north: number; east: number }, z: number): { x: number; y: number }[] {
  const a = lonLatToTile(b.west, b.north, z);
  const c = lonLatToTile(b.east, b.south, z);
  const out: { x: number; y: number }[] = [];
  for (let y = Math.floor(a.y); y <= Math.floor(c.y); y += 1) for (let x = Math.floor(a.x); x <= Math.floor(c.x); x += 1) out.push({ x, y });
  return out;
}

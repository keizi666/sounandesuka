/**
 * 範囲（中心・一辺）を変えたとき、地図の中身を同じ緯度経度に保つ（ユーザーの指定: 標高を取ったあとも範囲を動かしたい）。
 * ワールド座標は範囲の中心からの m なので、中心が動いたぶん、地点・道・危険・基地局・建物・道路・地図記号・送電線をずらす。
 * 植生の塗り・電波の塗り（格子）は、新しい格子の各点が古い格子のどこに当たるかで写し直す（外に出た所は 0 = 自動）。
 * 地形（標高）は呼び出し側が取り直す。
 */
import { decodeGrid, encodeGrid } from '../../sim/terrain/codec';
import type { GridOverride, MapDef } from '../../sim/types';
import { toXZ } from './projection';

export interface Frame {
  lat: number;
  lon: number;
  size: number;
  resolution: number;
}

/** 格子の塗りを、古い範囲から新しい範囲へ写す。dx・dz は新しい中心の古い範囲での位置（m） */
function remapGrid(g: GridOverride | undefined, from: Frame, to: Frame, dx: number, dz: number): GridOverride | undefined {
  if (!g) return undefined;
  const n0 = from.resolution;
  const old = decodeGrid(g, n0 * n0);
  const n1 = to.resolution;
  const out = new Uint8Array(n1 * n1);
  const c0 = from.size / (n0 - 1);
  const c1 = to.size / (n1 - 1);
  let any = false;
  for (let iz = 0; iz < n1; iz += 1) {
    const z = -to.size / 2 + iz * c1 + dz;
    const jz = Math.round((z + from.size / 2) / c0);
    if (jz < 0 || jz >= n0) continue;
    for (let ix = 0; ix < n1; ix += 1) {
      const x = -to.size / 2 + ix * c1 + dx;
      const jx = Math.round((x + from.size / 2) / c0);
      if (jx < 0 || jx >= n0) continue;
      const v = old[jz * n0 + jx]!;
      out[iz * n1 + ix] = v;
      if (v !== 0) any = true;
    }
  }
  return any ? encodeGrid(out) : undefined;
}

/** 地点・道・危険・基地局・建物・道路・地図記号・送電線を (dx, dz) m だけ逆にずらす（中心が (dx, dz) へ動いたとき） */
export function shiftContents(map: MapDef, dx: number, dz: number): void {
  if (dx === 0 && dz === 0) return;
  const mv = (p: { x: number; z: number }): void => {
    p.x -= dx;
    p.z -= dz;
  };
  const mvPt = (p: [number, number]): void => {
    p[0] -= dx;
    p[1] -= dz;
  };
  for (const n of map.nodes) mv(n);
  for (const e of map.edges) for (const w of e.waypoints) mvPt(w);
  for (const h of map.hazards) if ('x' in h) mv(h);
  for (const s of map.radio.stations) mv(s);
  for (const l of map.landmarks ?? []) mv(l);
  for (const pl of map.powerLines ?? []) for (const p of pl.pts) mvPt(p);
  if (map.urban) {
    for (const b of map.urban.buildings) {
      b[0] -= dx;
      b[1] -= dz;
    }
    for (const l of map.urban.lines) for (const p of l.pts) mvPt(p);
  }
}

/** 新しい中心の、古い範囲での位置（m） */
export function centerShift(from: Frame, to: Frame): { dx: number; dz: number } {
  const d = toXZ(from.lat, from.lon, { lat: to.lat, lon: to.lon });
  return { dx: d.x, dz: d.z };
}

/** 植生の塗り・電波の塗りを from の範囲から to の範囲へ写す（中身の座標は動かさない） */
export function remapGrids(map: MapDef, from: Frame, to: Frame): void {
  const { dx, dz } = centerShift(from, to);
  const veg = remapGrid(map.vegetation.overrides, from, to, dx, dz);
  if (veg) map.vegetation.overrides = veg;
  else delete map.vegetation.overrides;
  const radio = remapGrid(map.radio.paint, from, to, dx, dz);
  if (radio) map.radio.paint = radio;
  else delete map.radio.paint;
}

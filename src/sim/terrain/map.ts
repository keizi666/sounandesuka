/**
 * MapDef → MapRuntime（高さ・派生レイヤー・スナップ済みノード）。
 * World には入れない静的データ（docs/03 §3）。
 */
import { TUNING, type Tuning } from '../tuning';
import type { MapDef, MapRuntime, NodeDef, NodeId } from '../types';
import { deriveLayers } from './derive';
import { generateProceduralHeights, isProcedural } from './generate';
import { nearestOnPolyline, newNearest, preparePolyline } from './geom';
import { gridGeom, sampleElev, vertexX, vertexZ, type HeightGrid } from './sample';
import { buildTrails } from './trails';
import { decodeHeights } from './codec';

export interface BuildMapOptions {
  /** 電波圏を計算するか（既定 true） */
  radio?: boolean;
  tuning?: Tuning;
}

export interface BuildMapResult {
  map: MapRuntime;
  /** 作者向けの警告（ノードのスナップ量が大きい等） */
  warnings: string[];
}

export function buildHeights(def: MapDef, tuning: Tuning = TUNING): HeightGrid {
  const g = gridGeom(def.size, def.resolution);
  if (!isProcedural(def)) {
    if (def.terrain.type !== 'heightmap') throw new Error(`未対応の terrain.type "${String((def.terrain as { type?: string }).type)}"`);
    return { ...g, heights: decodeHeights(def.terrain, g.n * g.n) };
  }
  return { ...g, heights: generateProceduralHeights(def, tuning) };
}

export function buildMapRuntime(def: MapDef, opts: BuildMapOptions = {}): BuildMapResult {
  const tuning = opts.tuning ?? TUNING;
  const warnings: string[] = [];
  const grid = buildHeights(def, tuning);
  const layers = deriveLayers(def, grid, { radio: opts.radio ?? true, tuning });
  const nodes: Record<NodeId, NodeDef & { elevM: number }> = {};
  for (const nd of def.nodes) {
    const snapped = snapNode(def, grid, nd, tuning);
    if (snapped.skipped) warnings.push(`ノード ${nd.id} はスナップしませんでした: ${snapped.skipped}`);
    if (snapped.moved > tuning.terrain.nodeSnapWarnM) {
      warnings.push(`ノード ${nd.id} のスナップ量が ${snapped.moved.toFixed(0)} m あります（${tuning.terrain.nodeSnapWarnM} m 超）`);
    }
    nodes[nd.id] = { ...nd, x: snapped.x, z: snapped.z, elevM: sampleElev(grid, snapped.x, snapped.z) };
  }
  const map: MapRuntime = {
    def,
    n: grid.n,
    cell: grid.cell,
    half: grid.half,
    heights: grid.heights,
    ...layers,
    nodes,
    trails: {},
    adjacency: {},
  };
  buildTrails(map, tuning);
  return { map, warnings };
}

/**
 * ノードのスナップ（docs/04 §3.2 の 7）。peak は半径内の最高点、saddle は尾根線上の最低点へ。
 * procedural では既定でスナップし、heightmap では snap: true のノードだけ。
 * 最高点・最低点が探索範囲の縁にある（＝そこは頂上・鞍部ではなく斜面の途中）場合は動かさず理由を返す（DECISIONS）。
 */
export function snapNode(
  def: MapDef,
  g: HeightGrid,
  nd: NodeDef,
  tuning: Tuning = TUNING,
): { x: number; z: number; moved: number; skipped?: string } {
  const enabled = nd.snap ?? isProcedural(def);
  const r = tuning.terrain.nodeSnapRadiusM;
  const keep = (why: string) => ({ x: nd.x, z: nd.z, moved: 0, skipped: why });
  if (enabled && nd.type === 'peak') {
    let best = -Infinity;
    let bx = nd.x;
    let bz = nd.z;
    for (let iz = 0; iz < g.n; iz += 1) {
      const vz = vertexZ(g, iz);
      if (Math.abs(vz - nd.z) > r) continue;
      for (let ix = 0; ix < g.n; ix += 1) {
        const vx = vertexX(g, ix);
        if (dist2(vx, vz, nd.x, nd.z) > r * r) continue;
        const h = g.heights[iz * g.n + ix]!;
        if (h > best) {
          best = h;
          bx = vx;
          bz = vz;
        }
      }
    }
    if (Math.sqrt(dist2(bx, bz, nd.x, nd.z)) > r - g.cell) return keep('半径内に頂上がない（斜面が続いている）');
    return { x: bx, z: bz, moved: Math.sqrt(dist2(bx, bz, nd.x, nd.z)) };
  }
  if (enabled && nd.type === 'saddle' && isProcedural(def)) {
    let best = Infinity;
    let bx = nd.x;
    let bz = nd.z;
    const q = newNearest();
    const step = g.cell / 2;
    for (const ridge of def.terrain.ridges) {
      const pl = preparePolyline(ridge.points);
      if (nearestOnPolyline(pl, nd.x, nd.z, q).d > r) continue;
      // 尾根線を細かくたどり、ノードから r 以内の区間の最低点。区間の端なら鞍部ではない
      const inside: { x: number; z: number; h: number }[] = [];
      for (let i = 0; i < pl.xs.length - 1; i += 1) {
        const ax = pl.xs[i]!;
        const az = pl.zs[i]!;
        const len = pl.cum[i + 1]! - pl.cum[i]!;
        const steps = Math.max(1, Math.ceil(len / step));
        for (let s = i === 0 ? 0 : 1; s <= steps; s += 1) {
          const px = ax + ((pl.xs[i + 1]! - ax) * s) / steps;
          const pz = az + ((pl.zs[i + 1]! - az) * s) / steps;
          if (dist2(px, pz, nd.x, nd.z) <= r * r) inside.push({ x: px, z: pz, h: sampleElev(g, px, pz) });
        }
      }
      let mi = -1;
      for (let k = 0; k < inside.length; k += 1) if (mi < 0 || inside[k]!.h < inside[mi]!.h) mi = k;
      if (mi <= 0 || mi >= inside.length - 1) continue;
      const m = inside[mi]!;
      if (m.h < best) {
        best = m.h;
        bx = m.x;
        bz = m.z;
      }
    }
    if (best === Infinity) return keep('近くの尾根線上に鞍部がない');
    return { x: bx, z: bz, moved: Math.sqrt(dist2(bx, bz, nd.x, nd.z)) };
  }
  return { x: nd.x, z: nd.z, moved: 0 };
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

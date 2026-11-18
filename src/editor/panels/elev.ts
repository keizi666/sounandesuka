import { sampleElev } from '../../sim/terrain/sample';
import type { MapRuntime } from '../../sim/types';

/** 箱庭の標高（双線形補間）。MapRuntime は HeightGrid と同じ形を持つ */
export function sampleElevAt(rt: MapRuntime, x: number, z: number): number {
  return sampleElev(rt, x, z);
}

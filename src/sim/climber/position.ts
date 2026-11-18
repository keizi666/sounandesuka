/** 登山者の位置表現 ClimberPos ⇔ ワールド座標（docs/04 §5.5） */
import { sampleElev } from '../terrain/sample';
import { pointOnTrail } from '../terrain/trails';
import type { ClimberPos, ClimberState, MapRuntime } from '../types';

export function posToWorld(map: MapRuntime, pos: ClimberPos): { x: number; z: number; elevM: number } {
  switch (pos.mode) {
    case 'node': {
      const nd = map.nodes[pos.nodeId];
      if (!nd) throw new Error(`ノード "${pos.nodeId}" がありません`);
      return { x: nd.x, z: nd.z, elevM: nd.elevM };
    }
    case 'edge': {
      const t = map.trails[pos.edgeId];
      if (!t) throw new Error(`エッジ "${pos.edgeId}" がありません`);
      return pointOnTrail(t, pos.s);
    }
    case 'free':
      return { x: pos.x, z: pos.z, elevM: sampleElev(map, pos.x, pos.z) };
  }
}

/** pos から x・z・elevM のキャッシュを更新する */
export function syncPosition(map: MapRuntime, c: ClimberState): void {
  const p = posToWorld(map, c.pos);
  c.x = p.x;
  c.z = p.z;
  c.elevM = p.elevM;
}

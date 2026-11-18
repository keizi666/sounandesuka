/**
 * 登山道のリボン（地表 +0.5 m）（docs/10 §2）。小屋・標識は structures.ts。
 * 偽の道は神の視点でだけ薄く表示する。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { UNIT, type ViewScale } from './scale';

function ribbon(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width * 0.5;
    const nz = (dx / len) * width * 0.5;
    pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TrailLayer {
  group: THREE.Group;
  falseTrails: THREE.Object3D[];
}

export function buildTrails(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number): TrailLayer {
  const group = new THREE.Group();
  const falseTrails: THREE.Object3D[] = [];
  const lift = 1.2 * UNIT * s.vExag;
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xe8d9b5, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const falseMat = new THREE.MeshBasicMaterial({ color: 0xc89a6a, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const t of Object.values(map.trails)) {
    const pts = t.samples.map((p) => {
      const x = p.x * UNIT;
      const z = p.z * UNIT;
      return new THREE.Vector3(x, heightAt(x, z) + lift, z);
    });
    const w = (t.def.kind === 'false' ? 5 : 7) * UNIT * 1.6;
    const mesh = new THREE.Mesh(ribbon(pts, w), t.def.kind === 'false' ? falseMat : trailMat);
    mesh.renderOrder = 2;
    group.add(mesh);
    if (t.def.kind === 'false') falseTrails.push(mesh);
  }
  return { group, falseTrails };
}

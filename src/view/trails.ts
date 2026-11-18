/**
 * 登山道のリボン（地表 +0.5 m）と小屋・標識（docs/10 §2、§5.3）。
 * 偽の道は神の視点でだけ薄く表示する。建物は石積みの土台・板張りの壁・トタン屋根・煙突・夜に灯る窓。
 */
import * as THREE from 'three';
import type { MapRuntime } from '../sim/types';
import { UNIT, type ViewScale } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

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

/** 小屋（営業小屋は大きめ、避難小屋は小さく石積み）。窓の材質を返して夜に灯す */
export function buildStructures(map: MapRuntime, s: ViewScale, heightAt: (x: number, z: number) => number, env: EnvUniforms): { group: THREE.Group; windows: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const k = UNIT * 2.0; // 建物も樹木と同じくやや大きめ
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a35, roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x7c2f24, roughness: 0.55, metalness: 0.3 });
  const windows = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc46b, emissiveIntensity: 0 });
  for (const m of [stone, wood, roof]) injectEnv(m, env);
  for (const nd of Object.values(map.nodes)) {
    const x = nd.x * UNIT;
    const z = nd.z * UNIT;
    const y = heightAt(x, z);
    if (nd.shelter) {
      const staffed = nd.shelter.kind === 'staffed';
      const w = (staffed ? 14 : 7) * k;
      const d = (staffed ? 9 : 6) * k;
      const h = (staffed ? 5 : 3) * k;
      const hut = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, h * 0.3, d * 1.05), stone);
      base.position.y = h * 0.15;
      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), staffed ? wood : stone);
      walls.position.y = h * 0.3 + h / 2;
      const rf = new THREE.Mesh(new THREE.CylinderGeometry(0, w * 0.75, h * 0.7, 4, 1), roof);
      rf.rotation.y = Math.PI / 4;
      rf.scale.set(1, 1, d / w);
      rf.position.y = h * 1.3 + h * 0.35;
      hut.add(base, walls, rf);
      if (staffed) {
        const chim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.08, h * 0.6, w * 0.08), stone);
        chim.position.set(w * 0.25, h * 1.8, 0);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, h * 0.25), windows);
        win.position.set(0, h * 0.85, d / 2 + 0.0002);
        hut.add(chim, win);
      }
      hut.position.set(x, y, z);
      hut.rotation.y = (nd.x * 13 + nd.z * 7) % Math.PI;
      hut.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      group.add(hut);
    } else if (nd.type === 'peak' || nd.type === 'trailhead' || nd.type === 'junction') {
      // 標識: 木の柱と板
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * k, 0.25 * k, 3 * k, 5), wood);
      post.position.set(x, y + 1.5 * k, z);
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.2 * k, 0.6 * k, 0.15 * k), wood);
      board.position.set(x, y + 2.6 * k, z);
      post.castShadow = true;
      group.add(post, board);
    }
  }
  return { group, windows };
}

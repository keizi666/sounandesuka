/**
 * 登山者の人形（docs/10 §5.1）。ブロック玩具風のオリジナルの人形（特定製品の形の複製はしない）。
 * 頭（円柱、Canvas の顔）・胴・腕・手・腰・脚の剛体部品を関節の回転だけで動かす（スキニングなし）。
 * 姿勢: 歩く・座る・しゃがむ・震える・ふらつく・倒れる。死亡は横倒しのまま静止し、人形とマーカーが灰色になる。
 */
import * as THREE from 'three';
import type { BehaviorState, ClimberState } from '../sim/types';

export type Face = 'normal' | 'tired' | 'cold' | 'closed';

const faceCache = new Map<Face, THREE.CanvasTexture>();

function faceTexture(face: Face): THREE.CanvasTexture {
  const hit = faceCache.get(face);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c94c';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#222';
  g.strokeStyle = '#222';
  g.lineWidth = 3;
  // 顔は円柱の前（u = 0.5 付近）に描く
  const cx = 64;
  if (face === 'closed') {
    g.beginPath();
    g.moveTo(cx - 14, 26);
    g.lineTo(cx - 6, 26);
    g.moveTo(cx + 6, 26);
    g.lineTo(cx + 14, 26);
    g.stroke();
  } else {
    g.beginPath();
    g.arc(cx - 10, 26, 3, 0, Math.PI * 2);
    g.arc(cx + 10, 26, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  if (face === 'normal') g.arc(cx, 36, 9, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (face === 'tired') {
    g.moveTo(cx - 7, 42);
    g.lineTo(cx + 7, 40);
  } else {
    g.moveTo(cx - 7, 41);
    g.lineTo(cx + 7, 41);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(face, tex);
  return tex;
}

/** 部品の寸法（人形の高さ 1.0 に正規化） */
const H = { leg: 0.36, hip: 0.08, torso: 0.3, head: 0.2, arm: 0.28 };

export interface Figure {
  root: THREE.Group;
  update(c: ClimberState, timeSec: number, selected: boolean): void;
  dispose(): void;
}

function phongish(color: number | THREE.Color, rough = 0.35): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: 0.6, clearcoatRoughness: 0.3 });
}

/** heightScene: シーン単位での人形の高さ（拡大率込み） */
export function createFigure(c: ClimberState, heightScene: number): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 姿勢（倒れる回転）用
  root.add(body);
  const jacket = new THREE.Color(c.def.color);
  const clothes = new THREE.Color().setHSL((c.id.length * 0.13) % 1, 0.25, 0.42);
  const torsoMat = phongish(clothes);
  const legMat = phongish(0x3b3f48);
  const skin = phongish(0xf2c94c, 0.4);
  const packMat = phongish(0x5a5f3a, 0.6);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, H.torso, 4, 1), torsoMat);
  torso.rotation.y = Math.PI / 4;
  torso.scale.set(1, 1, 0.6);
  torso.position.y = H.leg + H.hip + H.torso / 2;
  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.24, H.hip, 0.14), legMat);
  hip.position.y = H.leg + H.hip / 2;
  const headMats = [skin, skin, new THREE.MeshPhysicalMaterial({ map: faceTexture('normal'), roughness: 0.4, clearcoat: 0.5 })];
  const headGeo = new THREE.CylinderGeometry(0.08, 0.08, H.head * 0.75, 16, 1);
  // 側面だけ顔のテクスチャ、上下は黄色
  headGeo.clearGroups();
  const sideCount = headGeo.index!.count - 16 * 6;
  headGeo.addGroup(0, sideCount, 2);
  headGeo.addGroup(sideCount, headGeo.index!.count - sideCount, 0);
  const head = new THREE.Mesh(headGeo, headMats);
  head.position.y = H.leg + H.hip + H.torso + H.head * 0.45;
  head.rotation.y = -Math.PI / 2;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), phongish(jacket));
  hood.position.y = head.position.y + 0.02;
  hood.visible = false;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.05, 12), phongish(0x7a3b2e));
  hat.position.y = head.position.y + H.head * 0.42;
  hat.visible = c.def.gear.hat;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffcc }));
  lamp.position.set(0, head.position.y + 0.03, 0.085);
  lamp.visible = false;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26 * (0.7 + Math.min(1, c.def.packKg / 15) * 0.6), 0.1), packMat);
  pack.position.set(0, H.leg + H.hip + H.torso * 0.55, -0.11);

  const mkLimb = (len: number, w: number, mat: THREE.Material, pivotY: number, x: number): { pivot: THREE.Group; mesh: THREE.Mesh } => {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    mesh.position.y = -len / 2;
    pivot.add(mesh);
    return { pivot, mesh };
  };
  const legL = mkLimb(H.leg, 0.1, legMat, H.leg, -0.065);
  const legR = mkLimb(H.leg, 0.1, legMat, H.leg, 0.065);
  const shoulderY = H.leg + H.hip + H.torso * 0.9;
  const armL = mkLimb(H.arm, 0.07, torsoMat, shoulderY, -0.17);
  const armR = mkLimb(H.arm, 0.07, torsoMat, shoulderY, 0.17);
  for (const a of [armL, armR]) {
    const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), skin);
    hand.position.y = -H.arm - 0.02;
    a.pivot.add(hand);
  }
  body.add(torso, hip, head, hood, hat, lamp, pack, legL.pivot, legR.pivot, armL.pivot, armR.pivot);
  body.traverse((o) => {
    o.castShadow = true;
  });

  // 足元の選択リングとマーカー（死亡時に灰色）
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 32), new THREE.MeshBasicMaterial({ color: jacket, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), new THREE.MeshBasicMaterial({ color: jacket }));
  marker.rotation.x = Math.PI;
  marker.position.y = 1.55;
  root.add(ring, marker);

  // ヘッドランプの光
  const spot = new THREE.SpotLight(0xfff1c4, 0, 0, Math.PI / 6, 0.6, 1.5);
  spot.position.copy(lamp.position);
  spot.target.position.set(0, 0, 3);
  body.add(spot, spot.target);

  root.scale.setScalar(heightScene);
  let face: Face = 'normal';
  const jacketMat = phongish(jacket, 0.2);
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.8 });
  let dead = false;

  return {
    root,
    update(cs: ClimberState, t: number, selected: boolean) {
      const b = cs.body;
      // 雨具: 胴と腕を雨具の色に、フードを付ける。濡れでつやを増す
      const wear = b.rainwearOn ? jacketMat : torsoMat;
      torso.material = wear;
      (armL.mesh.material as THREE.Material) = wear;
      (armR.mesh.material as THREE.Material) = wear;
      hood.visible = b.rainwearOn;
      hat.visible = !b.rainwearOn && cs.def.gear.hat;
      wear.roughness = 0.45 - 0.35 * b.wetness;
      // 顔
      const nf: Face = !b.conscious || !b.alive ? 'closed' : b.coreC < 35.5 ? 'cold' : b.fatigue > 75 ? 'tired' : 'normal';
      if (nf !== face) {
        face = nf;
        (headMats[2] as THREE.MeshPhysicalMaterial).map = faceTexture(face);
        (headMats[2] as THREE.MeshPhysicalMaterial).needsUpdate = true;
      }
      lamp.visible = cs.inv.headlamp.on;
      spot.intensity = cs.inv.headlamp.on ? 3.0 : 0;
      ring.visible = selected;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(t * 4);
      if (!b.alive && !dead) {
        dead = true;
        body.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = deadMat;
        });
        (marker.material as THREE.MeshBasicMaterial).color.set(0x9a9a9a);
      }
      poseFor(cs.state, b.coreC, cs.speedMs, t, { body, legL: legL.pivot, legR: legR.pivot, armL: armL.pivot, armR: armR.pivot, dead });
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
}

interface Rig {
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  dead: boolean;
}

/** 状態から関節角を決める（docs/10 §5.1 の表） */
function poseFor(state: BehaviorState, coreC: number, speedMs: number, t: number, r: Rig): void {
  const lying = state === 'INCAPACITATED' || state === 'UNCONSCIOUS' || state === 'DEAD' || r.dead;
  const sitting = state === 'RESTING' || state === 'BIVOUAC' || state === 'WAITING_RESCUE' || state === 'STAYING' || state === 'SHELTERED' || state === 'LOST_AWARE';
  const moving = speedMs > 0.02 && !lying && !sitting;
  r.body.rotation.set(0, 0, 0);
  r.body.position.set(0, 0, 0);
  for (const j of [r.legL, r.legR, r.armL, r.armR]) j.rotation.set(0, 0, 0);
  if (lying) {
    r.body.rotation.z = Math.PI / 2;
    r.body.position.set(0.1, 0.12, 0);
    return;
  }
  if (sitting) {
    r.legL.rotation.x = -Math.PI / 2;
    r.legR.rotation.x = -Math.PI / 2;
    r.body.position.y = -0.34;
    r.armL.rotation.x = -0.4;
    r.armR.rotation.x = -0.4;
  } else if (moving) {
    const f = 6 + speedMs * 4;
    const sw = Math.sin(t * f) * 0.6;
    r.legL.rotation.x = sw;
    r.legR.rotation.x = -sw;
    r.armL.rotation.x = -sw * 0.8;
    r.armR.rotation.x = sw * 0.8;
    r.body.position.y = Math.abs(Math.cos(t * f)) * 0.02;
    // 軽度低体温症ではふらつく
    if (coreC < 35) r.body.rotation.z = Math.sin(t * 1.7) * 0.12;
  }
  // 震え（止まっていて寒いとき）
  if (!moving && coreC < 36) {
    const amp = coreC < 34 ? 0.02 : 0.01;
    r.body.position.x += Math.sin(t * 60) * amp;
  }
}

/**
 * 野生動物の描画（World.animals を読むだけ）。位置は sim と同じ式（animalPos）で、補間した時刻から求める。
 * 群れは中心のまわりに並べ、1 頭ずつ歩く・走る・草を食む・こちらを見る・座る（サル）の簡単な動きを付ける。
 * 出るときと立ち去るときは、静かに現れて静かに消える（不透明度）。
 */
import * as THREE from 'three';
import { animalGoneMin, animalPos } from '../sim/hazards/animals';
import { TUNING } from '../sim/tuning';
import type { AnimalState, World } from '../sim/types';
import { buildAnimal, type AnimalRig } from './animalModel';
import { UNIT } from './scale';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

interface One {
  rig: AnimalRig;
  /** 群れの中心からのずれ（m。体の向きの座標: x 右、z 前） */
  ox: number;
  oz: number;
  phase: number;
  yaw: number;
  pitch: number;
  seed: number;
}

interface Herd {
  key: string;
  list: One[];
  lastX: number;
  lastZ: number;
  lastT: number;
  speed: number;
}

function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 角度の差（-π..π） */
function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class AnimalsView {
  private herds = new Map<string, Herd>();

  constructor(
    private scene: THREE.Scene,
    private env: EnvUniforms | null,
    private heightAt: (x: number, z: number) => number,
    /** 1 m あたりのシーン単位（位置）。開発用ページでは 1 */
    private unit = UNIT,
  ) {}

  /** tMin: 補間した時刻（ゲーム内分）。sceneScale: 実物 1 m あたりのシーン単位（人形の拡大率込み） */
  update(world: World, tMin: number, timeSec: number, sceneScale: number): void {
    const t = TUNING.animals;
    const alive = new Set<string>();
    for (const a of world.animals ?? []) {
      const key = `${a.id}@${a.fromMin}`;
      if (tMin < a.fromMin - 0.01 || tMin >= animalGoneMin(a, t)) continue;
      alive.add(key);
      let h = this.herds.get(key);
      if (!h) {
        h = this.create(a, key);
        this.herds.set(key, h);
      }
      this.updateHerd(h, a, world, tMin, timeSec, sceneScale);
    }
    for (const [key, h] of this.herds) {
      if (alive.has(key)) continue;
      for (const o of h.list) {
        this.scene.remove(o.rig.root);
        o.rig.dispose();
      }
      this.herds.delete(key);
    }
  }

  private create(a: AnimalState, key: string): Herd {
    const list: One[] = [];
    for (let i = 0; i < a.count; i += 1) {
      const seed = hash01(a.id, i + 1);
      const rig = buildAnimal(a.species, i === 0 && a.count >= 2, (seed - 0.5) * 0.06);
      if (this.env) for (const m of rig.litMaterials) injectEnv(m, this.env, false, false, { rim: 0.9, noFade: true });
      rig.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.scene.add(rig.root);
      // 群れの並び: 1 頭目が中心、ほかはまわりに少しずつ（前後に長く）
      const ang = i * 2.39996 + seed;
      const r = i === 0 ? 0 : 1.2 + Math.sqrt(i) * 1.1;
      list.push({ rig, ox: Math.cos(ang) * r, oz: Math.sin(ang) * r * 1.4 - i * 0.4, phase: seed * 6.28, yaw: a.headingRad, pitch: 0, seed });
    }
    return { key, list, lastX: a.x, lastZ: a.z, lastT: -1, speed: 0 };
  }

  private updateHerd(h: Herd, a: AnimalState, world: World, tMin: number, timeSec: number, sc: number): void {
    const t = TUNING.animals;
    const [cx, cz, heading] = animalPos(a, tMin, t);
    // 速さ（m/s）: 少し前の時刻の位置との差から
    const [px, pz] = animalPos(a, tMin - 1 / 60, t);
    const speed = Math.hypot(cx - px, cz - pz);
    h.speed += (speed - h.speed) * 0.15;
    const leaving = a.leaveMin !== null && tMin >= a.leaveMin;
    // 現れる・消える
    const fadeIn = smooth(a.fromMin, a.fromMin + 0.25, tMin);
    const fadeOut = leaving ? 1 - smooth(a.leaveMin! + t.leaveMoveMin * 0.45, a.leaveMin! + t.leaveMoveMin, tMin) : 1;
    const opacity = Math.min(fadeIn, fadeOut);
    // いちばん近い人（こちらを見る向き）
    let near: { x: number; z: number } | null = null;
    let nd = 150;
    for (const c of world.climbers) {
      if (!c.body.alive || c.offMap) continue;
      const d = Math.hypot(c.x - cx, c.z - cz);
      if (d < nd) {
        nd = d;
        near = c;
      }
    }
    const dt = h.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, timeSec - h.lastT));
    h.lastT = timeSec;
    const moving = h.speed > 0.15;
    const running = h.speed > 1.6;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    for (const o of h.list) {
      const s = o.rig.spec;
      // 群れの中のずれ（向きに合わせて回す。右 = (cos h, sin h)、前 = (sin h, -cos h)）
      // 群れのずれは模型と同じ拡大率で（人形が大きく描かれるので、実寸のずれでは重なる）
      const dx = o.ox * cosH + o.oz * sinH;
      const dz = o.ox * sinH - o.oz * cosH;
      const wx = cx + (dx * sc) / this.unit;
      const wz = cz + (dz * sc) / this.unit;
      const sx = cx * this.unit + dx * sc;
      const sz = cz * this.unit + dz * sc;
      // 向き: 動いていれば進む向き、止まっていて watch なら人の方、ほかは出た向き
      let want = heading;
      if (!moving && near && (a.behavior === 'watch' || nd < 60)) want = Math.atan2(near.x - wx, -(near.z - wz));
      else if (!moving) want = heading + (o.seed - 0.5) * 1.2;
      o.yaw += angDiff(want, o.yaw) * Math.min(1, dt * (moving ? 6 : 1.5));
      // 斜面に合わせて前後に傾ける
      const fx = Math.sin(o.yaw) * s.len * 0.5 * sc;
      const fz = -Math.cos(o.yaw) * s.len * 0.5 * sc;
      const yF = this.heightAt(sx + fx, sz + fz);
      const yB = this.heightAt(sx - fx, sz - fz);
      const wantPitch = Math.atan2(yF - yB, s.len * sc);
      o.pitch += (wantPitch - o.pitch) * Math.min(1, dt * 4);
      const r = o.rig.root;
      r.position.set(sx, (yF + yB) / 2, sz);
      r.scale.setScalar(sc);
      r.rotation.set(0, Math.PI - o.yaw, 0, 'YXZ');
      r.rotateX(-o.pitch);
      r.visible = opacity > 0.01;
      for (const m of o.rig.materials) {
        const fade = opacity < 0.999;
        if (m.transparent !== fade) {
          m.transparent = fade;
          m.needsUpdate = true;
        }
        m.opacity = opacity;
        m.depthWrite = !fade;
      }
      this.pose(o, a, moving, running, h.speed, dt, timeSec, near ? Math.atan2(near.x - wx, -(near.z - wz)) : null);
    }
  }

  /** 骨の角度: 歩く（斜めの脚が組）・走る（前後の脚が組で跳ねる）・草を食む・見る・座る */
  private pose(o: One, a: AnimalState, moving: boolean, running: boolean, speed: number, dt: number, timeSec: number, lookAt: number | null): void {
    const rig = o.rig;
    const s = rig.spec;
    const stride = s.len * (running ? 2.2 : 1.1);
    o.phase += (speed * dt * Math.PI * 2) / Math.max(0.2, stride);
    const ph = o.phase;
    const amp = running ? 0.75 : moving ? 0.42 : 0;
    let bodyPitch = 0;
    let bodyLift = 0;
    for (const l of rig.legs) {
      let p: number;
      if (running) p = ph + (l.front ? 0 : Math.PI) + (l.side > 0 ? 0.25 : 0);
      else p = ph + (l.front === (l.side > 0) ? 0 : Math.PI);
      const sw = Math.sin(p) * amp;
      l.upper.rotation.set(sw, 0, 0);
      // 前へ振るとき（sin が負）に膝を曲げて足を上げる
      const lift = Math.max(0, -Math.cos(p)) * amp * 1.2;
      l.lower.rotation.set(l.front ? lift : -lift, 0, 0);
      l.foot.rotation.set(-sw * 0.5, 0, 0);
    }
    if (running) {
      bodyPitch = Math.sin(ph) * 0.12;
      bodyLift = Math.abs(Math.sin(ph)) * s.shoulderH * (a.species === 'deer' ? 0.18 : 0.06);
    } else if (moving) {
      bodyLift = Math.abs(Math.sin(ph * 2)) * s.shoulderH * 0.015;
    }
    // 首と頭
    let neckX = 0;
    let headY = 0;
    const cycle = 9 + o.seed * 5;
    const tt = (timeSec + o.seed * 37) % cycle;
    if (!moving) {
      const grazer = a.behavior === 'graze' || ((a.species === 'boar' || a.species === 'deer') && a.behavior === 'wander');
      if (grazer) {
        // 草を食む: ほとんど頭を下げ、ときどき顔を上げてあたりを見る
        const up = smooth(cycle - 3, cycle - 2.4, tt) * (1 - smooth(cycle - 0.6, cycle, tt));
        neckX = (1 - up) * (s.neckUp + 0.55);
        headY = up * Math.sin(timeSec * 0.9 + o.seed * 9) * 0.5;
      } else {
        // 見る: 頭を少し上げ、人の方へ首を向ける
        neckX = -0.12;
        if (lookAt !== null) {
          headY = Math.max(-0.9, Math.min(0.9, -angDiff(lookAt, o.yaw)));
        } else headY = Math.sin(timeSec * 0.4 + o.seed * 7) * 0.35;
      }
    } else if (running) neckX = -0.15 + Math.sin(ph) * 0.08;
    else neckX = Math.sin(ph * 2) * 0.05 + (a.species === 'boar' ? 0.2 : 0);
    rig.neck.rotation.set(neckX, headY * 0.6, 0);
    rig.head.rotation.set(-neckX * 0.35, headY * 0.4, 0);
    // 尻尾（垂らして、ときどき振る。走るときは上げる）
    const flick = smooth(0, 0.3, tt) * (1 - smooth(0.3, 0.8, tt));
    rig.tail.rotation.set(-0.55 + flick * 0.7 + (running ? 1.1 : 0), Math.sin(timeSec * 9) * flick * 0.5, 0);
    // サル: 止まっているときは座る（胴を起こし、後ろ脚を前へたたむ）
    const sit = s.primate && !moving ? 1 : 0;
    const breathe = Math.sin(timeSec * 1.6 + o.seed * 5) * 0.012;
    rig.body.position.y = rig.bodyY + bodyLift - sit * rig.bodyY * 0.35;
    rig.body.rotation.set(bodyPitch - sit * 0.95, 0, 0);
    rig.body.scale.set(1, 1 + breathe, 1);
    if (sit) {
      for (const l of rig.legs) {
        if (l.front) {
          l.upper.rotation.set(0.75, 0, l.side * 0.1);
          l.lower.rotation.set(0.2, 0, 0);
        } else {
          l.upper.rotation.set(-0.5, 0, l.side * 0.35);
          l.lower.rotation.set(1.6, 0, 0);
        }
      }
      rig.neck.rotation.x = 0.7 + neckX;
    }
  }

  dispose(): void {
    for (const h of this.herds.values()) {
      for (const o of h.list) {
        this.scene.remove(o.rig.root);
        o.rig.dispose();
      }
    }
    this.herds.clear();
  }
}

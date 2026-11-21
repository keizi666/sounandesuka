/**
 * 野生動物の描画（World.animals を読むだけ）。位置は sim と同じ式（animalPos）で、補間した時刻から求める。
 * 群れは中心のまわりに並べ、1 頭ずつ歩く・走る・草を食む・こちらを見る・座る（サル）の簡単な動きを付ける。
 * 出るときと立ち去るときは、静かに現れて静かに消える（不透明度）。
 * 人に付きまとう熊（stalk）が、大きく描いた人形の列より内側まで来たら、重ならないよう列のまわりを歩いて回る（見た目だけ。sim の位置は変えない）。
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
  /** 人形の列のまわりを回るときの、sim の向きからの角度のずれ（rad）と、最後に描いた時刻（ゲーム内分） */
  orbitA: number;
  orbitT: number | null;
  /** 最後に描いた位置（m） */
  dispX: number | null;
  dispZ: number | null;
  /** 人に向かい始めたときに描いていた位置と、立ち去るときの sim の位置からのずれ（襲った人の人形のそばから立ち去る） */
  chargeFrom: [number, number] | null;
  leaveD: [number, number];
}

/** 描いている人形の位置（m） */
export interface FigurePoint {
  id: string;
  x: number;
  z: number;
}

/** 描く位置と動き方。charge: 人へ走る / hold: 人のそば（襲った直後） / orbit: 列のまわりを歩く / sim: sim の位置のまま */
interface Disp {
  x: number;
  z: number;
  heading: number;
  mode: 'sim' | 'orbit' | 'charge' | 'hold';
  /** hold のとき、着いてからの経過（ゲーム内分） */
  heldMin: number;
  /** hold のとき、襲った人の方の向き */
  faceTo: number | null;
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

function speciesWalk(a: AnimalState): number {
  return (TUNING.animals.species[a.species] ?? TUNING.animals.species['deer']!).walkMs;
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
  update(world: World, tMin: number, timeSec: number, sceneScale: number, figures: readonly FigurePoint[] = []): void {
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
      this.updateHerd(h, a, world, tMin, timeSec, sceneScale, figures);
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
    return { key, list, lastX: a.x, lastZ: a.z, lastT: -1, speed: 0, orbitA: 0, orbitT: null, dispX: null, dispZ: null, chargeFrom: null, leaveD: [0, 0] };
  }

  /**
   * 描く位置。人形と熊は大きく描くので、sim では数十 m 離れていても重なって見える。
   * - 襲うとき（attack）: 描いていた位置から、襲う人の人形のそばまで走り（charge）、着いたら少しそこにいて（hold）、そこから立ち去る。
   *   人が倒れるのは熊が着いたとき（sim と同じ時刻）
   * - 付きまとう熊（stalk）: いちばん近い人形のまわりの列の中心から、列の広がり＋体の大きさより内側に来たら、その輪の上を歩いて回る
   * - ほかは sim の位置のまま
   */
  private displayPos(h: Herd, a: AnimalState, tMin: number, figures: readonly FigurePoint[], sc: number): Disp {
    const d0 = this.displayPosRaw(h, a, tMin, figures, sc);
    h.dispX = d0.x;
    h.dispZ = d0.z;
    return d0;
  }

  private displayPosRaw(h: Herd, a: AnimalState, tMin: number, figures: readonly FigurePoint[], sc: number): Disp {
    const t = TUNING.animals;
    const [x, z, heading] = animalPos(a, tMin, t);
    const sim: Disp = { x, z, heading, mode: 'sim', heldMin: 0, faceTo: null };
    const dtG = h.orbitT === null ? 0 : tMin - h.orbitT;
    h.orbitT = tMin;
    if (dtG < 0 || dtG > 5) {
      // 巻き戻し・大きな飛び
      h.orbitA = 0;
      h.chargeFrom = null;
    }
    // 人形 1 体の大きさ（m）
    const fig = (sc / this.unit) * 1.7;
    // 襲う: 人形のそばまで走り、そばにいて、そこから立ち去る
    if (a.attack && a.chargeMin !== undefined && a.leaveMin !== null && tMin >= a.chargeMin) {
      const victim = figures.find((f) => f.id === a.attack!.climberId);
      if (tMin < a.leaveMin) {
        if (!h.chargeFrom) h.chargeFrom = h.dispX !== null && h.dispZ !== null ? [h.dispX, h.dispZ] : [a.chargeX ?? x, a.chargeZ ?? z];
        const [fx, fz] = h.chargeFrom;
        const vx = victim?.x ?? a.leaveX;
        const vz = victim?.z ?? a.leaveZ;
        const dd = Math.max(1e-6, Math.hypot(fx - vx, fz - vz));
        const stop = victim ? fig * 0.8 : 0;
        const tx = vx + ((fx - vx) / dd) * stop;
        const tz = vz + ((fz - vz) / dd) * stop;
        h.leaveD = [tx - a.leaveX, tz - a.leaveZ];
        const f = Math.min(1, (tMin - a.chargeMin) / t.chargeMin);
        const face = Math.atan2(vx - fx, -(vz - fz));
        return { x: fx + (tx - fx) * f, z: fz + (tz - fz) * f, heading: face, mode: f < 1 ? 'charge' : 'hold', heldMin: Math.max(0, tMin - a.chargeMin - t.chargeMin), faceTo: face };
      }
      // 立ち去る（襲った人のそばから）
      return { x: x + h.leaveD[0], z: z + h.leaveD[1], heading, mode: 'sim', heldMin: 0, faceTo: null };
    }
    h.chargeFrom = null;
    const leaving = a.leaveMin !== null && tMin >= a.leaveMin;
    if (a.behavior !== 'stalk' || leaving || figures.length === 0) {
      h.orbitA = 0;
      return sim;
    }
    let near: FigurePoint | null = null;
    let nd = Infinity;
    for (const f of figures) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < nd) (nd = d), (near = f);
    }
    if (!near) return sim;
    const group = figures.filter((f) => Math.hypot(f.x - near!.x, f.z - near!.z) < fig * 4);
    const cx = group.reduce((s2, f) => s2 + f.x, 0) / group.length;
    const cz = group.reduce((s2, f) => s2 + f.z, 0) / group.length;
    const spread = Math.max(...group.map((f) => Math.hypot(f.x - cx, f.z - cz)));
    const R = spread + fig * 1.5;
    const d = Math.hypot(x - cx, z - cz);
    const base = Math.atan2(z - cz, x - cx);
    const inside = d < R;
    if (inside) h.orbitA += (speciesWalk(a) / R) * dtG * 60;
    else h.orbitA *= Math.exp(-dtG / 0.5);
    if (!inside && Math.abs(h.orbitA) < 1e-3) return sim;
    const ang = base + h.orbitA;
    const r = Math.max(d, R);
    // 輪の接線の向き（角が増える向き: (−sin, cos)）。北 = 0、時計回り
    const hd = inside ? Math.atan2(-Math.sin(ang), -Math.cos(ang)) : heading;
    return { x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r, heading: hd, mode: inside ? 'orbit' : 'sim', heldMin: 0, faceTo: null };
  }

  private updateHerd(h: Herd, a: AnimalState, world: World, tMin: number, timeSec: number, sc: number, figures: readonly FigurePoint[]): void {
    const t = TUNING.animals;
    const disp = this.displayPos(h, a, tMin, figures, sc);
    const cx = disp.x;
    const cz = disp.z;
    const heading = disp.heading;
    // 速さ（m/s）: 少し前の時刻の位置との差から（輪を回っている間は歩く速さ、人へ向かう間は走る速さ、そばにいる間は 0）
    const [px, pz] = animalPos(a, tMin - 1 / 60, t);
    const [sx0, sz0] = animalPos(a, tMin, t);
    const st = TUNING.animals.species[a.species] ?? TUNING.animals.species['deer']!;
    const speed = disp.mode === 'orbit' ? st.walkMs : disp.mode === 'charge' ? st.runMs : disp.mode === 'hold' ? 0 : Math.hypot(sx0 - px, sz0 - pz);
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
      if (disp.faceTo !== null) want = disp.faceTo;
      else if (!moving && near && (a.behavior === 'watch' || nd < 60)) want = Math.atan2(near.x - wx, -(near.z - wz));
      else if (!moving) want = heading + (o.seed - 0.5) * 1.2;
      o.yaw += angDiff(want, o.yaw) * Math.min(1, dt * (moving || disp.faceTo !== null ? 6 : 1.5));
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
      this.pose(o, a, moving, running, h.speed, dt, timeSec, near ? Math.atan2(near.x - wx, -(near.z - wz)) : null, disp.mode === 'hold' ? disp.heldMin : null);
    }
  }

  /** 骨の角度: 歩く（斜めの脚が組）・走る（前後の脚が組で跳ねる）・草を食む・見る・座る */
  /** heldMin: 人を襲ってそばにいる間の経過（ゲーム内分。null でなし）。はじめの少しの間は立ち上がって前脚を振り、そのあとは頭を下げて立つ */
  private pose(o: One, a: AnimalState, moving: boolean, running: boolean, speed: number, dt: number, timeSec: number, lookAt: number | null, heldMin: number | null = null): void {
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
    // 人を襲った直後: 後ろ脚で立ち上がり、前脚を振り下ろす（約 15 秒）。そのあとは四つ足で頭を下げて立つ
    if (heldMin !== null) {
      const rear = smooth(0, 0.03, heldMin) * (1 - smooth(0.2, 0.27, heldMin));
      const swing = Math.sin(timeSec * 7) * rear;
      rig.body.position.y = rig.bodyY + rear * s.shoulderH * 0.45;
      rig.body.rotation.set(-0.75 * rear, 0, 0);
      for (const l of rig.legs) {
        if (l.front) {
          l.upper.rotation.set(-0.9 * rear + swing * 0.6 * l.side, 0, 0);
          l.lower.rotation.set(0.5 * rear, 0, 0);
        } else {
          l.upper.rotation.set(0.75 * rear, 0, 0);
          l.lower.rotation.set(-0.3 * rear, 0, 0);
        }
      }
      rig.neck.rotation.set(0.15 + (1 - rear) * 0.45, 0, 0);
      rig.head.rotation.set(0.1, 0, 0);
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

/**
 * 俯瞰（追従なし）の右ドラッグ: 押した所の地面を中心に、カメラがまわり込む（ユーザーの指定）。
 * カメラと注視点を一緒に、押した点のまわりで回すので、押した点は画面の上で動かない。
 * 左右は鉛直の軸のまわり、上下はカメラの横の軸のまわり（真上・水平に近づきすぎない）。追従中は OrbitControls の回転のまま
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PivotOrbitDeps {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  heightAt: (x: number, z: number) => number;
  /** 右ドラッグをこの方式にするか（俯瞰で追従なし） */
  active: () => boolean;
}

/** 回す速さ（ラジアン / px） */
const SPEED = 0.005;
const UP = new THREE.Vector3(0, 1, 0);

/** 画面の点から地面に当たる所（光線を少しずつ進めて地面の下に入ったところを細かく探す）。当たらなければ null */
function groundAt(d: PivotOrbitDeps, canvas: HTMLCanvasElement, clientX: number, clientY: number): THREE.Vector3 | null {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, d.camera);
  const o = ray.ray.origin;
  const dir = ray.ray.direction;
  const far = Math.max(d.controls.maxDistance * 2, d.camera.position.distanceTo(d.controls.target) * 4);
  const steps = 400;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (far * i) / steps;
    const p = o.clone().addScaledVector(dir, t);
    if (p.y <= d.heightAt(p.x, p.z)) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        const q = o.clone().addScaledVector(dir, mid);
        if (q.y <= d.heightAt(q.x, q.z)) hi = mid;
        else lo = mid;
      }
      return o.clone().addScaledVector(dir, hi);
    }
    prevT = t;
  }
  return null;
}

/** 点 p を、中心 c のまわりに、軸 axis で angle だけ回す */
function rotateAround(p: THREE.Vector3, c: THREE.Vector3, axis: THREE.Vector3, angle: number): void {
  p.sub(c).applyAxisAngle(axis, angle).add(c);
}

export function installPivotOrbit(canvas: HTMLCanvasElement, d: PivotOrbitDeps): void {
  let drag: { id: number; x: number; y: number; pivot: THREE.Vector3 } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || !d.active()) return;
    const pivot = groundAt(d, canvas, e.clientX, e.clientY) ?? d.controls.target.clone();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pivot };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!d.active()) {
      drag = null;
      return;
    }
    const cam = d.camera.position;
    const tgt = d.controls.target;
    const p = drag.pivot;
    // 左右: 鉛直の軸のまわり
    const yaw = -(e.clientX - drag.x) * SPEED;
    rotateAround(cam, p, UP, yaw);
    rotateAround(tgt, p, UP, yaw);
    // 上下: カメラの横の軸のまわり。カメラから見た注視点の俯角が、決めた範囲を出ないようにする
    const pitch = -(e.clientY - drag.y) * SPEED;
    const right = new THREE.Vector3().subVectors(tgt, cam).cross(UP).normalize();
    if (right.lengthSq() > 0) {
      const camTry = cam.clone();
      const tgtTry = tgt.clone();
      rotateAround(camTry, p, right, pitch);
      rotateAround(tgtTry, p, right, pitch);
      const v = camTry.clone().sub(tgtTry);
      const polar = Math.acos(Math.max(-1, Math.min(1, v.y / Math.max(1e-9, v.length()))));
      const above = camTry.y > d.heightAt(camTry.x, camTry.z) + d.controls.minDistance * 0.3;
      if (polar >= d.controls.minPolarAngle && polar <= d.controls.maxPolarAngle && above) {
        cam.copy(camTry);
        tgt.copy(tgtTry);
      }
    }
    d.camera.lookAt(tgt);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const end = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

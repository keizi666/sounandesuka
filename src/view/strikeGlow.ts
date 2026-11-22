/**
 * 落雷の着弾点の光（ユーザーの指定: 真上から見ても、どこに落ちたか分かるように）。
 * どの向きから見ても丸く見える板と、まわりの地面を照らす点光源。はじめに強く、GLOW_SEC 秒で消える。
 * 時計は実際の時刻（描画の時計はゲームの速さで進むので、速く回すと一瞬で消えてしまう）。
 */
import * as THREE from 'three';
import { UNIT } from './scale';

/** 着弾点の光が消えるまで（秒） */
const GLOW_SEC = 2.4;

/** 中心が白く、外へ青白くぼける円 */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(235,242,255,0.9)');
  grd.addColorStop(0.45, 'rgba(170,200,255,0.35)');
  grd.addColorStop(1, 'rgba(140,170,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 広がる輪: 白い線の外側に薄い影を付けて、白っぽい地面や雲の上でも見えるように */
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(15,25,55,0.35)';
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(240,246,255,1)';
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export interface StrikeGlow {
  /** シーン座標の着弾点で光らせる */
  fire(sx: number, sy: number, sz: number): void;
  update(): void;
}

/** mapHalfM: 地図の一辺の半分（m）。光の大きさを地図に合わせる（全体を見渡しても見えるように） */
export function createStrikeGlow(scene: THREE.Scene, mapHalfM: number): StrikeGlow {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const glow = new THREE.Sprite(mat);
  glow.renderOrder = 20;
  glow.visible = false;
  scene.add(glow);
  const ringMat = new THREE.SpriteMaterial({ map: ringTexture(), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const ring = new THREE.Sprite(ringMat);
  ring.renderOrder = 21;
  ring.visible = false;
  scene.add(ring);
  const light = new THREE.PointLight(0xdfe8ff, 0, 1.2, 1.5);
  scene.add(light);
  let from = -1e9;
  // 光に敏感な人のため、動きを減らす設定なら弱く
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  // 大きさ: 地図の一辺の 1/7（全体を見渡しても見える）
  const base = Math.max(0.4, (mapHalfM * 2 * UNIT) / 7);
  const now = (): number => performance.now() / 1000;
  return {
    fire(sx, sy, sz) {
      glow.position.set(sx, sy + 0.004, sz);
      ring.position.copy(glow.position);
      light.position.set(sx, sy + 0.08, sz);
      from = now();
    },
    update() {
      const age = now() - from;
      if (age >= 0 && age < GLOW_SEC) {
        const k = 1 - age / GLOW_SEC;
        const peak = calm ? 0.55 : 1;
        glow.visible = true;
        // はじめの 0.4 秒はほぼ最大のまま、その後ゆっくり消える
        const a = Math.min(1, k * 1.25);
        mat.opacity = peak * a * a;
        const r = base * (0.55 + 0.45 * (1 - k * k));
        glow.scale.set(r, r, 1);
        // 輪は 2 回広がって消える（1 回目は強く、2 回目は弱く）
        const ph = (age / GLOW_SEC) * 2;
        const f = ph % 1;
        const rr = base * (0.35 + 1.1 * f);
        ring.visible = true;
        ring.scale.set(rr, rr, 1);
        ringMat.opacity = peak * (1 - f) * (ph < 1 ? 1 : 0.5);
        light.intensity = peak * 6 * a * a;
      } else if (glow.visible) {
        glow.visible = false;
        ring.visible = false;
        light.intensity = 0;
      }
    },
  };
}

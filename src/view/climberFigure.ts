/**
 * 登山者の人形（docs/19 §6）。造形は figureModel.ts、動きは figureMotion.ts。
 * ここでは状態による見た目の切り替え（雨具・フード・濡れ・ヘッドランプ・ツェルト・目・死亡時の灰色化）を行う。
 * 死亡は横向きに倒れたまま静止し、人形とマーカーが静かに灰色になる（流血・損傷の表現はしない）。
 */
import { attachPortraitFace } from './faceDecal';
import * as THREE from 'three';
import type { ClimberState } from '../sim/types';
import { buildFigure } from './figureModel';
import { createMotion, type GroundSlope } from './figureMotion';
import { injectEnv, type EnvUniforms } from './terrainMaterial';

export interface Figure {
  root: THREE.Group;
  /** 頭のてっぺん（ワールド座標）。顔アイコンを頭のすぐ上に出すのに使う（座る・かがむ・斜面でも頭について行く） */
  headTop(out: THREE.Vector3): THREE.Vector3;
  /** ground: 足もとの地面の傾き（低い姿勢を斜面に沿わせる） */
  update(c: ClimberState, timeSec: number, selected: boolean, ground?: GroundSlope): void;
  dispose(): void;
}

const GREY = new THREE.Color(0x8d8d8d);
/** 首の骨から見た頭のてっぺんの高さ（人形の模型の単位。帽子の上まで） */
const HEAD_TOP_LOCAL = 0.3;

/**
 * heightScene: シーン単位での人形の高さ（拡大率込み）。
 * env を渡すと、霧・夜・トゥーン調の陰影と、背景から浮き立たせる強めの縁の光を入れる。
 */
export function createFigure(c: ClimberState, heightScene: number, env?: EnvUniforms): Figure {
  const rig = buildFigure(c.def);
  const motion = createMotion(rig, c);
  const { root } = rig;
  root.scale.setScalar(heightScene);
  if (env) for (const m of rig.litMaterials) injectEnv(m, env, false, false, { rim: 1.1, noFade: true });
  // 顔にアイコンの顔の絵を貼る（読めたら。夜・霧の色味は体と同じに）
  attachPortraitFace(rig, c.def, env ? (m) => injectEnv(m, env, false, false, { noFade: true }) : undefined);
  const arrow = rig.marker.children[0] as THREE.Mesh;
  const arrowMat = arrow.material as THREE.MeshBasicMaterial;
  const arrowBase = arrowMat.color.clone();
  const ringMat = rig.ring.material as THREE.MeshBasicMaterial;

  // ヘッドランプの光（頭の向きに付いて動く）
  let spot: THREE.SpotLight | null = null;
  if (rig.lamp) {
    spot = new THREE.SpotLight(0xfff1c4, 0, 0, Math.PI / 6, 0.6, 1.5);
    spot.position.set(0, 0.17, 0.12);
    spot.target.position.set(0, -0.45, 3);
    rig.neck.add(spot, spot.target);
  }

  let grey = 0;
  let lastT = Number.NaN;
  let rain = c.body.rainwearOn ? 1 : 0;

  return {
    root,
    headTop(out) {
      // 首の骨から頭（帽子）のてっぺんまで
      return rig.neck.localToWorld(out.set(0, HEAD_TOP_LOCAL, 0));
    },
    update(cs, t, selected, ground) {
      const dt = Number.isNaN(lastT) ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const b = cs.body;
      motion.update(cs, t, ground);

      // 雨具: ジャケットを雨具の色とつやに、フードとザックカバーを付ける
      rain += ((b.rainwearOn ? 1 : 0) - rain) * (1 - Math.exp(-dt * 3));
      rig.hood.visible = b.rainwearOn;
      rig.packCover.visible = b.rainwearOn;
      rig.bivy.visible = b.inBivy && b.alive;

      // 死亡: ゆっくり灰色に
      const dead = !b.alive || cs.state === 'DEAD';
      grey += ((dead ? 1 : 0) - grey) * (1 - Math.exp(-dt * 0.6));
      rig.setLook(rain, grey, b.wetness);
      rig.setEyes(b.alive && b.conscious && cs.state !== 'UNCONSCIOUS');
      arrowMat.color.copy(arrowBase).lerp(GREY, grey);
      ringMat.color.copy(arrowBase).lerp(GREY, grey);

      // ヘッドランプ
      const on = cs.inv.headlamp.on && b.alive;
      if (rig.lamp) (rig.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.5 : 0;
      if (rig.lampBeam) (rig.lampBeam.material as THREE.MeshBasicMaterial).opacity = on ? 0.035 : 0;
      if (spot) {
        // 光は距離の 1.5 乗で弱まる。人形の拡大率によらず、足元の少し先がほんのり照らされる強さにする
        const reach = root.scale.x * 1.6;
        spot.intensity = on ? 0.55 * Math.pow(reach, 1.5) : 0;
        spot.distance = root.scale.x * 7;
      }

      // 選択の目印
      rig.ring.visible = selected;
      ringMat.opacity = 0.55 + 0.3 * Math.sin(t * 4);
      arrow.position.y = 1.32 + Math.sin(t * 2.2) * 0.02;
      arrow.rotation.y = t * 1.2;
    },
    dispose() {
      rig.dispose();
      arrowMat.dispose();
      ringMat.dispose();
    },
  };
}

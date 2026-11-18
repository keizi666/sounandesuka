/**
 * 登山者の人形（docs/10 §5.1 を見た目の改善で置き換え。DECISIONS.md 参照）。
 * 造形は figureModel.ts、動きは figureMotion.ts。ここでは状態による見た目の切り替え（雨具・フード・濡れ・ヘッドランプ・ツェルト・死亡時の灰色化）を行う。
 * 死亡は横向きに倒れたまま静止し、人形とマーカーが静かに灰色になる（流血・損傷の表現はしない）。
 */
import * as THREE from 'three';
import type { ClimberState } from '../sim/types';
import { buildFigure } from './figureModel';
import { createMotion } from './figureMotion';

export interface Figure {
  root: THREE.Group;
  update(c: ClimberState, timeSec: number, selected: boolean): void;
  dispose(): void;
}

const GREY = new THREE.Color(0x8d8d8d);

/** heightScene: シーン単位での人形の高さ（拡大率込み） */
export function createFigure(c: ClimberState, heightScene: number): Figure {
  const rig = buildFigure(c.def);
  const motion = createMotion(rig, c);
  const { root, mats } = rig;
  root.scale.setScalar(heightScene);
  const jacketBase = mats.jacket.color.clone();
  const shellBase = mats.shell.color.clone();
  const jacketIdx = mats.all.indexOf(mats.jacket);
  const baseRough = mats.all.map((m) => m.roughness);
  const arrow = rig.marker.children[0] as THREE.Mesh;
  const arrowMat = arrow.material as THREE.MeshBasicMaterial;
  const arrowBase = arrowMat.color.clone();
  const ringMat = rig.ring.material as THREE.MeshBasicMaterial;

  // ヘッドランプの光（頭の向きに付いて動く）
  let spot: THREE.SpotLight | null = null;
  if (rig.lamp) {
    spot = new THREE.SpotLight(0xfff1c4, 0, 0, Math.PI / 6, 0.6, 1.5);
    spot.position.set(0, 0.1, 0.07);
    spot.target.position.set(0, -0.5, 3);
    rig.neck.add(spot, spot.target);
  }

  let grey = 0;
  let lastT = Number.NaN;
  let rain = c.body.rainwearOn ? 1 : 0;

  return {
    root,
    update(cs, t, selected) {
      const dt = Number.isNaN(lastT) ? 0 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const b = cs.body;
      motion.update(cs, t);

      // 雨具: ジャケットを雨具の色とつやに、フードとザックカバーを付ける
      rain += ((b.rainwearOn ? 1 : 0) - rain) * (1 - Math.exp(-dt * 3));
      rig.hood.visible = b.rainwearOn;
      rig.hat.visible = !b.rainwearOn && cs.def.gear.hat && !cs.def.gear.helmet;
      rig.packCover.visible = b.rainwearOn;
      rig.bivy.visible = b.inBivy && b.alive;

      // 死亡: ゆっくり灰色に
      const dead = !b.alive || cs.state === 'DEAD';
      grey += ((dead ? 1 : 0) - grey) * (1 - Math.exp(-dt * 0.6));
      for (let i = 0; i < mats.all.length; i += 1) {
        const m = mats.all[i]!;
        const base = i === jacketIdx ? jacketBase.clone().lerp(shellBase, rain) : mats.base[i]!;
        m.color.copy(base).lerp(GREY, grey * 0.9);
        // 濡れるとつやが出る
        const wetGloss = b.wetness * (i === jacketIdx ? 0.4 + 0.2 * rain : 0.25);
        m.roughness = Math.max(0.18, baseRough[i]! - (i === jacketIdx ? 0.3 * rain : 0) - wetGloss);
      }
      arrowMat.color.copy(arrowBase).lerp(GREY, grey);
      ringMat.color.copy(arrowBase).lerp(GREY, grey);

      // ヘッドランプ
      const on = cs.inv.headlamp.on && b.alive;
      if (rig.lamp) (rig.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 6 : 0;
      if (rig.lampBeam) (rig.lampBeam.material as THREE.MeshBasicMaterial).opacity = on ? 0.07 : 0;
      if (spot) spot.intensity = on ? 3.0 : 0;

      // 選択の目印
      rig.ring.visible = selected;
      ringMat.opacity = 0.55 + 0.3 * Math.sin(t * 4);
      arrow.position.y = 1.3 + Math.sin(t * 2.2) * 0.02;
      arrow.rotation.y = t * 1.2;
    },
    dispose() {
      rig.dispose();
      arrowMat.dispose();
      ringMat.dispose();
    },
  };
}

/**
 * 亡くなった人の、半透明の姿が静かに空へ昇っていく演出（ユーザーの指定）。
 * 倒れた体はそのまま残し、その上から、立った姿の半透明の人形がゆっくり昇りながら薄れて消える。
 * 実時間で数秒。シミュレーションの速さや一時停止には関係なく進む。
 */
import * as THREE from 'three';
import type { ClimberDef } from '../sim/types';
import { buildFigure } from './figureModel';

/** 昇る時間（秒）と、その間に昇る高さ（人形の背丈の何倍か） */
const DURATION_SEC = 7;
const RISE_HEIGHTS = 3.2;
const START_OPACITY = 0.55;

interface Ghost {
  root: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  t0: number;
  y0: number;
  heightScene: number;
  seed: number;
}

export class Ghosts {
  private list: Ghost[] = [];
  constructor(private scene: THREE.Scene) {}

  /** 亡くなった瞬間に呼ぶ。pos は倒れた人形の位置（シーン座標） */
  spawn(def: ClimberDef, pos: THREE.Vector3, heading: number, heightScene: number, timeSec: number): void {
    const rig = buildFigure(def);
    rig.marker.visible = false;
    rig.ring.visible = false;
    rig.bivy.visible = false;
    if (rig.lampBeam) rig.lampBeam.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color: 0xeef6ff, transparent: true, opacity: START_OPACITY, depthWrite: false, fog: false });
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = mat;
    });
    rig.root.scale.setScalar(heightScene);
    rig.root.position.copy(pos);
    rig.root.rotation.y = Math.PI - heading;
    rig.root.renderOrder = 20;
    this.scene.add(rig.root);
    this.list.push({ root: rig.root, mat, t0: timeSec, y0: pos.y, heightScene, seed: Math.random() * 10 });
  }

  update(timeSec: number): void {
    for (const g of [...this.list]) {
      const t = (timeSec - g.t0) / DURATION_SEC;
      if (t >= 1 || t < 0) {
        this.remove(g);
        continue;
      }
      // ゆっくり昇り、少し揺れ、薄れていく（はじめは現れるように）
      const ease = t * t * (3 - 2 * t);
      g.root.position.y = g.y0 + ease * RISE_HEIGHTS * g.heightScene;
      g.root.rotation.z = Math.sin(timeSec * 1.3 + g.seed) * 0.05;
      const fadeIn = Math.min(1, t / 0.12);
      g.mat.opacity = START_OPACITY * fadeIn * (1 - t);
    }
  }

  private remove(g: Ghost): void {
    this.scene.remove(g.root);
    g.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    g.mat.dispose();
    this.list = this.list.filter((x) => x !== g);
  }

  dispose(): void {
    for (const g of [...this.list]) this.remove(g);
  }
}

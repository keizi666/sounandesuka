/**
 * 登山者の人形のモデル（見た目の改善: 等身の整った登山者。手続き生成、外部アセットなし）。
 * 高さ 1.0 に正規化し、足元が原点・正面が +z。関節は THREE.Group の階層で、figureMotion.ts が角度を与える。
 *   root → body（倒れるときに回す）→ hips → spine（胸）→ neck（頭）/ 肩 → 肘 / hips → 股 → 膝 → 足首
 * 服: ジャケット（登山者の色）・パンツ・登山靴・手袋・帽子（またはフード）・ザック（荷物の重さで大きさが変わる）・ストック・ヘッドランプ。
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ClimberDef } from '../sim/types';

export interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  end: THREE.Group;
}

export interface FigureRig {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** 状態で出し入れする部品 */
  hood: THREE.Object3D;
  hat: THREE.Object3D;
  packCover: THREE.Object3D;
  bivy: THREE.Mesh;
  poleL: THREE.Object3D | null;
  poleR: THREE.Object3D | null;
  lamp: THREE.Mesh | null;
  lampBeam: THREE.Mesh | null;
  marker: THREE.Group;
  ring: THREE.Mesh;
  /** 色を変える素材（雨具・死亡時の灰色化） */
  mats: { jacket: THREE.MeshStandardMaterial; shell: THREE.MeshStandardMaterial; all: THREE.MeshStandardMaterial[]; base: THREE.Color[] };
  dims: typeof DIM;
  dispose(): void;
}

/** 寸法（身長 1.0） */
export const DIM = {
  ankleY: 0.05,
  shin: 0.235,
  thigh: 0.245,
  hipsY: 0.53,
  hipHalf: 0.052,
  spineY: 0.035,
  chestH: 0.255,
  shoulderHalf: 0.116,
  shoulderY: 0.215,
  upperArm: 0.155,
  foreArm: 0.14,
  neckY: 0.262,
  headR: 0.068,
};

function std(color: THREE.ColorRepresentation, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 関節から下へ伸びる部位（カプセル）。原点が関節 */
function segment(len: number, r0: number, r1: number, mat: THREE.Material): THREE.Mesh {
  // 上が太く下が細い円筒＋両端の球で、滑らかな腕・脚にする
  const g = new THREE.CylinderGeometry(r0, r1, len, 12, 1);
  g.translate(0, -len / 2, 0);
  const m = mesh(g, mat);
  m.add(mesh(new THREE.SphereGeometry(r0, 12, 8), mat));
  m.add(mesh(new THREE.SphereGeometry(r1, 12, 8), mat, 0, -len, 0));
  return m;
}

/** 胴（ジャケット）: 回転体を前後につぶす */
function torsoGeometry(w: number): THREE.BufferGeometry {
  const pts = [
    [0.088, -0.075],
    [0.094, -0.06],
    [0.093, 0.0],
    [0.09, 0.05],
    [0.094, 0.1],
    [0.106, 0.16],
    [0.114, 0.2],
    [0.106, 0.232],
    [0.07, 0.252],
    [0.036, 0.262],
  ].map(([r, y]) => new THREE.Vector2(r! * w, y!));
  const g = new THREE.LatheGeometry(pts, 20);
  g.scale(1, 1, 0.68);
  g.computeVertexNormals();
  return g;
}

function hsl(color: THREE.Color, ds: number, dl: number): THREE.Color {
  const h = { h: 0, s: 0, l: 0 };
  color.getHSL(h);
  return new THREE.Color().setHSL(h.h, Math.min(1, Math.max(0, h.s + ds)), Math.min(1, Math.max(0, h.l + dl)));
}

/** ID から決まる 0〜1 の値（人ごとの違い） */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function buildFigure(def: ClimberDef): FigureRig {
  const D = DIM;
  const all: THREE.MeshStandardMaterial[] = [];
  const reg = <T extends THREE.MeshStandardMaterial>(m: T): T => {
    all.push(m);
    return m;
  };
  const color = new THREE.Color(def.color);
  const build = Math.min(1.18, Math.max(0.88, 0.75 + def.weightKg / 260)); // 体格
  const female = def.sex === 'f';
  const jacket = reg(std(color, 0.78));
  const shell = reg(std(hsl(color, -0.05, 0.06), 0.42)); // 雨具（つやのある生地）
  const jacketDark = reg(std(hsl(color, -0.1, -0.16), 0.8));
  const PANTS = [0x23262d, 0x1f2a3a, 0x3a3f2c, 0x4a4334, 0x2b2b2b, 0x30343c];
  const pants = reg(std(PANTS[Math.floor(hash01(def.id, 1) * PANTS.length) % PANTS.length]!, 0.9));
  const boots = reg(std(0x3b2a20, 0.62));
  const sole = reg(std(0x15130f, 0.9));
  const skinTone = new THREE.Color().setHSL(0.07, 0.42, 0.62 + hash01(def.id, 2) * 0.1);
  const skin = reg(std(skinTone, 0.62));
  const glove = reg(std(0x22252a, 0.8));
  const hairC = def.age >= 58 ? new THREE.Color(0xb9b6b0) : new THREE.Color().setHSL(0.08, 0.3, 0.08 + hash01(def.id, 3) * 0.1);
  const hair = reg(std(hairC, 0.9));
  const packC = hsl(new THREE.Color().setHSL((hash01(def.id, 4) * 0.5 + 0.55) % 1, 0.45, 0.3), 0, 0);
  const packM = reg(std(packC, 0.82));
  const packDark = reg(std(hsl(packC, -0.1, -0.12), 0.85));
  const metal = reg(std(0xb8bcc2, 0.35, 0.8));
  const coverM = reg(std(0xe8b020, 0.5));

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = D.hipsY;
  body.add(hips);

  // 腰（パンツの上部）とベルト
  const pelvis = mesh(new THREE.SphereGeometry(0.09 * build, 16, 10), pants, 0, -0.02, 0);
  pelvis.scale.set(1, 0.7, 0.7);
  hips.add(pelvis);

  // 胴
  const spine = new THREE.Group();
  spine.position.y = D.spineY;
  hips.add(spine);
  const torso = mesh(torsoGeometry(build * (female ? 0.94 : 1)), jacket);
  spine.add(torso);
  // ザックのヒップベルト（ジャケットの上）
  const belt = mesh(new THREE.CylinderGeometry(0.0955 * build, 0.0965 * build, 0.024, 20), packDark, 0, 0.012, 0);
  belt.scale.z = 0.7;
  spine.add(belt);
  spine.add(mesh(new THREE.BoxGeometry(0.022, 0.016, 0.006), reg(std(0x18191c, 0.5)), 0, 0.012, 0.068 * build));
  // 前のファスナーと裾
  spine.add(mesh(new THREE.BoxGeometry(0.007, 0.3, 0.004), jacketDark, 0, 0.09, 0.0655 * build));
  const hem = mesh(new THREE.CylinderGeometry(0.096 * build, 0.09 * build, 0.016, 20), jacketDark, 0, -0.07, 0);
  hem.scale.z = 0.69;
  spine.add(hem);
  // 肩から胸の切り替え（2 色のジャケット）と胸ポケットのファスナー
  const yokePts = [[0.108, 0.168], [0.1165, 0.2], [0.1085, 0.233], [0.072, 0.2535], [0.037, 0.2635]].map(([r, y]) => new THREE.Vector2(r! * build * (female ? 0.94 : 1), y!));
  const yoke = mesh(new THREE.LatheGeometry(yokePts, 20), jacketDark);
  yoke.scale.z = 0.69;
  spine.add(yoke);
  const pocket = mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), jacketDark, 0.04 * build, 0.135, 0.062 * build);
  pocket.rotation.z = 0.25;
  spine.add(pocket);
  // 襟
  const collar = mesh(new THREE.TorusGeometry(0.04, 0.015, 8, 16), jacketDark, 0, 0.256, 0.004);
  collar.rotation.x = Math.PI / 2;
  spine.add(collar);

  // 首と頭
  const neck = new THREE.Group();
  neck.position.y = D.neckY;
  spine.add(neck);
  neck.add(mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.04, 10), skin, 0, 0.012, 0));
  const head = mesh(new THREE.SphereGeometry(D.headR, 20, 16), skin, 0, 0.03 + D.headR, 0.004);
  head.scale.set(0.92, 1.08, 1);
  neck.add(head);
  // 顔: 目・鼻・口（近づいたときにだけ見える小さな造形）
  const eyeM = reg(std(0x1a1512, 0.3));
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.0075, 8, 6), eyeM, sx * 0.022, 0.008, 0.056));
    const brow = mesh(new THREE.BoxGeometry(0.02, 0.004, 0.004), hair, sx * 0.022, 0.022, 0.056);
    brow.rotation.z = sx * -0.12;
    head.add(brow);
    head.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), skin, sx * 0.06, 0, 0)); // 耳
  }
  const nose = mesh(new THREE.ConeGeometry(0.009, 0.022, 8), skin, 0, -0.004, 0.062);
  nose.rotation.x = Math.PI / 2 - 0.5;
  head.add(nose);
  head.add(mesh(new THREE.BoxGeometry(0.02, 0.003, 0.003), reg(std(0x7a3b34, 0.6)), 0, -0.026, 0.055));
  // 髪（後頭部）
  const hairMesh = mesh(new THREE.SphereGeometry(D.headR * 1.03, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.006, -0.008);
  head.add(hairMesh);
  if (female) head.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), hair, 0, -0.02, -0.058));
  // 帽子（ニット帽またはつば付き）
  const hat = new THREE.Group();
  const hatC = reg(std(hsl(color, -0.15, -0.05 + hash01(def.id, 5) * 0.2), 0.95));
  if (hash01(def.id, 6) < 0.5) {
    const beanie = mesh(new THREE.SphereGeometry(D.headR * 1.09, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hatC, 0, 0.012, 0);
    hat.add(beanie);
    const fold = mesh(new THREE.TorusGeometry(D.headR * 1.0, 0.012, 8, 20), hatC, 0, 0.014, 0);
    fold.rotation.x = Math.PI / 2;
    hat.add(fold);
    hat.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), hatC, 0, 0.082, 0));
  } else {
    hat.add(mesh(new THREE.SphereGeometry(D.headR * 1.06, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), hatC, 0, 0.014, 0));
    const brim = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.005, 16, 1, false, -Math.PI / 2, Math.PI), hatC, 0, 0.024, 0.03);
    brim.scale.z = 1.3;
    hat.add(brim);
  }
  hat.visible = def.gear.hat;
  head.add(hat);
  // フード（雨具を着たとき）
  const hood = new THREE.Group();
  const hoodShell = mesh(new THREE.SphereGeometry(D.headR * 1.22, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), shell, 0, 0.004, -0.012);
  hoodShell.rotation.x = -0.35;
  hood.add(hoodShell);
  const hoodRim = mesh(new THREE.TorusGeometry(D.headR * 1.02, 0.01, 6, 18, Math.PI * 1.25), shell, 0, 0.0, 0.03);
  hoodRim.rotation.set(0, 0, -Math.PI * 0.125 + Math.PI / 2);
  hood.add(hoodRim);
  hood.visible = false;
  head.add(hood);
  // ヘルメット
  if (def.gear.helmet) {
    const hm = mesh(new THREE.SphereGeometry(D.headR * 1.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), reg(std(0xe7e2d5, 0.35)), 0, 0.012, 0);
    head.add(hm);
    hat.visible = false;
  }
  // ヘッドランプ
  let lamp: THREE.Mesh | null = null;
  let lampBeam: THREE.Mesh | null = null;
  if (def.gear.headlamp.has) {
    const band = mesh(new THREE.TorusGeometry(D.headR * 1.05, 0.006, 6, 20), reg(std(0x222222, 0.9)), 0, 0.03, 0);
    band.rotation.x = Math.PI / 2;
    head.add(band);
    const lm = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2c0, emissiveIntensity: 0, roughness: 0.3 });
    lamp = mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.014, 10), lm, 0, 0.03, D.headR * 1.04);
    lamp.rotation.x = Math.PI / 2;
    head.add(lamp);
    // 光の束（夜だけ見える、加算合成の円錐）
    const beamGeo = new THREE.ConeGeometry(0.32, 1.3, 20, 1, true);
    beamGeo.translate(0, -0.65, 0);
    beamGeo.rotateX(-Math.PI / 2 - 0.32);
    lampBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    lampBeam.position.set(0, 0.03, D.headR * 1.05);
    head.add(lampBeam);
  }

  // 腕
  const arm = (side: 1 | -1): Limb => {
    const upper = new THREE.Group();
    upper.position.set(side * D.shoulderHalf * build, D.shoulderY, 0);
    spine.add(upper);
    upper.add(segment(D.upperArm, 0.043 * build, 0.034 * build, jacketDark));
    const lower = new THREE.Group();
    lower.position.y = -D.upperArm;
    upper.add(lower);
    lower.add(segment(D.foreArm, 0.033 * build, 0.027 * build, jacket));
    const cuff = mesh(new THREE.CylinderGeometry(0.029 * build, 0.029 * build, 0.016, 10), jacketDark, 0, -D.foreArm + 0.012, 0);
    lower.add(cuff);
    const end = new THREE.Group();
    end.position.y = -D.foreArm;
    lower.add(end);
    const hand = mesh(new THREE.SphereGeometry(0.03, 10, 8), def.gear.gloves === 'none' ? skin : glove, 0, -0.024, 0.004);
    hand.scale.set(0.72, 1.2, 1);
    end.add(hand);
    return { upper, lower, end };
  };
  const armL = arm(1);
  const armR = arm(-1);

  // 脚
  const leg = (side: 1 | -1): Limb => {
    const upper = new THREE.Group();
    upper.position.set(side * D.hipHalf * build, -0.015, 0);
    hips.add(upper);
    upper.add(segment(D.thigh, 0.056 * build, 0.041 * build, pants));
    const lower = new THREE.Group();
    lower.position.y = -D.thigh;
    upper.add(lower);
    lower.add(segment(D.shin, 0.04 * build, 0.031 * build, pants));
    // ゲイター
    lower.add(mesh(new THREE.CylinderGeometry(0.035 * build, 0.034 * build, 0.09, 12), jacketDark, 0, -D.shin + 0.06, 0));
    const end = new THREE.Group();
    end.position.y = -D.shin;
    lower.add(end);
    // 登山靴（足首・甲・つま先・靴底）
    end.add(mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.05, 12), boots, 0, 0.0, 0));
    const upperBoot = mesh(new RoundedBoxGeometry(0.064, 0.05, 0.13, 3, 0.02), boots, 0, -0.03, 0.03);
    end.add(upperBoot);
    end.add(mesh(new RoundedBoxGeometry(0.07, 0.018, 0.14, 2, 0.008), sole, 0, -0.056, 0.03));
    return { upper, lower, end };
  };
  const legL = leg(1);
  const legR = leg(-1);

  // ザック（荷物の重さで大きさが変わる）
  const pk = Math.min(1.25, Math.max(0.78, 0.7 + def.packKg / 30));
  const pack = new THREE.Group();
  pack.position.set(0, 0.13, -0.07 * build - 0.045 * pk);
  spine.add(pack);
  pack.add(mesh(new RoundedBoxGeometry(0.15 * pk, 0.24 * pk, 0.1 * pk, 4, 0.035 * pk), packM));
  pack.add(mesh(new RoundedBoxGeometry(0.14 * pk, 0.05 * pk, 0.11 * pk, 3, 0.022 * pk), packDark, 0, 0.13 * pk, 0.004)); // 雨蓋
  pack.add(mesh(new RoundedBoxGeometry(0.1 * pk, 0.1 * pk, 0.03 * pk, 3, 0.012 * pk), packDark, 0, -0.03 * pk, -0.06 * pk)); // 前ポケット
  for (const sx of [-1, 1]) {
    pack.add(mesh(new THREE.CylinderGeometry(0.02 * pk, 0.022 * pk, 0.09 * pk, 10), packDark, sx * 0.082 * pk, -0.06 * pk, 0)); // サイドポケット（ボトル）
    // ショルダーストラップ（胸の前を通る）
    const strap = mesh(new THREE.TorusGeometry(0.085, 0.009, 6, 16, Math.PI * 1.05), packDark, sx * 0.058 * build, 0.03, 0.068 + 0.045 * pk);
    strap.rotation.set(0, Math.PI / 2 + sx * 0.18, Math.PI * 0.42);
    strap.scale.set(1, 1.25, 0.8);
    pack.add(strap);
  }
  if (def.gear.bivy !== 'none' || def.gear.tent) {
    const mat = mesh(new THREE.CylinderGeometry(0.03 * pk, 0.03 * pk, 0.17 * pk, 12), reg(std(def.gear.tent ? 0x3d6b4a : 0x6c7a89, 0.9)), 0, 0.185 * pk, 0);
    mat.rotation.z = Math.PI / 2;
    pack.add(mat);
  }
  // ザックカバー（雨具を着たとき）
  const packCover = mesh(new RoundedBoxGeometry(0.162 * pk, 0.3 * pk, 0.118 * pk, 4, 0.045 * pk), coverM, 0, 0.022 * pk, -0.008);
  packCover.visible = false;
  pack.add(packCover);

  // ストック
  const pole = (limb: Limb): THREE.Object3D => {
    const g = new THREE.Group();
    const len = 0.56;
    g.add(mesh(new THREE.CylinderGeometry(0.0045, 0.0035, len, 6), metal, 0, -len / 2 + 0.05, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.009, 0.008, 0.06, 8), glove, 0, 0.025, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.002, 0.012, 8), glove, 0, -len + 0.085, 0));
    g.position.set(0, -0.02, 0.008);
    limb.end.add(g);
    return g;
  };
  const poleL = def.gear.trekkingPoles ? pole(armL) : null;
  const poleR = def.gear.trekkingPoles ? pole(armR) : null;

  // ツェルト・シート（ビバーク中に体を覆う）
  const bivyMat = new THREE.MeshStandardMaterial({ color: def.gear.bivy === 'none' ? 0xc9ced6 : 0xd97b1f, roughness: def.gear.bivy === 'none' ? 0.25 : 0.7, metalness: def.gear.bivy === 'none' ? 0.6 : 0 });
  // 頭からかぶった布: 回転体に、下ほど深くなるひだを付ける
  const bivyGeo = new THREE.LatheGeometry(
    [[0.001, 0.56], [0.06, 0.552], [0.105, 0.52], [0.14, 0.44], [0.18, 0.3], [0.235, 0.14], [0.29, 0.03], [0.31, 0.0]].map(([r, y]) => new THREE.Vector2(r!, y!)),
    40,
  );
  {
    const pos = bivyGeo.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const low = 1 - y / 0.56;
      const f = 1 + low * (0.09 * Math.sin(a * 7 + 1.3) + 0.05 * Math.sin(a * 13 + y * 20));
      pos.setXYZ(i, x * f, y, z * f * (1 + 0.25 * low));
    }
    bivyGeo.computeVertexNormals();
  }
  const bivy = mesh(bivyGeo, bivyMat, 0, 0, 0.1);
  bivyMat.side = THREE.DoubleSide;
  bivy.visible = false;
  root.add(bivy);

  // 選択の目印（頭上の矢印）と足元の輪
  const marker = new THREE.Group();
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.13, 4), new THREE.MeshBasicMaterial({ color: def.color, depthTest: false, transparent: true, opacity: 0.95 }));
  arrow.rotation.x = Math.PI;
  arrow.position.y = 1.28;
  arrow.renderOrder = 20;
  marker.add(arrow);
  root.add(marker);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 32), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  root.add(ring);

  return {
    root,
    body,
    hips,
    spine,
    neck,
    armL,
    armR,
    legL,
    legR,
    hood,
    hat,
    packCover,
    bivy,
    poleL,
    poleR,
    lamp,
    lampBeam,
    marker,
    ring,
    mats: { jacket, shell, all, base: all.map((m) => m.color.clone()) },
    dims: D,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      for (const m of all) m.dispose();
      bivyMat.dispose();
    },
  };
}

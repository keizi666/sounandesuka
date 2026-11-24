/**
 * 登山者の人形の動き（手続きアニメーション）。
 * 状態から「基本の姿勢」（関節角の組）を決めて滑らかに近づけ、その上に歩行の周期・呼吸・震え・ふらつきを重ねる。
 * 角度の向き: x 回転の正は「下へ伸びる部位を後ろへ」「胴を前へ」。+x 側の腕は z 回転の正で外へ開く。
 */
import * as THREE from 'three';
import type { ClimberState } from '../sim/types';
import type { FigureRig, Limb } from './figureModel';

/** 姿勢のチャンネル */
const CH = [
  'bodyY', 'bodyZ', 'bodyPitch', 'bodyRoll', 'bodyX',
  'hipsPitch', 'spinePitch', 'spineRoll', 'neckPitch', 'neckYaw',
  'shL', 'shLz', 'elL', 'shR', 'shRz', 'elR',
  'hipL', 'hipLz', 'knL', 'anL', 'hipR', 'hipRz', 'knR', 'anR',
] as const;
type Ch = (typeof CH)[number];
type Pose = Record<Ch, number>;
type Part = Partial<Pose>;

const ZERO: Pose = Object.fromEntries(CH.map((k) => [k, 0])) as Pose;

function pose(p: Part): Pose {
  return { ...ZERO, ...p };
}

/** 左右同じ値を入れる */
function sym(arm: { sh?: number; shz?: number; el?: number }, leg: { hip?: number; hipz?: number; kn?: number; an?: number }): Part {
  return {
    shL: arm.sh ?? 0, shR: arm.sh ?? 0, shLz: arm.shz ?? 0, shRz: -(arm.shz ?? 0), elL: arm.el ?? 0, elR: arm.el ?? 0,
    hipL: leg.hip ?? 0, hipR: leg.hip ?? 0, hipLz: leg.hipz ?? 0, hipRz: -(leg.hipz ?? 0), knL: leg.kn ?? 0, knR: leg.kn ?? 0, anL: leg.an ?? 0, anR: leg.an ?? 0,
  };
}

const POSES = {
  stand: pose({ ...sym({ sh: 0.05, shz: 0.1, el: -0.18 }, { hip: -0.03, hipz: 0.03, kn: 0.06, an: -0.03 }), spinePitch: 0.03 }),
  /** ストックを持って立つ・歩く（肘を曲げて手を前に） */
  standPoles: pose({ ...sym({ sh: -0.25, shz: 0.16, el: -0.95 }, { hip: -0.03, hipz: 0.03, kn: 0.06, an: -0.03 }), spinePitch: 0.05 }),
  /** 腰を下ろして休む（膝を立て、腕を膝に置く） */
  sit: pose({ ...sym({ sh: -0.85, shz: 0.12, el: -0.5 }, { hip: -2.2, hipz: 0.12, kn: 1.45, an: 0.75 }), bodyY: -0.432, spinePitch: 0.3, neckPitch: -0.12 }),
  /** 膝を抱えて丸くなる（寒さをしのぐ、救助を待つ） */
  huddle: pose({ ...sym({ sh: -1.25, shz: -0.12, el: -1.3 }, { hip: -2.35, hipz: 0.05, kn: 1.8, an: 0.55 }), bodyY: -0.432, spinePitch: 0.55, neckPitch: 0.35 }),
  /** 落雷を避ける姿勢（両足をそろえてしゃがみ、耳をふさぐ） */
  crouch: pose({ ...sym({ sh: -2.2, shz: 0.35, el: -2.3 }, { hip: -2.0, hipz: 0.02, kn: 2.5, an: -0.5 }), bodyY: -0.34, bodyZ: -0.1, spinePitch: 0.8, neckPitch: 0.45 }),
  /** 動けない（脚を投げ出して座り込み、うなだれる） */
  slump: pose({ shL: -0.25, shLz: 0.3, elL: -0.3, shR: -0.4, shRz: -0.22, elR: -0.7, hipL: -1.5, hipLz: 0.16, knL: 0.12, anL: -0.25, hipR: -1.75, hipRz: -0.2, knR: 0.75, anR: 0.3, bodyY: -0.44, spinePitch: 0.42, spineRoll: 0.1, neckPitch: 0.6, neckYaw: 0.2 }),
  /** 横向きに倒れている（体を少し丸める） */
  lie: pose({ shL: -0.9, shLz: -0.3, elL: -0.8, shR: -0.5, shRz: -0.1, elR: -1.2, hipL: -0.75, knL: 1.15, anL: -0.3, hipR: -0.35, knR: 0.7, anR: -0.3, bodyRoll: Math.PI / 2 - 0.06, bodyY: 0.185, bodyX: 0.48, spinePitch: 0.22, neckPitch: 0.25, neckYaw: -0.15 }),
  /** 電波を探して携帯を見る */
  phone: pose({ ...sym({}, { hip: -0.03, hipz: 0.03, kn: 0.06, an: -0.03 }), shL: 0.05, shLz: 0.1, elL: -0.2, shR: -0.95, shRz: 0.1, elR: -1.7, spinePitch: 0.04, neckPitch: 0.32, neckYaw: -0.12 }),
  /** 這って進む（四つんばい。急病の発作中・足の骨折・力が尽きかけているのに動くとき） */
  crawl: pose({ ...sym({ sh: -1.2, shz: 0.08, el: -0.1 }, { hip: -1.2, hipz: 0.08, kn: 1.5, an: 0.4 }), bodyPitch: 1.2, bodyY: -0.5, spinePitch: 0.05, neckPitch: -0.75 }),
  /** 手を止めて作業（かがんでザックや服を扱う） */
  busy: pose({ ...sym({ sh: -0.7, shz: -0.05, el: -1.2 }, { hip: -0.35, hipz: 0.05, kn: 0.5, an: -0.15 }), bodyY: -0.03, spinePitch: 0.4, neckPitch: 0.3 }),
} satisfies Record<string, Pose>;

const WALKING_STATES = new Set(['WALKING', 'OFFROUTE_UNAWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL']);
/** これより速く動いていれば「動いている」（這う速さは 0.07 km/h ＝ 0.019 m/s ほどなので、歩く判定の 0.02 m/s より小さくする） */
const CRAWL_MIN_MS = 0.002;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** 滑らかな疑似乱数（-1〜1）。周期の異なる波の和 */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) + Math.sin(t * 2.3 + seed * 1.7) * 0.6 + Math.sin(t * 4.1 + seed * 2.9) * 0.3) / 1.9;
}

/** 人形の足もとの地面の傾き（人形の向きで見た、前へ・右〔+x〕への上り勾配。上り正） */
export interface GroundSlope {
  fwd: number;
  side: number;
}

export interface Motion {
  update(c: ClimberState, timeSec: number, ground?: GroundSlope): void;
}

/**
 * 低い姿勢を地面の傾きに沿わせる割合（ユーザーの指摘: 這うと斜面に埋まる）。立つ・歩く人は鉛直のまま。
 * 這う・倒れているは斜面に沿わせ、座る・うずくまるは半分ほど
 */
function groundFollow(target: Pose): number {
  if (target === POSES.crawl || target === POSES.lie) return 1;
  if (target === POSES.sit || target === POSES.huddle || target === POSES.slump) return 0.6;
  return 0;
}
const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
/** 這うとき、手・膝・つま先を地面から浮かせる量（人形の単位。手足の太さほど） */
const CRAWL_PAD = 0.04;

export function createMotion(rig: FigureRig, c0: ClimberState): Motion {
  const cur: Pose = { ...ZERO };
  const seed = [...c0.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) * 0.37;
  const hasPoles = rig.poleL !== null;
  let lastT = Number.NaN;
  let phase = seed;
  let walkW = 0; // 歩行の重み 0..1
  let grade = 0; // 進行方向の勾配（上り正）
  let lastX = c0.x;
  let lastZ = c0.z;
  let lastElev = c0.elevM;
  let crawlPhase = 0;
  let tiltW = 0; // 地面に沿わせる割合（滑らかに変える）
  let lift = 0; // 這うときに体を持ち上げる量（人形の単位）
  let yaw = Number.NaN;
  let first = true;

  function basePose(c: ClimberState, tMinNow: number): Pose {
    const b = c.body;
    if (!b.alive || c.state === 'DEAD' || c.state === 'UNCONSCIOUS' || !b.conscious) return POSES.lie;
    if (c.state === 'INCAPACITATED') return POSES.slump;
    if (c.plan.postureUntilMin !== null && tMinNow < c.plan.postureUntilMin) return POSES.crouch;
    // 幻覚で立ち上がって歩き回っている（climber/hallucination.ts）
    if (b.halluc?.wanderUntilMin != null && c.speedMs < 0.05) return hasPoles ? POSES.standPoles : POSES.stand;
    // 発作中・足の骨折・力が尽きかけているのに動くときは這う（這う速さは 0.02 m/s より遅いので、少しでも動いていれば。ユーザーの指摘:
    // 「這う」を選ぶと、足を動かさずに立ったまま滑っていた）
    const crawler = b.illness?.active === true || b.injury === 'legFracture' || c.M < 0.25;
    if (crawler && c.speedMs > CRAWL_MIN_MS && (WALKING_STATES.has(c.state) || c.pos.mode === 'free')) return POSES.crawl;
    // 歩いて動いているときは、状態（救助待ち・その場で待つ など）によらず歩く姿勢（座ったまま滑らない）
    const walkingNow = c.speedMs > 0.05 && c.pos.mode === 'free';
    if (walkingNow) return b.illness?.active === true || b.injury === 'legFracture' || c.M < 0.25 ? POSES.crawl : hasPoles ? POSES.standPoles : POSES.stand;
    if (c.state === 'BIVOUAC' || c.state === 'WAITING_RESCUE') return POSES.huddle;
    if (c.state === 'STAYING') return b.coreC < 36.2 || c.local.windChillC < 2 ? POSES.huddle : POSES.sit;
    if (c.state === 'RESTING' || c.state === 'SHELTERED' || c.state === 'RESCUED') return POSES.sit;
    if (c.plan.busyWith !== null) return POSES.busy;
    if (c.state === 'SEEKING_SIGNAL' && c.speedMs < 0.02) return POSES.phone;
    return hasPoles ? POSES.standPoles : POSES.stand;
  }

  return {
    update(c, t, ground) {
      const dt = Number.isNaN(lastT) ? 0 : clamp(t - lastT, 0, 0.1);
      lastT = t;
      const b = c.body;
      const alive = b.alive && c.state !== 'DEAD';
      const awake = alive && b.conscious && c.state !== 'UNCONSCIOUS';
      // tMin は World にあるが、ここでは姿勢の期限だけ見ればよいので stateSinceMin 以降の経過は使わない
      const target = basePose(c, c.plan.postureUntilMin !== null ? c.plan.postureUntilMin - 1 : 0);
      const upright = target === POSES.stand || target === POSES.standPoles;
      const moving = upright && (WALKING_STATES.has(c.state) || (c.pos.mode === 'free' && c.speedMs > 0.05)) && c.speedMs > 0.02;

      // 勾配（位置の変化から。上り正）
      const dx = c.x - lastX;
      const dz = c.z - lastZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.5) {
        const g = clamp((c.elevM - lastElev) / dist, -0.7, 0.7);
        grade += (g - grade) * 0.3;
        lastX = c.x;
        lastZ = c.z;
        lastElev = c.elevM;
      }

      // 姿勢を滑らかに近づける（倒れるときは少し速く）
      const k = first ? 1 : 1 - Math.exp(-dt * (target === POSES.lie ? 3.2 : 4.5));
      for (const ch of CH) cur[ch] += (target[ch] - cur[ch]) * k;
      walkW += ((moving ? 1 : 0) - walkW) * (first ? 1 : 1 - Math.exp(-dt * 5));
      first = false;

      const fatigue = clamp(b.fatigue / 100, 0, 1);
      const cold = clamp((36.3 - b.coreC) / 1.8, 0, 1); // 冷え
      const hypo = clamp((35.2 - b.coreC) / 2.2, 0, 1); // ふらつき
      const wind = clamp(c.local.windMs / 25, 0, 1);
      const uprightW = upright ? 1 : 0;

      // 歩行の周期。速さと疲労・勾配で歩調と歩幅が変わる
      const pace = clamp(c.speedMs / 1.1, 0.25, 1.3);
      const cadence = (0.95 + 0.5 * pace) * (1 - 0.25 * fatigue) * (1 - 0.3 * hypo);
      phase += dt * cadence * Math.PI * 2 * (walkW > 0.02 ? 1 : 0);
      const up = clamp(grade, 0, 0.6);
      const down = clamp(-grade, 0, 0.6);
      const stride = (0.36 + 0.2 * pace) * (1 - 0.3 * fatigue - 0.25 * hypo) * (1 - 0.35 * up) * walkW;
      const stagger = hypo * walkW;
      const s = Math.sin(phase);
      const co = Math.cos(phase);

      const p: Pose = { ...cur };
      // 脚: 振り出し・膝の曲げ・足首。上りは膝を高く、下りは膝を深く
      const legCycle = (sn: number, cs: number, hip: Ch, kn: Ch, an: Ch): void => {
        const lift = Math.max(0, cs);
        const hipA = -sn * stride - (0.1 + 0.55 * up) * lift * walkW - 0.25 * up * walkW;
        const knA = (0.12 + lift * lift * (0.75 + 1.0 * up) + Math.max(0, -sn) * 0.12 + 0.35 * down + 0.3 * up) * walkW * (0.6 + 0.4 * pace + 0.4 * up);
        p[hip] += hipA;
        p[kn] += knA;
        p[an] += -(hipA + knA) * 0.75 + Math.max(0, sn) * 0.25 * walkW * (1 - up);
      };
      legCycle(s, co, 'hipL', 'knL', 'anL');
      legCycle(-s, -co, 'hipR', 'knR', 'anR');
      // 体: 上下動・腰のひねり・重心の左右移動
      p.bodyY += (-0.014 * Math.abs(co) - 0.02 * down - 0.015 * up) * walkW - 0.02 * fatigue * uprightW;
      p.bodyRoll += s * 0.035 * walkW + wobble(t * 1.3, seed) * 0.16 * stagger;
      p.bodyX += wobble(t * 0.9, seed + 4) * 0.05 * stagger;
      p.spineRoll += -s * 0.05 * walkW;
      const twist = s * 0.12 * walkW;
      // 前傾: 上り・向かい風・疲労・寒さ・荷物
      const lean = uprightW * (0.42 * up - 0.12 * down + 0.16 * wind + 0.22 * fatigue + 0.12 * cold + 0.06 * walkW);
      p.spinePitch += lean * 0.7;
      p.hipsPitch += lean * 0.3;
      p.neckPitch += uprightW * (0.3 * fatigue + 0.2 * wind + 0.15 * cold - lean * 0.45) + 0.08 * down * walkW;
      // 腕: ストックがあれば突く動き、なければ自然に振る
      if (hasPoles) {
        const sw = stride * 0.9;
        p.shL += s * sw - 0.15 * up * walkW;
        p.shR += -s * sw - 0.15 * up * walkW;
        p.elL += Math.max(0, -s) * 0.35 * walkW;
        p.elR += Math.max(0, s) * 0.35 * walkW;
      } else {
        const sw = stride * 0.85;
        p.shL += s * sw;
        p.shR += -s * sw;
        p.elL += (-0.25 - Math.max(0, -s) * 0.4) * walkW;
        p.elR += (-0.25 - Math.max(0, s) * 0.4) * walkW;
        // 寒いときは腕を体に寄せる
        p.shLz -= 0.08 * cold * uprightW;
        p.shRz += 0.08 * cold * uprightW;
        p.elL -= 0.5 * cold * uprightW * (1 - walkW);
        p.elR -= 0.5 * cold * uprightW * (1 - walkW);
      }

      if (awake) {
        // 呼吸（疲れているほど大きく速い）
        const br = Math.sin(t * (1.6 + 2.4 * fatigue) + seed);
        p.spinePitch += br * (0.008 + 0.02 * fatigue);
        p.shLz += br * 0.01;
        p.shRz -= br * 0.01;
        // 止まっているときの重心移動と見回し
        const idle = (1 - walkW) * uprightW;
        p.bodyRoll += wobble(t * 0.35, seed) * 0.02 * idle;
        const look = c.perception.awareLost || c.state === 'LOST_AWARE' || c.state === 'NAVIGATING_TO_TRAIL' ? 0.75 : 0.22;
        p.neckYaw += wobble(t * 0.42, seed + 9) * look * (upright ? 1 - walkW * 0.6 : 0.5);
        p.neckPitch += wobble(t * 0.3, seed + 5) * 0.06;
        // 震え（軽度の低体温まで。重くなると震えが止まる）
        const shiver = clamp((36.2 - b.coreC) / 1.2, 0, 1) * clamp((b.coreC - 31.5) / 1.5, 0, 1) * (1 - 0.55 * walkW);
        if (shiver > 0) {
          const burst = 0.55 + 0.45 * Math.sin(t * 1.7 + seed);
          const q = Math.sin(t * 52 + seed) * shiver * burst;
          const q2 = Math.sin(t * 61 + seed * 2) * shiver * burst;
          p.spineRoll += q * 0.022;
          p.spinePitch += q2 * 0.014;
          p.shL += q2 * 0.05;
          p.shR += q * 0.05;
          p.neckYaw += q * 0.03;
          p.bodyX += q * 0.0035;
        }
        // 動けない人のかすかな動き
        if (target === POSES.slump) p.neckPitch += wobble(t * 0.25, seed) * 0.1;
      }

      // 這う動き: 手と反対の膝を交互に前へ
      if (target === POSES.crawl && c.speedMs > CRAWL_MIN_MS) {
        crawlPhase += dt * 2.2;
        const cs = Math.sin(crawlPhase);
        p.shL += cs * 0.28;
        p.shR -= cs * 0.28;
        p.hipL -= cs * 0.22;
        p.hipR += cs * 0.22;
        p.bodyRoll += cs * 0.04;
        p.bodyY += Math.abs(cs) * 0.01;
      }
      // 足を斜面に合わせる（2 関節の IK）。腰から見た足首の位置を、進行方向の勾配に沿ってずらし、地面より下に入らないようにする
      if (upright) {
        const D = rig.dims;
        const K = D.hipsY / POSE_HIPS_Y;
        const a = D.thigh;
        const bl = D.shin;
        const hipH = D.hipsY + p.bodyY * K - 0.015 - D.ankleY;
        const g = clamp(grade, -0.6, 0.6);
        const slopeA = Math.atan(g);
        const plant = (hip: Ch, kn: Ch, an: Ch): void => {
          const phi = -p[hip];
          const phi2 = phi - p[kn];
          let z = a * Math.sin(phi) + bl * Math.sin(phi2);
          const y = -(a * Math.cos(phi) + bl * Math.cos(phi2));
          const groundY = -hipH + g * z;
          let ty = Math.max(y + g * z, groundY);
          let d = Math.hypot(z, ty);
          const maxD = (a + bl) * 0.997;
          if (d > maxD) {
            z *= maxD / d;
            ty *= maxD / d;
            d = maxD;
          }
          if (d < Math.abs(a - bl) + 0.01) return;
          const alpha = Math.atan2(z, -ty);
          const beta = Math.acos(clamp((a * a + d * d - bl * bl) / (2 * a * d), -1, 1));
          const gamma = Math.acos(clamp((a * a + bl * bl - d * d) / (2 * a * bl), -1, 1));
          const footPitch = p[hip] + p[kn] + p[an];
          p[hip] = -(alpha + beta);
          p[kn] = Math.PI - gamma;
          // 地面に着いている足は、足裏を斜面に沿わせる
          const contact = 1 - clamp((ty - groundY) / 0.03, 0, 1);
          p[an] = footPitch * (1 - contact) + -slopeA * contact - (p[hip] + p[kn]);
        };
        plant('hipL', 'knL', 'anL');
        plant('hipR', 'knR', 'anR');
      }
      apply(rig, p, twist);
      // 低い姿勢は、体ごと地面の傾きに沿わせる（体の付け根〔足もとの地面の高さ〕を中心に回す）
      tiltW += (groundFollow(target) - tiltW) * (dt > 0 ? 1 - Math.exp(-dt * 4) : 1);
      _n.copy(UP);
      if (ground && tiltW > 0.01) {
        const f = clamp(ground.fwd, -1.5, 1.5) * tiltW;
        const s = clamp(ground.side, -1.5, 1.5) * tiltW;
        _n.set(-s, 1, -f).normalize();
        rig.body.quaternion.premultiply(_q.setFromUnitVectors(UP, _n));
      }
      // 這うときは、手・膝・つま先がちょうど地面（傾けた面）に着く高さへ体を上げ下げする（ユーザーの指摘: 這うと地面に埋まる）
      let liftWant = 0;
      if (target === POSES.crawl) {
        rig.root.updateMatrixWorld(true);
        let minD = Infinity;
        for (const bn of [rig.armL.end, rig.armR.end, rig.legL.lower, rig.legR.lower, rig.legL.end, rig.legR.end]) {
          rig.root.worldToLocal(bn.getWorldPosition(_p));
          minD = Math.min(minD, _p.dot(_n));
        }
        liftWant = (CRAWL_PAD - minD) / _n.y;
      }
      lift += (liftWant - lift) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
      rig.body.position.y += lift;

      // ストックを地面へ向ける（腕の角度を打ち消す）
      const poleAim = (limb: Limb, sh: number, el: number, sn: number, pole: FigureRig['poleL']): void => {
        if (!pole) return;
        const hang = upright ? 0.28 + sn * 0.3 * walkW : 0.9;
        pole.rotation.x = hang - (p.hipsPitch + p.spinePitch + sh + el);
        pole.rotation.z = -limb.upper.rotation.z * 0.8;
        pole.visible = target !== POSES.lie && target !== POSES.phone && target !== POSES.crouch && target !== POSES.busy && target !== POSES.crawl;
      };
      poleAim(rig.armL, p.shL, p.elL, s, rig.poleL);
      poleAim(rig.armR, p.shR, p.elR, -s, rig.poleR);

      // 向きを滑らかに変える（root の回転との差を body に持たせる）
      const want = rig.root.rotation.y;
      if (Number.isNaN(yaw)) yaw = want;
      let d = (want - yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      yaw += d * (1 - Math.exp(-dt * 6));
      rig.body.rotation.y = yaw - want;
    },
  };
}

/** 姿勢の表は腰の高さ 0.53 の体格で作ってある。いまの体格との比 */
const POSE_HIPS_Y = 0.53;

function apply(rig: FigureRig, p: Pose, twist: number): void {
  const K = rig.dims.hipsY / POSE_HIPS_Y;
  rig.body.position.set(p.bodyX, p.bodyY * K, p.bodyZ * K);
  rig.body.rotation.x = p.bodyPitch;
  rig.body.rotation.z = p.bodyRoll;
  rig.hips.rotation.set(p.hipsPitch, twist, 0);
  rig.spine.rotation.set(p.spinePitch, -twist * 1.8, p.spineRoll);
  rig.neck.rotation.set(p.neckPitch, p.neckYaw + twist * 0.8, 0);
  const limb = (l: Limb, a: number, az: number, bnd: number, e: number): void => {
    l.upper.rotation.set(a, 0, az);
    l.lower.rotation.x = bnd;
    l.end.rotation.x = e;
  };
  limb(rig.armL, p.shL, p.shLz, p.elL, 0);
  limb(rig.armR, p.shR, p.shRz, p.elR, 0);
  // 脚は腰の前傾を打ち消して地面に立つ
  limb(rig.legL, p.hipL - p.hipsPitch, p.hipLz, p.knL, p.anL);
  limb(rig.legR, p.hipR - p.hipsPitch, p.hipRz, p.knR, p.anR);
}

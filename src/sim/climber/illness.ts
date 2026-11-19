/**
 * 急病（胸の痛み・動悸など）。原因ごとに経過が違う（ゲームのモデル。医学モデルではない）。
 * - angina（狭心症）: 休むか薬（ニトログリセリンの舌下）で治まる。登りなどの負荷でぶり返す。命に関わることは少ない
 * - mi（心筋梗塞）: 治まらない。発症から数時間ほど心停止の危険が高く、動くとさらに上がる。治療なしで 48 時間のうちに 35〜50% が亡くなる程度
 * - dissection（大動脈解離）: 治まらない。危険が非常に高い
 * - arrhythmia（不整脈）: 休むと治まることが多い。ときどき心停止
 * - benign（逆流性食道炎・肋間神経痛・筋肉痛・パニックなど）: 休むと治まる
 * 本人や仲間には原因が分からない（症状だけ）。結末と振り返りで原因が分かる。乱数は hazard ストリーム。
 */
import { dexp } from '../core/dmath';
import { chance, nextFloat } from '../core/rng';
import type { ClimberState, IllnessKind, StaticContext, World } from '../types';
import { transition } from './state';

export const ILLNESS_KINDS: IllnessKind[] = ['angina', 'mi', 'dissection', 'arrhythmia', 'benign'];

/** 発症させる。kind が 'random' なら weights（なければ既定）で選ぶ */
export function onsetIllness(world: World, ctx: StaticContext, c: ClimberState, kind: IllnessKind | 'random', weights?: Partial<Record<IllnessKind, number>>): void {
  if (!c.body.alive || c.body.illness) return;
  let k: IllnessKind;
  if (kind === 'random') {
    const w = { ...ctx.tuning.illness.defaultWeights, ...(weights ?? {}) };
    const total = ILLNESS_KINDS.reduce((a, x) => a + (w[x] ?? 0), 0);
    let r = nextFloat(world.rng.hazard) * total;
    k = ILLNESS_KINDS[ILLNESS_KINDS.length - 1]!;
    for (const x of ILLNESS_KINDS) {
      r -= w[x] ?? 0;
      if (r <= 0) {
        k = x;
        break;
      }
    }
  } else k = kind;
  c.body.illness = { kind: k, atMin: world.tMin, active: true, restSinceMin: null, meds: false };
  c.body.anxiety = Math.min(100, c.body.anxiety + ctx.tuning.illness.onsetAnxiety);
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { illnessOnset: true } });
}

/** 薬（処方薬・ニトログリセリンなど）を飲む。持っていなければ何もしない */
export function medicate(world: World, ctx: StaticContext, c: ClimberState): void {
  const ill = c.body.illness;
  if (!ill || !c.def.gear.meds) return;
  ill.meds = true;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { medicated: true } });
}

/** 運動能力の倍率（症状が出ている間） */
export function illnessM(c: ClimberState, t = 1): number {
  const ill = c.body.illness;
  if (!ill) return t;
  const k = ill.active ? ILLNESS_M_ACTIVE[ill.kind] : ILLNESS_M_EASED;
  return t * k;
}
const ILLNESS_M_ACTIVE: Record<IllnessKind, number> = { angina: 0.35, mi: 0.12, dissection: 0.05, arrhythmia: 0.4, benign: 0.6, anaphylaxis: 0.2 };
const ILLNESS_M_EASED = 0.85;

/** 1 ティック。症状の治まり・ぶり返しと、心停止の危険 */
export function stepIllness(world: World, ctx: StaticContext, c: ClimberState, dtMin: number, walking: boolean, grade: number): void {
  const ill = c.body.illness;
  if (!ill || !c.body.alive) return;
  const t = ctx.tuning.illness;
  // アナフィラキシー: 刺されてから少しして症状が出る。エピペンの効いている間は危険が下がる。数時間で治まっていく
  if (ill.kind === 'anaphylaxis') {
    if (ill.onsetAtMin !== undefined && world.tMin < ill.onsetAtMin) return;
    if (ill.onsetAtMin !== undefined && !ill.active && ill.atMin < ill.onsetAtMin) {
      ill.active = true;
      ill.atMin = world.tMin;
      c.body.anxiety = Math.min(100, c.body.anxiety + t.onsetAnxiety);
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { anaphylaxisOnset: true } });
    }
    if (ill.active && world.tMin - ill.atMin > t.anaphylaxisResolveH * 60) {
      ill.active = false;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { illnessEased: true } });
    }
  }
  const sinceH = (world.tMin - ill.atMin) / 60;
  const resting = !walking;
  if (resting) ill.restSinceMin ??= world.tMin;
  else ill.restSinceMin = null;
  const restMin = ill.restSinceMin === null ? 0 : world.tMin - ill.restSinceMin;
  // 治まる（休んでいる時間が足りれば。薬があれば早い）
  if (ill.active && (ill.kind === 'angina' || ill.kind === 'benign' || ill.kind === 'arrhythmia')) {
    const need = ill.kind === 'angina' ? (ill.meds ? t.anginaEaseMedsMin : t.anginaEaseMin) : ill.kind === 'benign' ? t.benignEaseMin : t.arrhythmiaEaseMin;
    if (restMin >= need && (ill.kind !== 'arrhythmia' || chance(world.rng.hazard, (t.arrhythmiaEaseP * dtMin) / 10))) {
      ill.active = false;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { illnessEased: true } });
    }
  }
  // ぶり返す（狭心症・不整脈は、登りなどの負荷で）
  if (!ill.active && walking && grade > t.relapseGrade && (ill.kind === 'angina' || ill.kind === 'arrhythmia')) {
    if (chance(world.rng.hazard, (t.relapsePerH * dtMin) / 60)) {
      ill.active = true;
      ill.restSinceMin = null;
      c.body.anxiety = Math.min(100, c.body.anxiety + t.onsetAnxiety / 2);
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { illnessRelapse: true } });
    }
  }
  // 心停止の危険（毎時の率。発症からの時間で減る。動くと上がる。薬で少し下がる）
  const base = t.arrestPerH[ill.kind] ?? 0;
  if (base <= 0) return;
  const decay = dexp(-sinceH / (t.arrestDecayH[ill.kind] ?? 6));
  let perH = base * decay + (t.arrestFloorPerH[ill.kind] ?? 0);
  if (!ill.active) perH *= t.easedArrestF;
  if (walking) perH *= t.walkingArrestF;
  if (ill.meds) perH *= t.medsArrestF;
  if ((ill.epiUntilMin ?? -1) > world.tMin) perH *= t.epiArrestF;
  if (chance(world.rng.hazard, (perH * dtMin) / 60)) {
    c.body.alive = false;
    c.body.conscious = false;
    c.body.deathCause = ill.kind === 'anaphylaxis' ? 'anaphylaxis' : 'illness';
    c.J = 0;
    c.M = 0;
    transition(world, ctx, c, 'DEAD', 'illness');
    ctx.events.push({ tMin: world.tMin, type: 'CARDIAC_ARREST', climberId: c.id, important: true });
    ctx.events.push({ tMin: world.tMin, type: 'DEATH', climberId: c.id, important: true, data: { cause: c.body.deathCause } });
  }
}

/** ハチに襲われる。確率 p で刺され、刺された人は一定の確率でアナフィラキシーを起こす（以前刺されたことがある人は起こしやすい） */
export function sting(world: World, ctx: StaticContext, c: ClimberState, p: number): void {
  if (!c.body.alive || !chance(world.rng.hazard, p)) return;
  const t = ctx.tuning.illness;
  c.body.stings = (c.body.stings ?? 0) + 1;
  c.body.anxiety = Math.min(100, c.body.anxiety + t.stingAnxiety);
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { stung: true } });
  if (c.body.illness) return;
  const pa = c.def.beeSensitized ? t.anaphylaxisSensitizedP : t.anaphylaxisP;
  if (!chance(world.rng.hazard, pa)) return;
  const delay = t.anaphylaxisDelayMin[0] + nextFloat(world.rng.hazard) * (t.anaphylaxisDelayMin[1] - t.anaphylaxisDelayMin[0]);
  c.body.illness = { kind: 'anaphylaxis', atMin: world.tMin, active: false, restSinceMin: null, meds: false, onsetAtMin: world.tMin + delay, epiUntilMin: null };
}

/** エピペンを打つ（処方された人の薬。症状が出ているとき） */
export function epipen(world: World, ctx: StaticContext, c: ClimberState): void {
  const ill = c.body.illness;
  if (!ill || ill.kind !== 'anaphylaxis' || !ill.active || !c.def.gear.epipen) return;
  ill.epiUntilMin = world.tMin + ctx.tuning.illness.epiDurationMin;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { epipen: true } });
}

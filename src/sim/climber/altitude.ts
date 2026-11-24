/**
 * 高い所の体への影響（ユーザーの指定）。
 * - 酸素の薄さ: 標高が上がると、出せる力の上限（最大 MET）が下がる（hypoxiaMetF。movement の usableMet で掛ける）
 * - 高山病（急性高山病〜高地脳浮腫）: 慣れた高さを超えた高さ × 時間で点（body.ams、0〜100）が上がる。
 *   慣れた高さ（body.acclimElevM）は高い所にいるあいだにゆっくり上がる。下る・慣れると点は下がる。
 *   30 で頭痛・吐き気（判断力が少し落ち、食べにくい）、60 で重い高山病、85 で高地脳浮腫（まっすぐ歩けない・ぼんやりする。転びやすく、ほとんど動けない）
 */
import type { ClimberState, StaticContext, World } from '../types';
import { killWith } from '../hazards/ford';
import { piecewise } from './capacity';

export type AmsLevel = 'none' | 'mild' | 'moderate' | 'hace';

/** [上限, 値] の昇順の表で、x 以下の最初の上限の値（なければ最後の値） */
function stepTable(table: readonly [number, number][], x: number): number {
  for (const [hi, v] of table) if (x <= hi) return v;
  return table[table.length - 1]?.[1] ?? 1;
}

/** 酸素の薄さによる、出せる力の上限の係数 */
export function hypoxiaMetF(elevM: number, t: StaticContext['tuning']): number {
  const a = t.altitude;
  return Math.max(a.hypoxiaMinF, 1 - (a.hypoxiaPer1000M * Math.max(0, elevM - a.hypoxiaFromM)) / 1000);
}

export function amsLevelOf(ams: number | undefined, t: StaticContext['tuning']): AmsLevel {
  const a = t.altitude;
  const v = ams ?? 0;
  return v >= a.amsHace ? 'hace' : v >= a.amsModerate ? 'moderate' : v >= a.amsMild ? 'mild' : 'none';
}

/** 高山病の起きやすさ（シナリオで決めていなければ年齢で） */
function susceptibility(c: ClimberState, t: StaticContext['tuning']): number {
  return c.def.amsSusceptibility ?? stepTable(t.altitude.amsAgeF, c.def.age);
}

/** 1 ティックぶん、慣れた高さと高山病の点を進める。段階が上がったらログに出す */
export function stepAltitude(world: World, ctx: StaticContext, c: ClimberState, dtMin: number): void {
  const b = c.body;
  if (!b.alive) return;
  const a = ctx.tuning.altitude;
  const dtH = dtMin / 60;
  const acclim = b.acclimElevM ?? a.acclimStartM;
  // 慣れた高さは、いまの高さに向かってゆっくり上がる（下がるのは、ゲームの時間の中ではほとんどないので扱わない）
  if (c.elevM > acclim) b.acclimElevM = Math.min(c.elevM, acclim + a.acclimMPerH * dtH);
  else if (b.acclimElevM === undefined) b.acclimElevM = acclim;
  const excessM = Math.max(0, c.elevM - Math.max(a.amsFromM, b.acclimElevM ?? acclim));
  const ams0 = b.ams ?? 0;
  if (excessM === 0 && ams0 === 0) return;
  const rise = ((a.amsRisePer1000MH * excessM) / 1000) * susceptibility(c, ctx.tuning) * Math.max(0, 1 - ams0 / a.amsRiseSlowDiv);
  const fall = excessM < a.amsRecoverBelowM ? a.amsFallPerH * (1 - excessM / a.amsRecoverBelowM) : 0;
  const ams = Math.min(100, Math.max(0, ams0 + (rise - fall) * dtH));
  b.ams = ams;
  if (ams > (b.amsMax ?? 0)) b.amsMax = ams;
  // だるさで疲れが抜けない（疲労の下限。休んでも下がらない）
  b.fatigue = Math.max(b.fatigue, piecewise(a.amsFatigue, ams));
  // 高地脳浮腫が続くと意識がなくなり、さらに続くと命にかかわる（ユーザーの指定: 富士山。下ろせば点が下がり、数え直す）
  if (ams >= a.amsHace) {
    b.haceMin = (b.haceMin ?? 0) + dtMin;
    if (b.haceMin >= a.haceDeathH * 60) {
      killWith(world, ctx, c, 'hace');
      return;
    }
    if (b.haceMin >= a.haceUnconsciousH * 60 && b.haceMin - dtMin < a.haceUnconsciousH * 60) {
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { haceComa: true } });
    }
  } else if ((b.haceMin ?? 0) > 0) b.haceMin = Math.max(0, (b.haceMin ?? 0) - dtMin * 2);
  // 段階が上がったときだけ、ログに 1 行（下がったときは出さない）
  const lv0 = amsLevelOf(ams0, ctx.tuning);
  const lv = amsLevelOf(ams, ctx.tuning);
  const order: AmsLevel[] = ['none', 'mild', 'moderate', 'hace'];
  if (order.indexOf(lv) > order.indexOf(lv0)) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: lv !== 'mild', data: { ams: lv } });
}

/** 判断力 J の係数 */
export function amsJ(c: ClimberState, t: StaticContext['tuning']): number {
  return t.altitude.amsJ[amsLevelOf(c.body.ams, t)] ?? 1;
}

/** 運動能力 M の係数 */
export function amsM(c: ClimberState, t: StaticContext['tuning']): number {
  return t.altitude.amsM[amsLevelOf(c.body.ams, t)] ?? 1;
}

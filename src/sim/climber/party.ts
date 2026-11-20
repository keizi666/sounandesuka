/**
 * パーティとグループ（docs/07 §1.4、docs/03 §4 の 9）。
 * tight のグループはリーダーが道を選んで進み、仲間は同じ位置・状態でついていく（最も遅い人の速度）。
 * 誰かが作業中・休憩中なら待ち、誰かが行動不能なら全員が止まる（STAYING）。
 * loose のグループは各自の速度で歩く。tight に戻したとき離れている仲間は、自分で歩いて合流する。
 */
import type { BehaviorState, ClimberState, StaticContext, World } from '../types';
import { per10m } from './navigation';
import { stepFree } from './offtrail';
import { transition } from './state';
import { walkStep, type WalkResult } from './walk';
import { splitParty } from './groups';
import { applyActions } from './actions';
import { reportMissing } from '../rescue/rescue';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);
/** 歩いて移動する状態 */
export const MOVING = new Set<BehaviorState>(['WALKING', 'OFFROUTE_UNAWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE', 'SEEKING_SIGNAL']);
/** path があれば道外を移動する（風下・稜線の下へ移る）状態 */
const SETTLING = new Set<BehaviorState>(['RESTING', 'BIVOUAC', 'WAITING_RESCUE']);

export function groupMembers(world: World, groupId: string | null): ClimberState[] {
  return world.climbers.filter((c) => c.groupId === groupId);
}

/** グループのリーダー。リーダーが死亡・意識不明なら、生きていて J が最も高い人 */
export function groupLeader(world: World, groupId: string | null): ClimberState {
  const g = world.groups.find((x) => x.id === groupId);
  const members = groupMembers(world, groupId);
  const lead = g ? world.climbers.find((c) => c.id === g.leader) : undefined;
  if (lead && lead.body.alive && lead.body.conscious && lead.groupId === groupId) return lead;
  // 意識のある人 → 生きている人 → 全員、の順に選ぶ（亡くなった人をリーダーにしない）
  const conscious = members.filter((c) => c.body.alive && c.body.conscious);
  const living = members.filter((c) => c.body.alive);
  const pool = conscious.length > 0 ? conscious : living.length > 0 ? living : members.length > 0 ? members : world.climbers;
  return pool.reduce((best, c) => (c.J > best.J ? c : best), pool[0]!);
}

/** パーティ全体のリーダー（最初のグループのリーダー） */
export function partyLeader(world: World): ClimberState {
  // 分割で最初のグループが空になったら、人がいる最初のグループ
  for (const g of world.groups) {
    for (const c of world.climbers) if (c.groupId === g.id && c.body.alive) return groupLeader(world, g.id);
  }
  return groupLeader(world, world.groups[0]?.id ?? null);
}

/** 移動の結果（生理・危険の計算に使う） */
export interface MoveOutcome {
  walking: boolean;
  grade: number;
  met: number;
  movedM: number;
  offTrail: boolean;
}

function canMove(c: ClimberState): boolean {
  if (!c.body.alive || c.plan.busyUntilMin !== null) return false;
  if (MOVING.has(c.state)) return true;
  return SETTLING.has(c.state) && c.pos.mode === 'free' && c.nav.path.length > 0;
}

function moveOne(world: World, ctx: StaticContext, leader: ClimberState, dtSec: number, members: readonly ClimberState[]): WalkResult {
  if (leader.pos.mode === 'free') return stepFree(world, ctx, leader, dtSec, members);
  if (MOVING.has(leader.state)) return walkStep(world, ctx, leader, dtSec, members);
  return { movedM: 0, grade: 0, metById: {} };
}

/** 10 m ごとの判定（道迷い）をリーダーについて行う */
function navChecks(world: World, ctx: StaticContext, c: ClimberState, movedM: number): void {
  c.nav.distAccumM += movedM;
  while (c.nav.distAccumM >= 10) {
    c.nav.distAccumM -= 10;
    per10m(world, ctx, c);
  }
}

/** 仲間をリーダーの位置・状態にそろえる */
function follow(world: World, ctx: StaticContext, leader: ClimberState, m: ClimberState): void {
  m.pos = { ...leader.pos };
  m.x = leader.x;
  m.z = leader.z;
  m.elevM = leader.elevM;
  m.headingRad = leader.headingRad;
  m.speedMs = leader.speedMs;
  // 配列はリーダーと共有する（仲間は自分で書き換えない。JSON に保存すると別々の配列になるが値は同じ）
  m.plan.route = leader.plan.route;
  m.plan.routeIndex = leader.plan.routeIndex;
  m.plan.goalNodes = leader.plan.goalNodes;
  m.plan.goTo = leader.plan.goTo;
  if (m.nav !== leader.nav) m.nav = leader.nav;
  m.perception.awareLost = leader.perception.awareLost;
  m.perception.knowsPosition = leader.perception.knowsPosition;
  m.memo.atWaterfall = leader.memo.atWaterfall;
  const after = leader.state;
  if (after !== m.state && !TERMINAL.has(m.state)) {
    transition(world, ctx, m, after, 'followLeader');
    if (after === 'FINISHED') ctx.events.push({ tMin: world.tMin, type: 'FINISHED', climberId: m.id, important: true, data: leader.pos.mode === 'node' ? { node: leader.pos.nodeId, ...(ctx.map.nodes[leader.pos.nodeId]?.shelter ? { hut: true } : {}) } : {} });
  }
  if (leader.body.shelterNodeId && !m.body.shelterNodeId) {
    m.body.shelterNodeId = leader.body.shelterNodeId;
    m.plan.bivouacUntil = leader.plan.bivouacUntil;
  }
  if (after === 'RESTING' || after === 'BIVOUAC' || after === 'WAITING_RESCUE') {
    m.plan.restUntilMin = leader.plan.restUntilMin;
    m.plan.bivouacUntil = leader.plan.bivouacUntil;
    m.body.leeShelter = leader.body.leeShelter;
    m.body.inBivy = after !== 'RESTING' && m.def.gear.bivy !== 'none';
    m.body.groundInsulation = after !== 'RESTING';
  }
}

/** 列について歩けない人（足の骨折・力尽きかけ）。気を失った・動けない人は、全員で止まる（下の処理） */
function cannotKeepUp(m: ClimberState): boolean {
  return m.body.alive && m.body.conscious && m.state !== 'INCAPACITATED' && (m.body.injury === 'legFracture' || m.M < 0.1);
}

/**
 * 歩けない人と付き添い 1 人を残し、残りは先へ進む。残った二人はその場で風を避けて救助を待つ。
 * 先へ進んだ人が小屋か登山口に着いたら、残った人のことを知らせる（reportLeftBehind）
 */
function leaveBehind(world: World, ctx: StaticContext, leader: ClimberState, members: readonly ClimberState[]): boolean {
  const downs = members.filter((m) => m !== leader && cannotKeepUp(m));
  if (downs.length === 0) return false;
  const able = members.filter((m) => m !== leader && !downs.includes(m) && m.body.conscious && m.M >= 0.5);
  if (able.length === 0) return false;
  // 付き添いは、経験のある人（引率の大人など）を先に、同じなら元気な人。リーダーは動ける人を率いて小屋へ行き、救助を頼む（ユーザーの指定）
  const companion = able.reduce((a, b) => (b.def.experience > a.def.experience + 1e-9 || (Math.abs(b.def.experience - a.def.experience) <= 1e-9 && b.M > a.M) ? b : a));
  const gid = `left_${downs[0]!.id}`;
  splitParty(world, ctx, [{ id: gid, members: [companion.id, ...downs.map((d) => d.id)], leader: companion.id, cohesion: 'tight', actions: [{ type: 'bivouac', until: 'rescue', findLee: true }] }], members, (acts, group, l) => applyActions(world, ctx, acts, group, l));
  world.latches[`leftBehind:${leader.groupId}`] = true;
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: downs[0]!.id, important: true, data: { leftBehind: true, companion: companion.def.name, n: downs.length } });
  return true;
}

/** 歩けない人を残して先へ進んだ列が、小屋（通るだけでも）か登山口に着いたら、残った人のことを知らせる（救助が動く） */
function reportLeftBehind(world: World, ctx: StaticContext): void {
  for (const g of world.groups) {
    if (!world.latches[`leftBehind:${g.id}`]) continue;
    const l = groupLeader(world, g.id);
    // 登山口に着いた・小屋に入った・小屋のある地点を通った（小屋の人に知らせる）
    const atHut = l.pos.mode === 'node' && ctx.map.nodes[l.pos.nodeId]?.shelter !== undefined;
    if (!(l.state === 'FINISHED' || l.body.shelterNodeId || atHut)) continue;
    world.latches[`leftBehind:${g.id}`] = false;
    if (world.rescue.calledAtMin === null) {
      reportMissing(world, l.def.name);
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: l.id, important: true, data: { reportedLeftBehind: true } });
    }
  }
}

/**
 * 移動（8d）。返り値は登山者 ID ごとの移動の結果（動かなかった人は含めない）。
 * hold が true なら誰も動かない（判断時間制限モードで分岐点の回答待ち）。
 */
export function moveParty(world: World, ctx: StaticContext, dtSec: number, hold: boolean): Record<string, MoveOutcome> {
  const out: Record<string, MoveOutcome> = {};
  if (hold) return out;
  reportLeftBehind(world, ctx);
  const done = new Set<string>();
  for (const c of world.climbers) {
    if (done.has(c.id)) continue;
    const g = world.groups.find((x) => x.id === c.groupId);
    if (!g || g.cohesion === 'loose') {
      done.add(c.id);
      if (!canMove(c)) continue;
      const wasFree = c.pos.mode === 'free';
      const r = moveOne(world, ctx, c, dtSec, [c]);
      if (r.movedM > 0) out[c.id] = { walking: true, grade: r.grade, met: r.metById[c.id] ?? 0, movedM: r.movedM, offTrail: wasFree };
      navChecks(world, ctx, c, r.movedM);
      continue;
    }
    const members = groupMembers(world, g.id).filter((m) => !TERMINAL.has(m.state) && m.body.alive);
    for (const m of groupMembers(world, g.id)) done.add(m.id);
    if (members.length === 0) continue;
    const leader = groupLeader(world, g.id);
    if (!canMove(leader)) continue;
    // 大人数の列で、リーダー以外の人が歩けなくなった（足の骨折・力尽きかけ）ら、その人と付き添いを残して先へ進む
    // （列は一番遅い人に合わせて歩くので、そのままでは全員がほとんど進まずに止まってしまう。ユーザーの指摘）
    if (MOVING.has(leader.state) && members.length >= ctx.tuning.behavior.leaveBehindMinSize && leaveBehind(world, ctx, leader, members)) continue;
    // 動けない人がいれば全員止まる
    if (members.some((m) => m.state === 'INCAPACITATED' || m.state === 'UNCONSCIOUS')) {
      for (const m of members) if (MOVING.has(m.state)) transition(world, ctx, m, 'STAYING', 'groupStopped');
      continue;
    }
    // 作業中・休憩中の人がいれば待つ
    if (members.some((m) => m !== leader && (m.plan.busyUntilMin !== null || (m.state === 'RESTING' && leader.state !== 'RESTING')))) continue;
    // 離れている仲間（loose から tight に戻した直後など）は自分で歩いて合流し、その間リーダーは待つ
    // （一度も loose になっていないグループは、転倒で少し離れてもこれまでどおりリーダーにそろえる）
    const far2 = ctx.tuning.behavior.regroupDistM * ctx.tuning.behavior.regroupDistM;
    let together = members;
    let waiting = false;
    const scattered = world.latches[`scattered:${g.id}`] === true;
    for (const m of scattered ? members : []) {
      if (m === leader || (m.x - leader.x) * (m.x - leader.x) + (m.z - leader.z) * (m.z - leader.z) <= far2) continue;
      if (together === members) together = members.filter((x) => x === leader || (x.x - leader.x) * (x.x - leader.x) + (x.z - leader.z) * (x.z - leader.z) <= far2);
      if (!canMove(m)) continue;
      waiting = true;
      const mf = m.pos.mode === 'free';
      const rm = moveOne(world, ctx, m, dtSec, [m]);
      if (rm.movedM > 0) out[m.id] = { walking: true, grade: rm.grade, met: rm.metById[m.id] ?? 0, movedM: rm.movedM, offTrail: mf };
    }
    if (waiting) continue;
    const wasFree = leader.pos.mode === 'free';
    const r = moveOne(world, ctx, leader, dtSec, together);
    navChecks(world, ctx, leader, r.movedM);
    for (const m of together) {
      if (r.movedM > 0) out[m.id] = { walking: true, grade: r.grade, met: r.metById[m.id] ?? 0, movedM: r.movedM, offTrail: wasFree };
      if (m !== leader) follow(world, ctx, leader, m);
    }
  }
  return out;
}

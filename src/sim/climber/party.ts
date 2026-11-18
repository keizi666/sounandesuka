/**
 * パーティとグループ（docs/07 §1.4、docs/03 §4 の 9）。
 * tight のグループはリーダーが道を選んで進み、仲間は同じ位置・状態でついていく（最も遅い人の速度）。
 * 誰かが作業中・休憩中なら待ち、誰かが行動不能なら全員が止まる（STAYING）。
 * loose・グループ分割・リーダー交代の作り込みは P19。
 */
import type { BehaviorState, ClimberState, StaticContext, World } from '../types';
import { per10m } from './navigation';
import { stepFree } from './offtrail';
import { transition } from './state';
import { walkStep, type WalkResult } from './walk';

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
  const alive = members.filter((c) => c.body.alive && c.body.conscious);
  const pool = alive.length > 0 ? alive : members.length > 0 ? members : world.climbers;
  return pool.reduce((best, c) => (c.J > best.J ? c : best), pool[0]!);
}

/** パーティ全体のリーダー（最初のグループのリーダー） */
export function partyLeader(world: World): ClimberState {
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
    if (after === 'FINISHED') ctx.events.push({ tMin: world.tMin, type: 'FINISHED', climberId: m.id, important: true });
  }
  if (leader.body.shelterNodeId && !m.body.shelterNodeId) {
    m.body.shelterNodeId = leader.body.shelterNodeId;
    m.plan.bivouacUntil = leader.plan.bivouacUntil;
    m.memo.sheltered = true;
  }
  if (after === 'RESTING' || after === 'BIVOUAC' || after === 'WAITING_RESCUE') {
    m.plan.restUntilMin = leader.plan.restUntilMin;
    m.plan.bivouacUntil = leader.plan.bivouacUntil;
    m.body.leeShelter = leader.body.leeShelter;
    m.body.inBivy = after !== 'RESTING' && m.def.gear.bivy !== 'none';
    m.body.groundInsulation = after !== 'RESTING';
  }
}

/**
 * 移動（8d）。返り値は登山者 ID ごとの移動の結果（動かなかった人は含めない）。
 * hold が true なら誰も動かない（判断時間制限モードで分岐点の回答待ち）。
 */
export function moveParty(world: World, ctx: StaticContext, dtSec: number, hold: boolean): Record<string, MoveOutcome> {
  const out: Record<string, MoveOutcome> = {};
  if (hold) return out;
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
    // 動けない人がいれば全員止まる
    if (members.some((m) => m.state === 'INCAPACITATED' || m.state === 'UNCONSCIOUS')) {
      for (const m of members) if (MOVING.has(m.state)) transition(world, ctx, m, 'STAYING', 'groupStopped');
      continue;
    }
    // 作業中・休憩中の人がいれば待つ
    if (members.some((m) => m !== leader && (m.plan.busyUntilMin !== null || (m.state === 'RESTING' && leader.state !== 'RESTING')))) continue;
    const wasFree = leader.pos.mode === 'free';
    const r = moveOne(world, ctx, leader, dtSec, members);
    navChecks(world, ctx, leader, r.movedM);
    for (const m of members) {
      if (r.movedM > 0) out[m.id] = { walking: true, grade: r.grade, met: r.metById[m.id] ?? 0, movedM: r.movedM, offTrail: wasFree };
      if (m !== leader) follow(world, ctx, leader, m);
    }
  }
  return out;
}

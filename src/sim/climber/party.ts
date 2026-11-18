/**
 * パーティとグループ（docs/07 §1.4、docs/03 §4 の 9）。
 * tight のグループは全員がそろって歩けるときだけ、最も遅い人に合わせて一緒に進む。
 * 誰かが作業中・休憩中なら待ち、誰かが行動不能なら全員が止まる（STAYING）。
 * loose・グループ分割・リーダー交代の作り込みは P19。
 */
import type { BehaviorState, ClimberState, StaticContext, World } from '../types';
import { transition } from './state';
import { walkStep } from './walk';

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

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

/** 移動の結果（生理の計算に使う） */
export interface MoveOutcome {
  walking: boolean;
  grade: number;
  met: number;
}

/**
 * 歩いている人を進める（8d）。返り値は登山者 ID ごとの移動の結果（歩いていない人は含めない）。
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
      if (c.state === 'WALKING' && c.plan.busyUntilMin === null && c.body.alive) {
        const r = walkStep(world, ctx, c, dtSec, [c]);
        out[c.id] = { walking: r.movedM > 0, grade: r.grade, met: r.metById[c.id]! };
      }
      continue;
    }
    const members = groupMembers(world, g.id).filter((m) => !TERMINAL.has(m.state));
    for (const m of members) done.add(m.id);
    const leader = groupLeader(world, g.id);
    if (leader.state !== 'WALKING' || TERMINAL.has(leader.state)) continue;
    // 動けない人がいれば全員止まる
    if (members.some((m) => m.state === 'INCAPACITATED' || m.state === 'UNCONSCIOUS')) {
      for (const m of members) if (m.state === 'WALKING') transition(world, ctx, m, 'STAYING', 'groupStopped');
      continue;
    }
    // 全員が歩ける状態でなければ待つ
    if (members.some((m) => m.state !== 'WALKING' || m.plan.busyUntilMin !== null)) continue;
    const r = walkStep(world, ctx, leader, dtSec, members);
    // walkStep の中で状態が変わりうる（到着・ルート終端）
    const after = leader.state as BehaviorState;
    for (const m of members) {
      out[m.id] = { walking: r.movedM > 0, grade: r.grade, met: r.metById[m.id]! };
      if (m === leader) continue;
      m.pos = { ...leader.pos };
      m.x = leader.x;
      m.z = leader.z;
      m.elevM = leader.elevM;
      m.headingRad = leader.headingRad;
      m.speedMs = leader.speedMs;
      m.metAct = r.metById[m.id]!;
      m.plan.route = [...leader.plan.route];
      m.plan.routeIndex = leader.plan.routeIndex;
      m.plan.goalNodes = [...leader.plan.goalNodes];
      m.plan.goTo = leader.plan.goTo ? { ...leader.plan.goTo } : null;
      if (after !== m.state) {
        transition(world, ctx, m, after, 'followLeader');
        if (after === 'FINISHED') ctx.events.push({ tMin: world.tMin, type: 'FINISHED', climberId: m.id, important: true });
      }
      if (leader.body.shelterNodeId && !m.body.shelterNodeId) {
        m.body.shelterNodeId = leader.body.shelterNodeId;
        m.plan.bivouacUntil = leader.plan.bivouacUntil;
        m.memo.sheltered = true;
      }
      if (after === 'RESTING') {
        m.plan.restUntilMin = leader.plan.restUntilMin;
        m.plan.bivouacUntil = leader.plan.bivouacUntil;
      }
    }
  }
  return out;
}

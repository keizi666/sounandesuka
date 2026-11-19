/**
 * グループ（docs/07 §1.4、docs/09 §3.1）: 初期のグループ分け、分割（splitParty）、離脱（detach）、まとまり方（setCohesion）、
 * 仲間のところへ戻る（goToMember）、loose のグループの人数確認（STRAGGLER）、リーダー交代の通知（LEADER_CHANGED）。
 */
import { chance } from '../core/rng';
import type { Action, ClimberState, GroupDef, ScenarioDef, StaticContext, World } from '../types';
import { groupLeader, groupMembers } from './party';
import { goToNode, whereOnGraph } from './route';
import { transition } from './state';
import { findPath } from '../terrain/pathing';
import { nearestIndex, vertexX, vertexZ } from '../terrain/sample';

type Apply = (actions: readonly Action[], group: readonly ClimberState[], leader: ClimberState) => void;

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

export function isIncapacitated(c: ClimberState): boolean {
  return c.body.alive && (c.M <= 0 || !c.body.conscious);
}

function isWeak(c: ClimberState, ctx: StaticContext): boolean {
  const t = ctx.tuning.behavior;
  return c.body.alive && !isIncapacitated(c) && (c.body.coreC < t.weakCoreBelowC || c.M < t.weakMBelow);
}

/** シナリオの groups から、登山者 ID → グループ ID の割り当てと World.groups を作る（上から順に割り当てる） */
export function initialGroups(scenario: ScenarioDef, defaultId: string): { groups: World['groups']; of: Record<string, string> } {
  const defs = scenario.groups;
  const leader = scenario.party.find((p) => p.leader) ?? scenario.party[0]!;
  if (!defs || defs.length === 0) {
    return { groups: [{ id: defaultId, leader: leader.id, cohesion: 'tight', lastHeadcountMin: null }], of: Object.fromEntries(scenario.party.map((p) => [p.id, defaultId])) };
  }
  const of: Record<string, string> = {};
  const groups: World['groups'] = [];
  for (const g of defs) {
    const ids = Array.isArray(g.members) ? g.members : scenario.party.map((p) => p.id);
    for (const id of ids) if (of[id] === undefined && scenario.party.some((p) => p.id === id)) of[id] = g.id;
    groups.push({ id: g.id, leader: g.leader, cohesion: g.cohesion ?? 'tight', lastHeadcountMin: null });
  }
  // どのグループにも入っていない人は最初のグループへ
  for (const p of scenario.party) if (of[p.id] === undefined) of[p.id] = groups[0]!.id;
  return { groups, of };
}

/** リーダーと共有している配列（計画ルート・ナビの記録）を自分用に写す（別行動を始める前に必ず呼ぶ） */
export function unshare(c: ClimberState): void {
  c.plan = { ...c.plan, route: [...c.plan.route], goalNodes: [...c.plan.goalNodes], goTo: c.plan.goTo ? { ...c.plan.goTo } : null };
  c.nav = JSON.parse(JSON.stringify(c.nav)) as ClimberState['nav'];
}

function pick(spec: GroupDef['members'], pool: readonly ClimberState[], taken: ReadonlySet<string>, reserved: ReadonlySet<string>, ctx: StaticContext): ClimberState[] {
  const free = pool.filter((c) => !taken.has(c.id));
  if (Array.isArray(spec)) return free.filter((c) => spec.includes(c.id));
  if (spec === 'incapacitated') return free.filter((c) => isIncapacitated(c));
  if (spec === 'weak') return free.filter((c) => isWeak(c, ctx) && !reserved.has(c.id));
  return free.filter((c) => c.body.alive && !reserved.has(c.id)); // all / rest
}

/**
 * パーティを分ける。上から順に割り当て、同じ人は 2 つのグループに入らない。incapacitated / weak が 0 人のグループは作らない。
 * 名指しのリーダー（動ける人）は、条件に合わなくてもそのグループに入る（付き添い）。
 */
export function splitParty(world: World, ctx: StaticContext, defs: readonly (GroupDef & { actions: Action[] })[], pool: readonly ClimberState[], apply: Apply): void {
  const taken = new Set<string>();
  // 動ける名指しのリーダーは、ほかのグループの weak / rest に取られないよう先に押さえる
  const reserved = new Set<string>();
  for (const g of defs) {
    const l = pool.find((c) => c.id === g.leader);
    if (l && l.body.alive && !isIncapacitated(l)) reserved.add(l.id);
  }
  const created: { def: GroupDef & { actions: Action[] }; members: ClimberState[] }[] = [];
  for (const g of defs) {
    let members = pick(g.members, pool, taken, reserved, ctx);
    if ((g.members === 'incapacitated' || g.members === 'weak') && members.length === 0) {
      // このグループは作らない。付き添うはずだったリーダーは、後のグループ（rest など）に入れる
      reserved.delete(g.leader);
      continue;
    }
    const l = pool.find((c) => c.id === g.leader);
    if (l && reserved.has(l.id) && !taken.has(l.id) && !members.includes(l)) members = [l, ...members];
    if (members.length === 0) continue;
    for (const m of members) taken.add(m.id);
    const leaderId = l && members.includes(l) ? l.id : members.reduce((a, b) => (b.J > a.J ? b : a)).id;
    const exist = world.groups.find((x) => x.id === g.id);
    if (exist) Object.assign(exist, { leader: leaderId, cohesion: g.cohesion ?? 'tight', lastHeadcountMin: null });
    else world.groups.push({ id: g.id, leader: leaderId, cohesion: g.cohesion ?? 'tight', lastHeadcountMin: null });
    if (g.cohesion === 'loose') world.latches[`scattered:${g.id}`] = true;
    for (const m of members) {
      m.groupId = g.id;
      unshare(m);
    }
    created.push({ def: g, members });
  }
  ctx.events.push({ tMin: world.tMin, type: 'PARTY_SPLIT', important: true, data: { groups: created.map((x) => `${x.def.id}:${x.members.length}`).join(',') } });
  for (const x of created) apply(x.def.actions, x.members, groupLeader(world, x.def.id));
}

/** 対象をパーティから外し、個別に行動させる */
export function detach(world: World, ctx: StaticContext, c: ClimberState, then: readonly Action[], apply: Apply, returnAfter = false): void {
  const id = `solo_${c.id}`;
  if (returnAfter && c.groupId !== null && c.groupId !== id) world.latches[`return:${c.id}:${c.groupId}`] = true;
  if (!world.groups.some((g) => g.id === id)) world.groups.push({ id, leader: c.id, cohesion: 'tight', lastHeadcountMin: null });
  c.groupId = id;
  unshare(c);
  apply(then, [c], c);
}

/**
 * グループの 1 人だけが用事（電波を探しに行くなど）で離れる。returnAfter なら、用事が済んだら元のグループへ戻る（groupsMinute）。
 */
export function soloErrand(world: World, c: ClimberState, returnAfter: boolean): void {
  const from = c.groupId;
  const id = `solo_${c.id}`;
  if (from === id) return;
  if (!world.groups.some((g) => g.id === id)) world.groups.push({ id, leader: c.id, cohesion: 'tight', lastHeadcountMin: null });
  c.groupId = id;
  unshare(c);
  if (returnAfter && from !== null) world.latches[`return:${c.id}:${from}`] = true;
}

/** 用事が済んだ人を元のグループへ戻す */
function handleReturns(world: World, ctx: StaticContext): void {
  for (const key of Object.keys(world.latches)) {
    if (!key.startsWith('return:') || !world.latches[key]) continue;
    const [, cid, gid] = key.split(':');
    const c = world.climbers.find((x) => x.id === cid);
    const mate = world.climbers.find((x) => x.groupId === gid && x.body.alive && x.id !== cid);
    if (!c || !c.body.alive || !mate || TERMINAL.has(c.state)) {
      world.latches[key] = false;
      continue;
    }
    const d2 = (mate.x - c.x) * (mate.x - c.x) + (mate.z - c.z) * (mate.z - c.z);
    const near = ctx.tuning.behavior.regroupDistM;
    if (world.latches[`returning:${cid}`]) {
      if (d2 > near * near && c.nav.path.length > 0) continue;
      // 合流: 元のグループに戻り、仲間と同じように救助を待つ
      world.latches[key] = false;
      world.latches[`returning:${cid}`] = false;
      c.groupId = gid ?? null;
      c.nav.path = [];
      c.body.leeShelter = mate.body.leeShelter;
      c.body.groundInsulation = true;
      c.plan.bivouacUntil = mate.plan.bivouacUntil ?? 'rescue';
      if (c.state !== 'WAITING_RESCUE') transition(world, ctx, c, 'WAITING_RESCUE', 'rejoin');
      continue;
    }
    // 通報（成否を問わず）が済んで止まったら戻り始める。電波を探す途中でほかの動き（来た道を戻る・道に出て歩く など）に
    // 変わったときも、用事は終わりにして仲間のところへ戻る（「すぐ戻る」と言って離れた人が、そのまま下山してしまわない）。
    // 足を骨折した・力が尽きかけているなど、歩いて戻れないときはその場で待つ
    if (c.state === 'SEEKING_SIGNAL') continue;
    if (c.body.injury === 'legFracture' || c.M < 0.25 || c.state === 'INCAPACITATED' || c.state === 'UNCONSCIOUS') continue;
    if (c.state === 'RESTING' || c.state === 'BIVOUAC' || c.state === 'SHELTERED') continue;
    beginReturn(world, ctx, c, mate);
  }
}

/** 仲間のところへ歩いて戻り始める（地形に沿った道筋。戻る間の見た目は歩く姿勢） */
function beginReturn(world: World, ctx: StaticContext, c: ClimberState, mate: ClimberState): void {
  world.latches[`returning:${c.id}`] = true;
  if (c.pos.mode !== 'free') c.pos = { mode: 'free', x: c.x, z: c.z };
  const n = ctx.map.n;
  const goal = nearestIndex(ctx.map, mate.x, mate.z);
  const path = findPath(ctx.map, c.x, c.z, (i) => i === goal, { tuning: ctx.tuning, heuristicTo: [vertexX(ctx.map, goal % n), vertexZ(ctx.map, Math.floor(goal / n))] });
  c.nav.path = path && path.length > 0 ? [...path, [mate.x, mate.z]] : [[mate.x, mate.z]];
  if (c.state !== 'WAITING_RESCUE') transition(world, ctx, c, 'WAITING_RESCUE', 'returning');
}

/** 用事（電波を探して通報）を終えた人が、すぐ戻り始める（電話したら、座らずに歩いて戻る） */
export function returnAfterErrand(world: World, ctx: StaticContext, c: ClimberState): void {
  const key = Object.keys(world.latches).find((k) => k.startsWith(`return:${c.id}:`) && world.latches[k]);
  if (!key || world.latches[`returning:${c.id}`]) return;
  const gid = key.split(':')[2];
  const mate = world.climbers.find((x) => x.groupId === gid && x.body.alive && x.id !== c.id);
  if (!mate || c.body.injury === 'legFracture' || c.M < 0.25) return;
  beginReturn(world, ctx, c, mate);
}

export function setCohesion(world: World, c: ClimberState, cohesion: 'tight' | 'loose'): void {
  const g = world.groups.find((x) => x.id === c.groupId);
  if (!g || g.cohesion === cohesion) return;
  g.cohesion = cohesion;
  g.lastHeadcountMin = null;
  // 別々に歩くので、共有している配列を分ける
  if (cohesion === 'loose') {
    world.latches[`scattered:${g.id}`] = true;
    for (const m of groupMembers(world, g.id)) unshare(m);
  }
}

/** グループの中でいちばん離れている（遅れている）人 */
export function farthestMember(world: World, c: ClimberState): ClimberState | null {
  let best: ClimberState | null = null;
  let bd = 0;
  for (const m of groupMembers(world, c.groupId)) {
    if (m === c || !m.body.alive || TERMINAL.has(m.state)) continue;
    const d = Math.sqrt((m.x - c.x) * (m.x - c.x) + (m.z - c.z) * (m.z - c.z));
    if (d > bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** 仲間のところへ戻る（仲間のいる地点、または道の途中なら手前の地点へ） */
export function goToMember(world: World, ctx: StaticContext, c: ClimberState, memberId: string): boolean {
  const m = memberId === '$straggler' ? farthestMember(world, c) : (world.climbers.find((x) => x.id === memberId) ?? null);
  if (!m || m === c) return false;
  const w = whereOnGraph(ctx, m);
  const node = w.at ?? w.ahead ?? w.behind;
  if (node === undefined) return false;
  if (!goToNode(ctx, c, node, 'stay')) return false;
  transition(world, ctx, c, 'WALKING', 'goToMember');
  return true;
}

/**
 * 1 ゲーム分ごと: loose のグループの人数確認（30 分ごと、p = 0.5 × J）と、リーダー交代の通知。
 * 遅れに気づいたら STRAGGLER を出し、汎用分岐点 straggler の発火待ちにする。
 */
export function groupsMinute(world: World, ctx: StaticContext): void {
  const t = ctx.tuning.behavior;
  handleReturns(world, ctx);
  for (const g of world.groups) {
    const members = groupMembers(world, g.id).filter((m) => m.body.alive && !TERMINAL.has(m.state));
    if (members.length === 0) continue;
    const leader = groupLeader(world, g.id);
    if (leader.id !== g.leader && leader.body.alive && leader.body.conscious) {
      const key = `leader:${g.id}:${leader.id}`;
      if (!world.latches[key]) {
        world.latches[key] = true;
        ctx.events.push({ tMin: world.tMin, type: 'LEADER_CHANGED', climberId: leader.id, important: true, data: { group: g.id } });
      }
    }
    if (g.cohesion !== 'loose' || members.length < 2) continue;
    if (g.lastHeadcountMin === null) {
      g.lastHeadcountMin = world.tMin;
      continue;
    }
    if (world.tMin - g.lastHeadcountMin < t.headcountEveryMin) continue;
    g.lastHeadcountMin = world.tMin;
    if (!leader.body.conscious || !chance(world.rng.behavior, t.headcountPBase * leader.J)) continue;
    const late = members.filter((m) => m !== leader && (isIncapacitated(m) || Math.sqrt((m.x - leader.x) * (m.x - leader.x) + (m.z - leader.z) * (m.z - leader.z)) > t.stragglerDistM));
    if (late.length === 0) continue;
    ctx.events.push({ tMin: world.tMin, type: 'STRAGGLER', climberId: leader.id, important: true, data: { group: g.id, count: late.length } });
    world.latches[`stragglerPending:${g.id}`] = true;
  }
}

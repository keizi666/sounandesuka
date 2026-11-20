/**
 * 歩けない仲間を運ぶ・救助を呼びに行く（ユーザーの指定。s11 で「両側から支えて進む」を選んだのに、けが人を置いて 7 人で進んだ）。
 * - carryInjured: 介助の 2 人がけが人を両側から支え、背負って運ぶ。けが人と介助の 2 人の荷物は、ほかの人が分けて持つ。
 *   列は運ぶ速さで進み、けが人は列について動く（自分の足では歩かない）。大人数の列でも、けが人を置いていかない
 * - sendForHelp: けが人に 1 人が付き添って残り、ほかの人は電波の入る所か、山小屋・登山口まで行って知らせる。
 *   3 人以下のパーティは 1 人が呼びに行き、2 人以下なら付き添いは残らない（けが人を 1 人で置いていく）
 * 知らせた場所は、けが人を残した場所（呼びに行った人は場所を知っている）
 */
import { nearestIndex } from '../terrain/sample';
import { dispatchReport } from '../rescue/dispatch';
import type { Action, ClimberState, StaticContext, World } from '../types';
import { splitParty } from './groups';

type Apply = (acts: readonly Action[], group: readonly ClimberState[], leader: ClimberState) => void;

const TERMINAL = new Set(['FINISHED', 'RESCUED', 'DEAD']);

/** 自分の足では歩けない人（運ぶ・残す対象） */
export function needsCarry(m: ClimberState): boolean {
  const b = m.body;
  if (!b.alive || TERMINAL.has(m.state)) return false;
  return m.state === 'INCAPACITATED' || m.state === 'UNCONSCIOUS' || !b.conscious || b.injury === 'legFracture' || b.injury === 'severeTrauma' || b.injury === 'headInjury' || m.M < 0.1;
}

/** 運べる人（意識があり、自分で歩ける） */
function ableToHelp(m: ClimberState): boolean {
  return m.body.alive && m.body.conscious && !TERMINAL.has(m.state) && !needsCarry(m);
}

export function isCarrying(world: World, groupId: string | null): boolean {
  return groupId !== null && world.latches[`carry:${groupId}`] === true;
}

/** 運ばれている人（運んでいる列の中の、歩けない人）。運ぶ人が足りなければ空（列は止まる） */
export function carriedIn(world: World, groupId: string | null, members: readonly ClimberState[]): ClimberState[] {
  if (!isCarrying(world, groupId)) return [];
  const carried = members.filter(needsCarry);
  const able = members.filter(ableToHelp).length;
  return able >= carried.length ? carried : [];
}

function groupOf(world: World, leader: ClimberState): ClimberState[] {
  return world.climbers.filter((c) => c.groupId === leader.groupId && c.body.alive && !TERMINAL.has(c.state));
}

/** 運ぶ力の目安（元気で体力のある人を介助に） */
const strength = (c: ClimberState): number => c.M * (0.5 + c.def.fitness);

/**
 * 両側から支えて（背負って）運ぶ。介助は 1 人に 2 人（足りなければ 1 人）。
 * 介助の人はけが人の体重を交代で背負い（1 人あたり体重の半分）、自分の荷物は手放す。けが人と介助の人の荷物は、残りの人で分けて持つ
 */
export function startCarry(world: World, ctx: StaticContext, leader: ClimberState, apply: Apply): void {
  const members = groupOf(world, leader);
  const carried = members.filter(needsCarry);
  const able = members.filter(ableToHelp).sort((a, b) => strength(b) - strength(a));
  if (carried.length === 0 || able.length < carried.length) {
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: leader.id, important: true, data: { carryFail: true } });
    return;
  }
  const per = Math.min(2, Math.floor(able.length / carried.length));
  const carriers = able.slice(0, per * carried.length);
  const others = able.slice(carriers.length);
  for (const c of members) c.plan.carryKg = 0;
  let packPool = 0;
  carried.forEach((p, i) => {
    packPool += p.def.packKg;
    for (const c of carriers.slice(i * per, (i + 1) * per)) {
      c.plan.carryKg = p.def.weightKg / per - c.def.packKg;
      packPool += c.def.packKg;
    }
  });
  // 残りの人がいなければ、介助の人が荷物も分けて持つ
  const bearers = others.length > 0 ? others : carriers;
  for (const c of bearers) c.plan.carryKg = (c.plan.carryKg ?? 0) + packPool / bearers.length;
  const g = world.groups.find((x) => x.id === leader.groupId);
  world.latches[`carry:${leader.groupId}`] = true;
  // けが人がリーダーなら、歩ける人のうち判断のよい人が列を率いる
  const newLeader = needsCarry(leader) ? able.reduce((a, b) => (b.J > a.J ? b : a)) : leader;
  if (g) g.leader = newLeader.id;
  for (const c of members) c.plan.paceFactor = ctx.tuning.behavior.carryPaceF;
  ctx.events.push({
    tMin: world.tMin,
    type: 'SCRIPT_LOG',
    climberId: carried[0]!.id,
    important: true,
    data: { carryStart: true, carriers: carriers.map((c) => c.def.name).join('・'), others: others.length },
  });
  // 歩ける人は運びながら道を進む（運ばれる人は列について動く: party.ts）
  apply([{ type: 'continueRoute' }], able, newLeader);
}

/** 運ぶのをやめた（列が分かれた・全員が着いた）ら、荷物を元に戻す */
export function endCarry(world: World, groupId: string): void {
  world.latches[`carry:${groupId}`] = false;
  for (const c of world.climbers) if (c.groupId === groupId) c.plan.carryKg = 0;
}

/**
 * けが人を残して、救助を呼びに行く。付き添いは 3 人以上のパーティで 1 人（経験のある人）。
 * 残る人はその場で風を避けて待ち、呼びに行く人は計画の道を進んで、電波が入るか山小屋・登山口に着いたら知らせる（stepHelpRunners）
 */
export function sendForHelp(world: World, ctx: StaticContext, leader: ClimberState, apply: Apply): void {
  const members = groupOf(world, leader);
  const downs = members.filter(needsCarry);
  const able = members.filter(ableToHelp);
  if (downs.length === 0 || able.length === 0) return;
  const companion = members.length >= 3 && able.length >= 2 ? able.reduce((a, b) => (b.def.experience > a.def.experience + 1e-9 || (Math.abs(b.def.experience - a.def.experience) <= 1e-9 && b.M > a.M) ? b : a)) : null;
  const goers = able.filter((c) => c !== companion);
  if (goers.length === 0) return;
  const runLead = goers.includes(leader) ? leader : goers.reduce((a, b) => (b.J > a.J ? b : a));
  const stayId = `wait_${downs[0]!.id}`;
  const goId = `help_${runLead.id}`;
  if (leader.groupId) endCarry(world, leader.groupId);
  for (const c of members) c.plan.paceFactor = 1;
  splitParty(
    world,
    ctx,
    [
      { id: stayId, members: [...(companion ? [companion.id] : []), ...downs.map((d) => d.id)], leader: companion?.id ?? downs[0]!.id, cohesion: 'tight', actions: [] },
      { id: goId, members: goers.map((c) => c.id), leader: runLead.id, cohesion: 'tight', actions: [{ type: 'continueRoute' }, { type: 'setPace', factor: ctx.tuning.behavior.helpRunPaceF }] },
    ],
    members,
    apply,
  );
  // 残る人のうち、意識のある人だけが風を避けて落ち着く（動けない人の状態は変えない）
  const stayers = world.climbers.filter((c) => c.groupId === stayId && c.body.alive && c.body.conscious && c.state !== 'INCAPACITATED' && c.state !== 'UNCONSCIOUS');
  const stayLead = stayers[0];
  if (stayLead) apply([{ type: 'bivouac', until: 'rescue', findLee: true }], stayers, stayLead);
  // 呼びに行く人は、けが人を残した場所を覚えておく
  world.flags[`help:${goId}:x`] = downs[0]!.x;
  world.flags[`help:${goId}:z`] = downs[0]!.z;
  ctx.events.push({
    tMin: world.tMin,
    type: 'SCRIPT_LOG',
    climberId: downs[0]!.id,
    important: true,
    data: { sentForHelp: true, companion: companion?.def.name ?? '', goers: goers.map((c) => c.def.name).join('・'), alone: companion === null },
  });
}

/** 救助を呼びに行った人が、電波の入る所・山小屋・登山口に着いたら、けが人を残した場所を知らせる */
export function stepHelpRunners(world: World, ctx: StaticContext): void {
  for (const g of world.groups) {
    const x = world.flags[`help:${g.id}:x`];
    const z = world.flags[`help:${g.id}:z`];
    if (x === undefined || z === undefined) continue;
    const l = world.climbers.find((c) => c.id === g.leader && c.groupId === g.id && c.body.alive && c.body.conscious);
    if (!l) continue;
    const ph = l.inv.phone;
    const radio = ctx.map.radio[nearestIndex(ctx.map, l.x, l.z)] ?? 0;
    const byPhone = ph.has && !ph.dead && ph.batteryPct > 0 && radio >= ctx.tuning.radio.callableMin;
    const atHut = l.pos.mode === 'node' && ctx.map.nodes[l.pos.nodeId]?.shelter !== undefined;
    if (!byPhone && !atHut && !l.body.shelterNodeId && l.state !== 'FINISHED') continue;
    delete world.flags[`help:${g.id}:x`];
    delete world.flags[`help:${g.id}:z`];
    dispatchReport(world, ctx, l, { x, z, radiusM: ctx.tuning.behavior.helpReportRadiusM, by: l.id }, byPhone ? 'phone' : 'relay');
    ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: l.id, important: true, data: { helpReported: byPhone ? 'phone' : 'relay' } });
  }
}

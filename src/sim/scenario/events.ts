/**
 * スクリプトイベント（docs/09 §8）と、リーダーの局地気象・暗さの変化から出るイベント（RAIN_START など）。
 */
import { applyActions, soak } from '../climber/actions';
import { heatExhaustionAtC } from '../climber/capacity';
import { chance, nextFloat } from '../core/rng';
import { injure } from '../hazards/slip';
import { dismissAnimals, spawnAnimal } from '../hazards/animals';
import { groupMembers, partyLeader } from '../climber/party';
import { nearestIndex } from '../terrain/sample';
import type { ClimberState, ScriptEffect, StaticContext, Who, World } from '../types';
import { evalCondition } from './conditions';
import { eventOnce } from './load';
import { fireChoiceById, scopeFor } from './choices';
import { expandText } from './text';
import { resolveVar } from './vars';

function radioAtLeader(world: World, ctx: StaticContext): number {
  const l = partyLeader(world);
  return ctx.map.radio[nearestIndex(ctx.map, l.x, l.z)] ?? 0;
}

/** 電波が必要な効果（予報の更新）が届かない間は、イベントごと保留する */
function blockedBySignal(world: World, ctx: StaticContext, effects: readonly ScriptEffect[]): boolean {
  return effects.some((e) => e.type === 'forecastUpdate' && (e.requiresSignal ?? true)) && radioAtLeader(world, ctx) < ctx.tuning.radio.messageOnlyMin;
}

/** 効果の対象（leader / all / 登山者 ID）。ID はグループに関係なく指せる */
function whoOf(world: World, who: Who, party: readonly ClimberState[], leader: ClimberState): ClimberState[] {
  if (who === 'leader') return [leader];
  if (who === 'all') return party.filter((c) => c.body.alive);
  const c = world.climbers.find((x) => x.id === who);
  return c && c.body.alive ? [c] : [];
}

function applyEffect(world: World, ctx: StaticContext, ef: ScriptEffect, evId: string): void {
  const leader = partyLeader(world);
  const party = groupMembers(world, leader.groupId);
  switch (ef.type) {
    case 'log': {
      // 文の {leader.name} などを、そのときの値で展開する
      const scope = scopeFor(world, ctx, leader);
      const text = expandText(ef.text, (path) => resolveVar(path, scope));
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', text, important: ef.important ?? false, data: { event: evId } });
      return;
    }
    case 'forecastUpdate':
      for (const c of world.climbers) c.perception.forecast = ef.entries.map((x) => ({ ...x }));
      ctx.events.push({ tMin: world.tMin, type: 'FORECAST_UPDATE', important: true, data: { event: evId } });
      return;
    case 'setFlag':
      if (world.flags[ef.flag] === undefined) world.flags[ef.flag] = world.tMin;
      return;
    case 'clearFlag':
      delete world.flags[ef.flag];
      return;
    case 'actions':
      applyActions(world, ctx, ef.actions, party, leader);
      return;
    case 'weatherOverride':
      world.weather.overrides.push({ ...ef.keyframe });
      return;
    case 'pin':
      ctx.events.push({ tMin: world.tMin, type: 'PIN', text: ef.label, data: { x: ef.x, z: ef.z } });
      return;
    case 'triggerChoice':
      fireChoiceById(world, ctx, ef.cp);
      return;
    case 'say':
      applyActions(world, ctx, [{ type: 'say', who: ef.who === 'any' || ef.who.startsWith('role:') ? 'leader' : ef.who, text: ef.text, to: ef.to, tone: ef.tone, documented: ef.documented, source: ef.source }], party, leader);
      return;
    case 'soak':
      for (const c of whoOf(world, ef.who, party, leader)) soak(world, ctx, c, ef.level, ef.snowmelt ?? false);
      return;
    case 'injure':
      for (const c of whoOf(world, ef.who, party, leader)) injure(world, ctx, c, ef.injury, 'trauma');
      return;
    case 'fillWater':
      for (const c of whoOf(world, ef.who, party, leader)) {
        c.plan.fillToL = ef.toL;
        c.inv.waterL = Math.max(c.inv.waterL, Math.min(c.def.gear.waterL, ef.toL));
      }
      return;
    case 'heatIllness':
      // 熱疲労（めまい・足のつり・吐き気・脱力）: 深部体温を熱疲労の体温より上げる。日陰で休めば下がる
      for (const c of whoOf(world, ef.who, party, leader)) c.body.coreC = Math.max(c.body.coreC, heatExhaustionAtC(c, ctx.tuning) + ctx.tuning.capacity.heatIllnessOverC);
      return;
    case 'fall': {
      // 滑落: who が any なら、列の中の誰か 1 人（hazard ストリームで選ぶ）
      const alive = party.filter((c) => c.body.alive);
      const pick = ef.who === 'any' ? (alive.length > 0 ? [alive[Math.min(alive.length - 1, Math.floor(nextFloat(world.rng.hazard) * alive.length))]!] : []) : whoOf(world, ef.who, party, leader);
      const kinds = ['none', 'bruise', 'sprain', 'legFracture', 'headInjury', 'severeTrauma', 'death'] as const;
      const total = kinds.reduce((s, k) => s + (ef.outcomes[k] ?? 0), 0);
      for (const c of pick) {
        let r = nextFloat(world.rng.hazard) * total;
        let k = 0;
        while (k < kinds.length - 1 && r >= (ef.outcomes[kinds[k]!] ?? 0)) r -= ef.outcomes[kinds[k++]!] ?? 0;
        ctx.events.push({ tMin: world.tMin, type: 'FALL', climberId: c.id, important: true, data: { injury: kinds[k]!, event: evId } });
        injure(world, ctx, c, kinds[k]!, 'trauma');
      }
      return;
    }
    case 'rockfall':
      // 落石: 確率 p で当たり、結果は転倒の表（T2 / EXPOSED）から引く
      for (const c of whoOf(world, ef.who, party, leader)) {
        if (!chance(world.rng.hazard, ef.p)) continue;
        const table = ctx.tuning.slip.outcomes[ef.injuryTable]!;
        let r = nextFloat(world.rng.hazard);
        let k = 0;
        while (k < table.length - 1 && r >= table[k]!) r -= table[k++]!;
        const outcome = ['none', 'bruise', 'sprain', 'legFracture', 'headInjury', 'severeTrauma', 'death'] as const;
        ctx.events.push({ tMin: world.tMin, type: 'FALL', climberId: c.id, important: true, data: { rockfall: true, injury: outcome[k]!, event: evId } });
        injure(world, ctx, c, outcome[k]!, 'trauma');
      }
      return;
    case 'animal':
      spawnAnimal(world, ctx, ef, evId);
      return;
    case 'animalLeave':
      dismissAnimals(world, ctx, ef.id, ef.species);
      return;
  }
}

/** スクリプトイベントを評価する（docs/03 §4 の 6） */
export function runEvents(world: World, ctx: StaticContext): void {
  const leader = partyLeader(world);
  const scope = scopeFor(world, ctx, leader);
  ctx.scenario.events.forEach((ev, i) => {
    const key = `events[${i}]`;
    const once = eventOnce(ev);
    if (once && world.firedEvents.includes(ev.id)) return;
    const v = evalCondition(ev.trigger, scope, `${key}.trigger`);
    if (!once) {
      const prev = world.latches[key] ?? false;
      world.latches[key] = v;
      if (!v || prev) return;
    } else if (!v) return;
    if (blockedBySignal(world, ctx, ev.effects)) return;
    if (!world.firedEvents.includes(ev.id)) world.firedEvents.push(ev.id);
    for (const ef of ev.effects) applyEffect(world, ctx, ef, ev.id);
  });
}

/** リーダーの局地気象（前のティックの値）と暗さの変化からイベントを出す */
export function weatherEvents(world: World, ctx: StaticContext): void {
  const bt = ctx.tuning.behavior;
  const m = world.weatherMemo;
  const leader = partyLeader(world);
  const l = leader.local;
  const raining = l.precipMmH >= bt.rainStartMmH;
  if (raining && !m.raining) {
    const gapOk = m.rainStoppedAtMin === null || world.tMin - m.rainStoppedAtMin >= bt.rainRestartGapMin;
    if (gapOk) ctx.events.push({ tMin: world.tMin, type: 'RAIN_START', climberId: leader.id, important: true, data: { precipMmH: l.precipMmH, precipType: l.precipType } });
    else ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: leader.id, data: { rainAgain: l.precipType } });
  } else if (!raining && m.raining) {
    m.rainStoppedAtMin = world.tMin;
    ctx.events.push({ tMin: world.tMin, type: 'RAIN_STOP', climberId: leader.id, data: { precipType: m.precipType } });
  }
  m.raining = raining;
  if (l.precipType !== m.precipType && l.precipType !== 'none' && m.precipType !== 'none') {
    ctx.events.push({ tMin: world.tMin, type: 'PRECIP_TYPE', climberId: leader.id, important: true, data: { from: m.precipType, to: l.precipType } });
  }
  if (l.precipType !== 'none') m.precipType = l.precipType;
  const up = world.sun.elevDeg > 0;
  if (up !== m.sunUp) ctx.events.push({ tMin: world.tMin, type: up ? 'SUNRISE' : 'SUNSET', important: !up });
  m.sunUp = up;
  if (world.sun.isDark && !m.dark) ctx.events.push({ tMin: world.tMin, type: 'DARK', important: true });
  m.dark = world.sun.isDark;
}

/** 開始時点の値で覚え書きを初期化する（開始直後に余計なイベントを出さない） */
export function initWeatherMemo(world: World, ctx: StaticContext): void {
  const leader = partyLeader(world);
  world.weatherMemo = {
    raining: leader.local.precipMmH >= ctx.tuning.behavior.rainStartMmH,
    rainStoppedAtMin: null,
    precipType: leader.local.precipType,
    sunUp: world.sun.elevDeg > 0,
    dark: world.sun.isDark,
  };
}

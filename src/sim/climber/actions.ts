/**
 * アクションの適用（docs/09 §6）。対象は既定でグループの全員（who で指定可）。
 * 道迷い・救助の出動・雷・グループ分割など P6 以降のアクションは、今は SCRIPT_LOG を出すだけ（DECISIONS）。
 */
import { parseTimeRef } from '../core/clock';
import { chance } from '../core/rng';
import { nearestIndex } from '../terrain/sample';
import type { Action, ClimberState, StaticContext, UntilRef, World } from '../types';
import { shelterFromWind } from '../weather/local';
import { dawnRef, ensureRouteAhead, enterShelter, goToNode, leaveShelter, setRoute, turnBack } from './route';
import { transition } from './state';

/** 細かい作業の所要時間（寒冷ストレス・手袋なしで延びる。docs/06 §7、§8） */
export function taskMinutes(c: ClimberState, base: number, ctx: StaticContext): number {
  const b = ctx.tuning.behavior;
  let m = base;
  if (c.body.coreC < ctx.tuning.physiology.stageColdC) m *= b.coldTaskF;
  if (c.def.gear.gloves === 'none' && c.local.tempC < b.noGlovesBelowC) m *= b.noGlovesTaskF;
  return m;
}

/** 手を止めて作業する（終わったら busyWith の効果を適用する。behavior.ts） */
export function startTask(world: World, c: ClimberState, what: string, minutes: number): void {
  c.plan.busyWith = what;
  c.plan.busyUntilMin = world.tMin + minutes;
}

/** "dawn" を時刻にし、"rescue"・"weatherClears" はそのまま持つ */
function resolveUntil(world: World, ctx: StaticContext, until: UntilRef): UntilRef {
  return until === 'dawn' ? dawnRef(world, ctx) : until;
}

function targetsOf(world: World, who: Action['who'], group: readonly ClimberState[], leader: ClimberState): ClimberState[] {
  if (who === 'leader') return [leader];
  if (who === undefined || who === 'all') return group.filter((c) => c.body.alive);
  const c = world.climbers.find((x) => x.id === who);
  return c && c.body.alive ? [c] : [];
}

/** 救助要請（P5: 通報の成否まで。出動と収容は P6 の rescue.ts） */
function callRescue(world: World, ctx: StaticContext, c: ClimberState, via: 'auto' | 'phone' | 'satellite'): void {
  const rt = ctx.tuning.radio;
  const ph = c.inv.phone;
  const radio = ctx.map.radio[nearestIndex(ctx.map, c.x, c.z)] ?? 0;
  const phoneOk = ph.has && !ph.dead && ph.batteryPct > 0;
  let ok = false;
  let usedVia: 'phone' | 'satellite' | null = null;
  if (via !== 'satellite' && phoneOk) {
    if (radio >= rt.callableMin) ok = true;
    else if (radio >= rt.messageOnlyMin) ok = chance(world.rng.rescue, ctx.tuning.behavior.callMessageOnlySuccessP);
    if (ok) usedVia = 'phone';
  }
  if (!ok && via !== 'phone' && phoneOk && ph.satelliteSos) {
    const sky = ctx.map.skyView[nearestIndex(ctx.map, c.x, c.z)] ?? 0;
    if (sky >= rt.satelliteSkyViewMin) {
      ok = true;
      usedVia = 'satellite';
    }
  }
  if (ok && usedVia) {
    if (world.rescue.status === 'none' || world.rescue.status === 'searching') {
      world.rescue.status = 'dispatched';
      world.rescue.calledAtMin = world.tMin;
      world.rescue.via = usedVia;
      world.rescue.locationEstimate = { x: c.x, z: c.z, radiusM: usedVia === 'satellite' || ph.gpsApp ? 50 : 500 };
    }
    ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', climberId: c.id, important: true, data: { via: usedVia } });
  } else {
    ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALL_FAILED', climberId: c.id, important: true, data: { radio } });
  }
}

function startBivouac(world: World, ctx: StaticContext, c: ClimberState, until: UntilRef, findLee: boolean, state: 'BIVOUAC' | 'WAITING_RESCUE'): void {
  leaveShelter(world, ctx, c);
  c.body.inBivy = c.def.gear.bivy !== 'none';
  c.body.groundInsulation = true;
  // 風下の避難地点への移動は P6（findLeeSpot）。P5 はその場の風下の度合いを使う
  c.body.leeShelter = findLee ? shelterFromWind(ctx.map, c.x, c.z, c.local.windDirDeg, ctx.tuning) : 0;
  c.plan.bivouacUntil = resolveUntil(world, ctx, until);
  c.memo.bivouacked = true;
  transition(world, ctx, c, state, 'action');
  if (state === 'BIVOUAC') ctx.events.push({ tMin: world.tMin, type: 'BIVOUAC_START', climberId: c.id, important: true });
}

function applyOne(world: World, ctx: StaticContext, a: Action, c: ClimberState): void {
  const bt = ctx.tuning.behavior;
  switch (a.type) {
    case 'continueRoute':
      leaveShelter(world, ctx, c);
      ensureRouteAhead(ctx, c);
      c.plan.restUntilMin = null;
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'setRoute':
      leaveShelter(world, ctx, c);
      setRoute(ctx, c, a.route, a.goalNodes);
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'turnBack':
      leaveShelter(world, ctx, c);
      turnBack(ctx, c);
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'goToNode':
      leaveShelter(world, ctx, c);
      if (goToNode(ctx, c, a.node, a.then)) transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'stayInShelter': {
      const node = c.pos.mode === 'node' ? c.pos.nodeId : null;
      if (!node || !enterShelter(world, ctx, c, node, resolveUntil(world, ctx, a.until))) {
        ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { noShelter: node } });
      }
      return;
    }
    case 'rest':
      c.plan.restUntilMin = world.tMin + a.minutes;
      transition(world, ctx, c, 'RESTING', 'action');
      return;
    case 'eat': {
      const kcal = Math.min(a.kcal, c.inv.foodKcal);
      c.inv.foodKcal -= kcal;
      c.body.gutKcal += kcal;
      c.memo.lastEatMin = world.tMin;
      if (kcal > 0) ctx.events.push({ tMin: world.tMin, type: 'EAT', climberId: c.id, data: { kcal } });
      return;
    }
    case 'drink': {
      const l = Math.min(a.liters, c.inv.waterL);
      c.inv.waterL -= l;
      c.body.waterDeficitL = Math.max(0, c.body.waterDeficitL - l);
      c.memo.lastDrinkMin = world.tMin;
      if (l > 0) ctx.events.push({ tMin: world.tMin, type: 'DRINK', climberId: c.id, data: { liters: l } });
      return;
    }
    case 'wearRainwear':
      if (c.def.gear.rainwear !== 'none' && !c.body.rainwearOn) startTask(world, c, 'rainwear', taskMinutes(c, bt.rainwearMin, ctx));
      return;
    case 'addLayer': {
      const clo = Math.min(a.clo ?? c.body.cloPack, c.body.cloPack);
      if (clo > 0) startTask(world, c, `layer:${clo}`, taskMinutes(c, bt.layerMin, ctx));
      return;
    }
    case 'changeDry':
      startTask(world, c, 'changeDry', taskMinutes(c, bt.changeDryMin, ctx));
      return;
    case 'stopAndCheck': {
      const node = c.pos.mode === 'node' ? c.pos.nodeId : (c.plan.route[c.plan.routeIndex] ?? null);
      c.plan.stopCheckedNode = node;
      c.plan.restUntilMin = world.tMin + bt.stopAndCheckMin;
      transition(world, ctx, c, 'RESTING', 'stopAndCheck');
      return;
    }
    case 'bivouac':
      startBivouac(world, ctx, c, a.until, a.findLee, 'BIVOUAC');
      return;
    case 'waitRescue':
      startBivouac(world, ctx, c, 'rescue', true, 'WAITING_RESCUE');
      return;
    case 'stayPut':
      transition(world, ctx, c, 'STAYING', 'action');
      return;
    case 'callRescue':
      callRescue(world, ctx, c, a.via);
      return;
    case 'setPace': {
      const f = Math.min(bt.paceMax, Math.max(bt.paceMin, a.factor));
      c.plan.paceFactor = f;
      c.plan.hurry = f > bt.hurryAbove;
      return;
    }
    case 'removeMetal':
      startTask(world, c, 'removeMetal', bt.removeMetalMin);
      return;
    case 'setFlag':
      if (world.flags[a.flag] === undefined) world.flags[a.flag] = world.tMin;
      return;
    case 'clearFlag':
      delete world.flags[a.flag];
      return;
    case 'narrate':
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, text: a.text });
      return;
    case 'say':
      ctx.events.push({
        tMin: world.tMin,
        type: 'SPEECH',
        climberId: c.id,
        text: a.text,
        data: { to: a.to ?? null, tone: a.tone ?? 'normal', documented: a.documented ?? false },
      });
      return;
    case 'abortTrip':
      return; // パーティ全体の処理は applyActions で行う
    default:
      // P6 以降で実装するアクション
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { unimplementedAction: a.type } });
  }
}

/** フラグと narrate・say のように、全員に適用すると重複するアクション */
const ONCE_PER_LIST = new Set(['setFlag', 'clearFlag', 'narrate']);

/**
 * アクション列を先頭から順に適用する。group はその分岐点・イベントの対象グループ、leader はそのリーダー。
 */
export function applyActions(
  world: World,
  ctx: StaticContext,
  actions: readonly Action[],
  group: readonly ClimberState[],
  leader: ClimberState,
): void {
  for (const a of actions) {
    if (a.type === 'abortTrip') {
      world.ended = { kind: 'ABORTED', atMin: world.tMin };
      ctx.events.push({ tMin: world.tMin, type: 'ENDED', important: true, data: { kind: 'ABORTED' } });
      return;
    }
    // say は既定でリーダーが言う
    const who = a.who ?? (a.type === 'say' ? 'leader' : undefined);
    const targets = ONCE_PER_LIST.has(a.type) ? [leader] : targetsOf(world, who, group, leader);
    for (const c of targets) applyOne(world, ctx, a, c);
  }
}

/** until の判定（docs/09 §6） */
export function untilReached(world: World, ctx: StaticContext, c: ClimberState, until: UntilRef | null): boolean {
  if (until === null) return false;
  if (until === 'rescue') return world.rescue.status === 'contacted';
  if (until === 'dawn') return true; // 設定時に時刻へ変換済みのはず
  if (until === 'weatherClears') {
    const b = ctx.tuning.behavior;
    const l = c.local;
    const clear = l.thunder < b.clearThunderBelow && l.precipMmH < b.clearPrecipBelowMmH && l.windMs < b.clearWindBelowMs && l.visibilityM > b.clearVisAboveM;
    if (!clear) c.memo.clearSinceMin = null;
    else if (c.memo.clearSinceMin === null) c.memo.clearSinceMin = world.tMin;
    const held = c.memo.clearSinceMin !== null && world.tMin - c.memo.clearSinceMin >= b.clearHoldMin;
    // 最長で翌朝まで
    const limit = parseTimeRef(dawnRef(world, ctx, c.stateSinceMin));
    return held || world.tMin >= limit;
  }
  return world.tMin >= parseTimeRef(until);
}

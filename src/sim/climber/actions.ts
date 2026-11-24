/**
 * アクションの適用（docs/09 §6）。対象は既定でグループの全員（who で指定可）。
 * グループの分割・離脱・まとまり方は groups.ts、浸水は physiology.ts。
 */
import { epipen, medicate, onsetIllness, sting } from './illness';
import { reportMissing } from '../rescue/rescue';
import { dispatchReport } from '../rescue/dispatch';
import { sendForHelp, startCarry } from './carry';
import { piggyback, takePack } from './childCare';
import { crossFord } from '../hazards/ford';
import { startAvalancheRescue } from '../hazards/avalanche';
import { parseTimeRef } from '../core/clock';
import { chance } from '../core/rng';
import { nearestIndex } from '../terrain/sample';
import type { Action, ClimberState, RescueReport, StaticContext, UntilRef, World } from '../types';
import { shelterFromWind } from '../weather/local';
import { checkPosition as navCheck, findLeeSpot, pathOffRidge, rejoinTrail, trailAt } from './navigation';
import { dawnRef, ensureRouteAhead, enterShelter, goToNode, leaveShelter, setRoute, turnBack } from './route';
import { transition } from './state';
import { detach, goToMember, joinGroup, setCohesion, soloErrand, splitParty } from './groups';
import { applySoak, soakWaterTempC } from './physiology';

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
  // 同じアクション列の中で離れた人（detach など）は、もう対象にしない
  if (who === undefined || who === 'all') return group.filter((c) => c.body.alive && c.groupId === leader.groupId);
  const c = world.climbers.find((x) => x.id === who);
  return c && c.body.alive ? [c] : [];
}

/**
 * 道の外（pos が free）にいる人を、まず道へ戻す。いるセルが道なら、その場で道に乗る（false を返して続ける）。
 * そうでなければ、現在地が分かっていれば近い道へ、分からなければ来た跡を戻る状態にして true を返す
 * （道に戻ったら rejoinTrail が計画のルートを続け、pendingGoTo があればそこへ向かう）。
 */
function toTrailFirst(world: World, ctx: StaticContext, c: ClimberState): boolean {
  if (c.pos.mode !== 'free') return false;
  const t = trailAt(ctx, c.x, c.z);
  if (t) {
    rejoinTrail(world, ctx, c, t.edgeId, t.s);
    return false;
  }
  c.nav = { ...c.nav, path: [] };
  const known = c.perception.knowsPosition || c.nav.track.length === 0;
  transition(world, ctx, c, known ? 'NAVIGATING_TO_TRAIL' : 'BACKTRACKING', 'action');
  return true;
}

/**
 * 救助要請（通報の成否。出動と収容は rescue.ts）。つながったら、救助隊が覚える通報の場所（を書き換えられる参照）を返す。
 * 救助隊がもう別の場所へ向かっていれば、この通報は覚えておき、そちらが済んだら向かう（ユーザーの指定: 通報ごとの位置を覚える）
 */
export function callRescue(world: World, ctx: StaticContext, c: ClimberState, via: 'auto' | 'phone' | 'satellite'): RescueReport | null {
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
    const report: RescueReport = { x: c.x, z: c.z, radiusM: usedVia === 'satellite' || ph.gpsApp ? 50 : 500, by: c.id };
    return dispatchReport(world, ctx, c, report, usedVia);
  }
  ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALL_FAILED', climberId: c.id, important: true, data: { radio } });
  return null;
}

/** 歩ける（小屋まで自分で歩いて行ける） */
function canWalkToHut(c: ClimberState): boolean {
  const b = c.body;
  return b.alive && b.conscious && c.state !== 'INCAPACITATED' && c.state !== 'UNCONSCIOUS' && b.injury !== 'legFracture' && b.injury !== 'severeTrauma' && c.M >= 0.2;
}

function startBivouac(world: World, ctx: StaticContext, c: ClimberState, until: UntilRef, findLee: boolean, state: 'BIVOUAC' | 'WAITING_RESCUE', planned = false): void {
  // すぐそこに開いている小屋があれば、外でビバークせずに小屋へ入る（ユーザーの指摘: 小屋の横でツェルトにくるまっていた）
  if (canWalkToHut(c) && !c.body.shelterNodeId) {
    const hut = findableHutNear(ctx, c);
    if (hut) {
      leaveShelter(world, ctx, c);
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { toHutInstead: hut } });
      if (c.pos.mode === 'free') {
        c.plan.pendingGoTo = { node: hut, then: 'stay' };
        if (toTrailFirst(world, ctx, c)) return;
        c.plan.pendingGoTo = null;
      }
      if (goToNode(ctx, c, hut, 'stay')) {
        transition(world, ctx, c, 'WALKING', 'toHut');
        return;
      }
    }
  }
  leaveShelter(world, ctx, c);
  // 歩いていた道順は捨てる（風下を探すときは、下で新しく引く）
  c.nav = { ...c.nav, path: [] };
  c.body.inBivy = c.def.gear.bivy !== 'none';
  c.body.groundInsulation = true;
  c.body.leeShelter = findLee ? shelterFromWind(ctx.map, c.x, c.z, c.local.windDirDeg, ctx.tuning) : 0;
  if (findLee) {
    // 風下の避難地点へ移ってから落ち着く（docs/04 §8）
    const spot = findLeeSpot(ctx, c.x, c.z, c.local.windDirDeg);
    if (spot && spot.shelter > c.body.leeShelter && (spot.x - c.x) * (spot.x - c.x) + (spot.z - c.z) * (spot.z - c.z) > ctx.map.cell * ctx.map.cell) {
      c.pos = { mode: 'free', x: c.x, z: c.z };
      c.nav.path = [[spot.x, spot.z]];
      c.body.leeShelter = spot.shelter;
    }
  }
  c.plan.bivouacUntil = resolveUntil(world, ctx, until);
  // 計画どおりの野営は遭難のビバークに数えない（ログはシナリオの文が出す）
  if (!planned) c.memo.bivouacked = true;
  if (planned) c.plan.plannedCamp = true;
  else delete c.plan.plannedCamp;
  transition(world, ctx, c, state, 'action');
  if (state === 'BIVOUAC' && !planned) ctx.events.push({ tMin: world.tMin, type: 'BIVOUAC_START', climberId: c.id, important: true });
}

function applyOne(world: World, ctx: StaticContext, a: Action, c: ClimberState): void {
  const bt = ctx.tuning.behavior;
  switch (a.type) {
    case 'continueRoute':
      // 同じアクション列で「休む → 進む」と並べたときは、休み終えてから進む（休みを打ち消さない）
      if (c.state === 'RESTING' && c.stateSinceMin === world.tMin && c.plan.restUntilMin !== null && c.plan.restUntilMin > world.tMin) {
        ensureRouteAhead(ctx, c);
        return;
      }
      leaveShelter(world, ctx, c);
      c.plan.restUntilMin = null;
      // 道の外にいるなら、まず道へ戻る（戻ったら計画のルートを続ける）
      if (toTrailFirst(world, ctx, c)) return;
      ensureRouteAhead(ctx, c);
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'setRoute':
      leaveShelter(world, ctx, c);
      if (c.pos.mode === 'free') {
        c.plan.route = [...a.route];
        c.plan.routeIndex = 0;
        if (a.goalNodes) c.plan.goalNodes = [...a.goalNodes];
        if (toTrailFirst(world, ctx, c)) return;
      }
      setRoute(ctx, c, a.route, a.goalNodes);
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    case 'turnBack': {
      leaveShelter(world, ctx, c);
      // もう出発点（登山口）へ下っている人は、引き返す＝また登ることにはしない（そのまま下る）
      const home = ctx.scenario.plan.route[0];
      const goingHome = home !== undefined && c.plan.goalNodes.includes(home) && c.plan.route[c.plan.route.length - 1] === home;
      if (!goingHome) turnBack(ctx, c);
      else ensureRouteAhead(ctx, c);
      if (toTrailFirst(world, ctx, c)) return;
      transition(world, ctx, c, 'WALKING', 'action');
      return;
    }
    case 'goToNode': {
      leaveShelter(world, ctx, c);
      const node = a.node === '$nearestShelter' ? nearestShelterNode(ctx, c) : a.node;
      if (!node) return;
      // 道の外にいるなら、道に戻ってから向かう
      if (c.pos.mode === 'free') {
        c.plan.pendingGoTo = { node, then: a.then };
        if (toTrailFirst(world, ctx, c)) return;
        c.plan.pendingGoTo = null;
      }
      if (goToNode(ctx, c, node, a.then)) transition(world, ctx, c, 'WALKING', 'action');
      return;
    }
    case 'checkPosition': {
      const r = navCheck(world, ctx, c);
      startTask(world, c, 'checkPos', r.minutes);
      return;
    }
    case 'backtrack':
      if (c.pos.mode !== 'free') c.pos = { mode: 'free', x: c.x, z: c.z };
      c.nav.path = [];
      c.nav.trackCheckM = 0;
      transition(world, ctx, c, 'BACKTRACKING', 'action');
      return;
    case 'navigateToTrail':
      if (!c.perception.knowsPosition) {
        ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { needsPosition: true } });
        return;
      }
      if (c.pos.mode !== 'free') c.pos = { mode: 'free', x: c.x, z: c.z };
      c.nav.path = [];
      transition(world, ctx, c, 'NAVIGATING_TO_TRAIL', 'action');
      return;
    case 'descendDrainage':
      if (c.pos.mode !== 'free') c.pos = { mode: 'free', x: c.x, z: c.z };
      c.nav.path = [];
      transition(world, ctx, c, 'DESCENDING_DRAINAGE', 'action');
      return;
    case 'seekSignal':
      leaveShelter(world, ctx, c);
      if (c.pos.mode !== 'free') c.pos = { mode: 'free', x: c.x, z: c.z };
      c.nav.path = [];
      transition(world, ctx, c, 'SEEKING_SIGNAL', 'action');
      return;
    case 'lightningPosture':
      c.plan.postureUntilMin = world.tMin + a.minutes;
      c.plan.restUntilMin = world.tMin + a.minutes;
      transition(world, ctx, c, 'RESTING', 'lightningPosture');
      return;
    case 'moveOffRidge': {
      const path = pathOffRidge(ctx, c, a.minDropM);
      if (path && path.length > 0) {
        c.pos = { mode: 'free', x: c.x, z: c.z };
        c.nav.path = path;
      }
      c.plan.restUntilMin = null;
      c.plan.bivouacUntil = 'weatherClears';
      transition(world, ctx, c, 'RESTING', 'offRidge');
      return;
    }
    case 'stayInShelter': {
      const node = c.pos.mode === 'node' ? c.pos.nodeId : null;
      // もうその小屋の中にいるなら、いつまでいるかだけ変える（「入った」を二度出さない）
      if (node && c.body.shelterNodeId === node && c.state === 'SHELTERED') {
        c.plan.bivouacUntil = resolveUntil(world, ctx, a.until);
        return;
      }
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
    case 'reportMissing':
      reportMissing(world, a.by);
      return;
    case 'sound':
      ctx.events.push({ tMin: world.tMin, type: 'SOUND', data: { id: a.id, volume: a.volume ?? 1 } });
      return;
    case 'music':
      ctx.events.push({ tMin: world.tMin, type: 'MUSIC', data: { id: a.id, volume: a.volume ?? 1 } });
      return;
    case 'focus':
      // 世界の状態なので、対象の人数にかかわらず 1 回だけ
      if (world.focusGroup === a.group) return;
      world.focusGroup = a.group;
      {
        const start = ctx.scenario.groups?.find((g) => g.id === a.group)?.members;
        const ids = new Set(world.climbers.filter((x) => x.groupId === a.group).map((x) => x.id));
        if (Array.isArray(start)) for (const id of start) ids.add(id);
        world.focusMembers = [...ids];
      }
      ctx.events.push({ tMin: world.tMin, type: 'FOCUS', important: true, data: { group: a.group } });
      return;
    case 'leaveMap':
      // 下山した（救助された）人だけ。山の中にいる人を消さない
      if (c.state !== 'FINISHED' && c.state !== 'RESCUED') return;
      if (c.offMap === a.place) return;
      c.offMap = a.place;
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { leftMap: a.place } });
      return;
    case 'setPhone':
      c.inv.phone.has = a.has;
      return;
    case 'illness':
      onsetIllness(world, ctx, c, a.kind, a.weights);
      return;
    case 'medicate':
      medicate(world, ctx, c);
      return;
    case 'sting':
      sting(world, ctx, c, a.p ?? 1);
      return;
    case 'epipen':
      epipen(world, ctx, c);
      return;
    case 'addAnxiety':
      c.body.anxiety = Math.min(100, Math.max(0, c.body.anxiety + a.amount));
      return;
    case 'drinkAlcohol':
      c.body.alcoholG = (c.body.alcoholG ?? 0) + Math.max(0, a.grams);
      // 飲み物そのものは水分になる（あとで利尿で一部が出ていく）
      if (a.liters) c.body.waterDeficitL = Math.max(0, c.body.waterDeficitL - a.liters);
      return;
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
      navCheck(world, ctx, c);
      c.plan.restUntilMin = world.tMin + bt.stopAndCheckMin;
      transition(world, ctx, c, 'RESTING', 'stopAndCheck');
      return;
    }
    case 'missJunction': {
      // 確かめずに、目の前の紛らわしい道へそのまま入る（入ったあとに気づくかどうかは、これまでどおりモデルが決める）
      c.plan.missJunctionNode = c.pos.mode === 'node' ? c.pos.nodeId : (c.plan.route[c.plan.routeIndex] ?? null);
      return;
    }
    case 'bivouac':
      startBivouac(world, ctx, c, a.until, a.findLee, 'BIVOUAC', a.planned === true);
      return;
    case 'waitRescue':
      startBivouac(world, ctx, c, 'rescue', true, 'WAITING_RESCUE');
      return;
    case 'stayPut':
      // 歩いていた道順は捨てる（止まったのに残りの道順を歩き続けない）
      c.nav = { ...c.nav, path: [] };
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
        data: { key: 'say', to: a.to ?? null, tone: a.tone ?? 'normal', distortLevel: c.body.coreC < 34 ? 2 : c.body.coreC < 35 ? 1 : 0, documented: a.documented ?? false, source: a.source ?? null },
      });
      return;
    case 'soak':
      soak(world, ctx, c, a.level, a.snowmelt ?? false);
      return;
    case 'setCohesion':
      setCohesion(world, c, a.cohesion);
      return;
    case 'goToMember':
      leaveShelter(world, ctx, c);
      goToMember(world, ctx, c, a.member);
      return;
    case 'joinGroup':
      joinGroup(world, ctx, c, a.group);
      return;
    case 'abortTrip':
      return; // パーティ全体の処理は applyActions で行う
    default:
      // P6 以降で実装するアクション
      ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { unimplementedAction: a.type } });
  }
}

/** 冷水に浸かる（docs/06 §4.1） */
export function soak(world: World, ctx: StaticContext, c: ClimberState, level: 'feet' | 'knees' | 'waist' | 'full', snowmelt: boolean): void {
  if (!c.body.alive) return;
  applySoak(c, level, soakWaterTempC(c, snowmelt, ctx.tuning), world.tMin, ctx.tuning);
  ctx.events.push({ tMin: world.tMin, type: 'SOAK', climberId: c.id, important: level === 'full' || level === 'waist', data: { level } });
}

/** フラグ・narrate・救助要請のように、全員に適用すると重複するアクション（リーダーが 1 回だけ行う） */
const ONCE_PER_LIST = new Set(['setFlag', 'clearFlag', 'narrate', 'callRescue', 'setCohesion', 'sound', 'music']);

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
    const apply = (acts: readonly Action[], g: readonly ClimberState[], l: ClimberState): void => applyActions(world, ctx, acts, g, l);
    if (a.type === 'splitParty') {
      splitParty(world, ctx, a.groups, group, apply);
      continue;
    }
    // 歩けない仲間を運ぶ・救助を呼びに行く（グループ全体で 1 回。climber/carry.ts）
    if (a.type === 'carryInjured') {
      startCarry(world, ctx, leader, apply);
      continue;
    }
    if (a.type === 'sendForHelp') {
      sendForHelp(world, ctx, leader, apply);
      continue;
    }
    if (a.type === 'detach') {
      for (const c of targetsOf(world, a.who ?? 'leader', group, leader)) detach(world, ctx, c, a.then, apply, a.returnAfter ?? false);
      continue;
    }
    // 1 人だけが電波を探しに行くときは、グループから一時的に離れる（残りの人はその場にとどまる）
    if (a.type === 'seekSignal' && a.who !== undefined && a.who !== 'all' && a.who !== 'leader') {
      for (const c of targetsOf(world, a.who, group, leader)) {
        if (world.climbers.some((o) => o !== c && o.groupId === c.groupId && o.body.alive)) soloErrand(world, c, a.returnAfter ?? false);
        applyOne(world, ctx, a, c);
      }
      continue;
    }
    // 渡渉（グループ全員で。hazards/ford.ts）・雪崩に埋まった人の捜索（hazards/avalanche.ts）
    if (a.type === 'ford') {
      crossFord(world, ctx, group, a.ford, a.rope ?? false);
      continue;
    }
    if (a.type === 'avalancheRescue') {
      startAvalancheRescue(world, ctx, group, a.helpers ?? 0, a.helpersAfterMin ?? 0);
      continue;
    }
    // 子どもを連れた山行: 荷物を代わりに持つ・背負う（climber/childCare.ts）
    if (a.type === 'takePack') {
      const from = world.climbers.find((x) => x.id === a.from);
      if (from) takePack(world, ctx, targetsOf(world, a.who ?? 'leader', group, leader), from);
      continue;
    }
    if (a.type === 'piggyback') {
      const rider = world.climbers.find((x) => x.id === a.rider);
      const carrier = targetsOf(world, a.who ?? 'leader', group, leader)[0];
      if (rider && carrier) piggyback(world, ctx, carrier, rider, a.minutes);
      continue;
    }
    // say は既定でリーダーが言う
    const who = a.who ?? (a.type === 'say' ? 'leader' : undefined);
    // 1 回だけのアクションはリーダーが行う。ただし登山者を名指ししていれば、その人（通報する人など）
    const named = who !== undefined && who !== 'all' && who !== 'leader' ? world.climbers.find((x) => x.id === who && x.body.alive) : undefined;
    const targets = ONCE_PER_LIST.has(a.type) ? [named ?? leader] : targetsOf(world, who, group, leader);
    for (const c of targets) applyOne(world, ctx, a, c);
  }
}

/** until の判定（docs/09 §6） */
export function untilReached(world: World, ctx: StaticContext, c: ClimberState, until: UntilRef | null): boolean {
  if (until === null) return false;
  // 救助隊がその人を収容するまで（収容で RESCUED になる。ほかの人に接触しただけでは終わらない）
  if (until === 'rescue') return false;
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

/** 開いている小屋のうち直線距離で最も近いノード */
/**
 * この人から「すぐそこ」と分かる小屋の距離（m）。見通しが悪いと縮む（吹雪・霧で小屋が見えない。ユーザーの指定: s17 立山）。
 * シナリオで「見通しが悪いと見つけられない」とした小屋（nodeOverrides.hiddenBelowVisM）は、そのあいだ見つからない
 */
export function hutFindableM(ctx: StaticContext, c: ClimberState, nodeId: string): number {
  const bt = ctx.tuning.behavior;
  const hidden = ctx.scenario.nodeOverrides?.[nodeId]?.hiddenBelowVisM;
  if (hidden !== undefined && c.local.visibilityM < hidden) return 0;
  return Math.min(bt.hutNearM, Math.max(bt.hutSeeMinM, c.local.visibilityM * bt.hutSeeVisF));
}

/** すぐそこに見つけられる開いている小屋（なければ null） */
export function findableHutNear(ctx: StaticContext, c: ClimberState): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const nd of Object.values(ctx.map.nodes)) {
    const open = ctx.scenario.nodeOverrides?.[nd.id]?.open ?? nd.shelter?.open ?? false;
    if (!nd.shelter || !open) continue;
    const d = Math.sqrt((nd.x - c.x) * (nd.x - c.x) + (nd.z - c.z) * (nd.z - c.z));
    if (d <= hutFindableM(ctx, c, nd.id) && d < bestD) {
      bestD = d;
      best = nd.id;
    }
  }
  return best;
}

export function nearestShelterNode(ctx: StaticContext, c: ClimberState, maxM = Infinity): string | null {
  let best: string | null = null;
  let bestD = maxM;
  for (const nd of Object.values(ctx.map.nodes)) {
    const open = ctx.scenario.nodeOverrides?.[nd.id]?.open ?? nd.shelter?.open ?? false;
    if (!nd.shelter || !open) continue;
    const d = Math.sqrt((nd.x - c.x) * (nd.x - c.x) + (nd.z - c.z) * (nd.z - c.z));
    if (d < bestD) {
      bestD = d;
      best = nd.id;
    }
  }
  return best;
}

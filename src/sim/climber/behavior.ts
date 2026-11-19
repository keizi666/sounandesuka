/**
 * 行動の状態機械（docs/07 §2）のうち P5 の分（RESTING / SHELTERED / BIVOUAC / STAYING / WAITING_RESCUE）と、
 * 自律ミクロ行動（docs/07 §4）。ミクロ行動は 1 ゲーム分に 1 回、behavior ストリームで判定する。
 * 作業中（plan.busyUntilMin）は歩かず、終わったら効果を適用する。
 */
import { chance } from '../core/rng';
import type { ClimberState, StaticContext, World } from '../types';
import { startTask, taskMinutes, untilReached } from './actions';
import { ensureRouteAhead, leaveShelter } from './route';

/** 休むのにふつう使う所: 小屋（避難小屋・営業小屋）と、茶屋・休憩所 */
function restSpot(n: { shelter?: unknown; type: string; name: string } | undefined): boolean {
  return n !== undefined && (n.shelter !== undefined || n.type === 'hut' || n.type === 'shelter' || /茶屋|小屋|山荘|休憩所/.test(n.name));
}

/** 小屋・茶屋のところにいるか（その地点か、いま通った地点がそれで 80 m 以内。1 ティックで地点を通り過ぎることがあるので） */
function hutHere(ctx: StaticContext, c: ClimberState): boolean {
  if (c.pos.mode === 'node') return restSpot(ctx.map.nodes[c.pos.nodeId]);
  const near = (id: string | undefined): boolean => {
    const n = id !== undefined ? ctx.map.nodes[id] : undefined;
    return n !== undefined && restSpot(n) && (n.x - c.x) * (n.x - c.x) + (n.z - c.z) * (n.z - c.z) <= HUT_HERE_M * HUT_HERE_M;
  };
  // 次の地点が小屋なら、着くまで歩く（手前では休まない）。通り過ぎた直後なら、そこで休む
  return near(c.plan.route[c.plan.routeIndex - 1]);
}
const HUT_HERE_M = 80;

/** これから向かうルートの先、distM の中に小屋があるか（次の 2 地点まで、直線距離で見る） */
function hutAhead(ctx: StaticContext, c: ClimberState, distM: number): boolean {
  const ahead = c.plan.route.slice(c.plan.routeIndex, c.plan.routeIndex + 2);
  return ahead.some((id) => {
    const n = ctx.map.nodes[id];
    return n !== undefined && restSpot(n) && (n.x - c.x) * (n.x - c.x) + (n.z - c.z) * (n.z - c.z) <= distM * distM;
  });
}
import { transition } from './state';

// 道を外れて動いている間（沢を下る・来た跡を戻る・道へ向かう・電波を探す）も、明かり・雨具・防寒・飲食は自分でする
const ACTIVE = new Set(['WALKING', 'RESTING', 'SHELTERED', 'BIVOUAC', 'STAYING', 'WAITING_RESCUE', 'LOST_AWARE', 'OFFROUTE_UNAWARE', 'DESCENDING_DRAINAGE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'SEEKING_SIGNAL']);

/** 作業が終わったら効果を適用する */
export function finishTask(world: World, ctx: StaticContext, c: ClimberState): void {
  if (c.plan.busyUntilMin === null || world.tMin < c.plan.busyUntilMin - 1e-9) return;
  const what = c.plan.busyWith ?? '';
  c.plan.busyUntilMin = null;
  c.plan.busyWith = null;
  const b = c.body;
  if (what === 'rainwear') {
    b.rainwearOn = true;
    ctx.events.push({ tMin: world.tMin, type: 'GEAR', climberId: c.id, important: true, data: { rainwearOn: true } });
  } else if (what === 'unwear') {
    b.rainwearOn = false;
    ctx.events.push({ tMin: world.tMin, type: 'GEAR', climberId: c.id, data: { rainwearOn: false } });
  } else if (what.startsWith('layer:')) {
    const clo = Math.min(Number(what.slice(6)), b.cloPack);
    b.cloPack -= clo;
    b.cloWorn += clo;
    ctx.events.push({ tMin: world.tMin, type: 'GEAR', climberId: c.id, data: { layerClo: clo } });
  } else if (what === 'changeDry') {
    b.wetness *= ctx.tuning.behavior.changeDryWetnessF;
    b.cloWorn += b.cloPack;
    b.cloPack = 0;
    // 強い雨の中での着替えは、その間に冷える（docs/06 §4.1）
    const bt = ctx.tuning.behavior;
    if (!b.shelterNodeId && !b.inBivy && c.local.precipMmH >= bt.changeDryChillPrecipMmH) b.coreC -= bt.changeDryChillC;
    ctx.events.push({ tMin: world.tMin, type: 'GEAR', climberId: c.id, data: { changeDry: true } });
  } else if (what.startsWith('eat:')) {
    const kcal = Math.min(Number(what.slice(4)), c.inv.foodKcal);
    c.inv.foodKcal -= kcal;
    b.gutKcal += kcal;
    ctx.events.push({ tMin: world.tMin, type: 'EAT', climberId: c.id, data: { kcal } });
  } else if (what.startsWith('drink:')) {
    const l = Math.min(Number(what.slice(6)), c.inv.waterL);
    c.inv.waterL -= l;
    b.waterDeficitL = Math.max(0, b.waterDeficitL - l);
    ctx.events.push({ tMin: world.tMin, type: 'DRINK', climberId: c.id, data: { liters: l } });
  } else if (what === 'checkPos') {
    // 位置確認の結果はアクションの時点で決まっている（knowsPosition）
  } else if (what === 'lamp') {
    c.inv.headlamp.on = true;
    ctx.events.push({ tMin: world.tMin, type: 'LAMP', climberId: c.id, data: { on: true } });
  }
}

/** 自律ミクロ行動（docs/07 §4）。1 ゲーム分に 1 回呼ぶ */
/** tight で人数の多いグループの、リーダー以外の人か */
function followsLargeGroup(world: World, c: ClimberState, minSize: number): boolean {
  let g: World['groups'][number] | undefined;
  for (const x of world.groups) if (x.id === c.groupId) g = x;
  if (!g || g.cohesion !== 'tight' || g.leader === c.id) return false;
  let n = 0;
  for (const o of world.climbers) if (o.groupId === c.groupId && o.body.alive) n += 1;
  return n >= minSize;
}

export function autonomous(world: World, ctx: StaticContext, c: ClimberState): void {
  const bt = ctx.tuning.behavior;
  const b = c.body;
  if (!b.alive || !b.conscious || !ACTIVE.has(c.state)) return;
  if (b.coreC < ctx.tuning.physiology.stageModerateC) return; // 中等度以上では自律行動できない
  const l = c.local;
  const rng = world.rng.behavior;
  const J = c.J;
  if (l.precipMmH >= bt.rainStartMmH) c.memo.lastPrecipMin = world.tMin;
  if (c.plan.busyUntilMin !== null) return;
  const indoors = b.shelterNodeId !== null;
  const atNode = world.recentEvents.some((e) => e.type === 'NODE_ARRIVE' && e.climberId === c.id);
  // 大人数の tight のグループでは、歩いている間は各自で止まらず、リーダーの休憩に合わせて食べる・飲む・着る（列を止めない）
  const waitForRest = c.state === 'WALKING' && followsLargeGroup(world, c, bt.groupSyncMinSize);

  // 雨具を着る
  if (!indoors && l.precipMmH >= bt.rainwearPrecipMmH && !b.rainwearOn && c.def.gear.rainwear !== 'none') {
    const urgent = b.wetness > bt.rainwearUrgentWetness || atNode;
    // 「着いてから着る」と決めた（フラグ rainwearLater）間は、急ぐ理由がなければ着ない
    const later = world.flags['rainwearLater'] !== undefined && !urgent;
    const p = later ? 0 : urgent ? bt.rainwearUrgentP * J : bt.rainwearP * (1 - c.def.habits.delaysRainwear) * J;
    if (chance(rng, p)) return startTask(world, c, 'rainwear', taskMinutes(c, bt.rainwearMin, ctx));
  }
  // 防寒着を足す
  const resting = c.state !== 'WALKING';
  if (!waitForRest && b.cloPack > 0 && (b.coreC < bt.layerCoreBelowC || (l.windChillC < bt.layerWindChillBelowC && resting))) {
    if (chance(rng, bt.layerP * J)) return startTask(world, c, `layer:${b.cloPack}`, taskMinutes(c, bt.layerMin, ctx));
  }
  // 食べる
  if (!waitForRest && c.inv.foodKcal > 0) {
    const every = c.def.habits.eatEveryMin;
    const habitDue = every !== null && c.memo.lastEatMin !== null && world.tMin - c.memo.lastEatMin >= every;
    const low = b.glycogenKcal < bt.eatLowGlycogenKcal;
    if (habitDue || low) {
      const p = habitDue ? bt.eatHabitP : J < bt.eatForgetBelowJ ? bt.eatForgetP : bt.eatLowP * J;
      if (chance(rng, p)) {
        c.memo.lastEatMin = world.tMin;
        return startTask(world, c, `eat:${Math.min(bt.eatKcal, c.inv.foodKcal)}`, taskMinutes(c, bt.eatMin, ctx));
      }
    }
  }
  // 飲む
  if (!waitForRest && c.inv.waterL > 0 && b.waterDeficitL > bt.drinkDeficitL && chance(rng, bt.drinkP * J)) {
    c.memo.lastDrinkMin = world.tMin;
    return startTask(world, c, `drink:${Math.min(bt.drinkL, c.inv.waterL, b.waterDeficitL)}`, bt.drinkMin);
  }
  // 決まった間隔で休む（グループはリーダーの習慣に合わせる）。小屋の近くなら小屋で休む（ユーザーの指定）:
  // 小屋に着いたとき休む時間が近ければ小屋で休み、休む時間でも行く先のすぐそこに小屋があれば、小屋まで歩く
  const atHut = c.state === 'WALKING' && hutHere(ctx, c);
  const dueAtHut = atHut && c.memo.walkSinceRestMin >= bt.habitRestEveryMin - bt.hutEarlyMin;
  if ((c.state === 'WALKING' && c.memo.walkSinceRestMin >= bt.habitRestEveryMin && (atHut || !hutAhead(ctx, c, bt.hutAheadM))) || dueAtHut) {
    c.memo.walkSinceRestMin = 0;
    c.plan.restUntilMin = world.tMin + bt.habitRestMin;
    transition(world, ctx, c, 'RESTING', 'habit');
    return;
  }
  // 疲れて休む（ひどく疲れていなければ、すぐ先の小屋・茶屋まで歩いてそこで休む）
  if (!waitForRest && c.state === 'WALKING' && b.fatigue > bt.restFatigue && (hutHere(ctx, c) || b.fatigue > bt.restFatigueNow || !hutAhead(ctx, c, bt.hutAheadM)) && chance(rng, bt.restP)) {
    c.plan.restUntilMin = world.tMin + bt.restMin;
    transition(world, ctx, c, 'RESTING', 'fatigue');
    return;
  }
  // ヘッドランプ
  const lamp = c.inv.headlamp;
  const moving = c.state === 'WALKING' || c.pos.mode === 'free' || c.state === 'OFFROUTE_UNAWARE';
  if (lamp.on && !moving && !indoors) lamp.on = false; // 止まっている間は消して電池を節約
  if (lamp.on && indoors) lamp.on = false;
  if (world.sun.isDark && moving && lamp.has && !lamp.on && lamp.batteryH > 0 && chance(rng, bt.lampP)) {
    if (lamp.inPack) return startTask(world, c, 'lamp', taskMinutes(c, bt.lampInPackMin, ctx));
    lamp.on = true;
    ctx.events.push({ tMin: world.tMin, type: 'LAMP', climberId: c.id, data: { on: true } });
    return;
  }
  // 雨具を脱ぐ（登りで暑い）
  const dryLong = c.memo.lastPrecipMin === null || world.tMin - c.memo.lastPrecipMin >= bt.unwearDryMin;
  if (b.rainwearOn && dryLong && c.state === 'WALKING' && b.coreC > bt.unwearCoreAboveC && chance(rng, bt.unwearP * J)) {
    return startTask(world, c, 'unwear', bt.unwearMin);
  }
}

/** WALKING 以外の状態の 1 ティック（終了条件の判定） */
export function stepState(world: World, ctx: StaticContext, c: ClimberState): void {
  switch (c.state) {
    case 'RESTING': {
      const until = c.plan.restUntilMin;
      const done = until !== null ? world.tMin >= until - 1e-9 : untilReached(world, ctx, c, c.plan.bivouacUntil);
      if (done) {
        c.plan.restUntilMin = null;
        c.plan.bivouacUntil = null;
        c.plan.postureUntilMin = null;
        if (c.pos.mode === 'free') {
          // 稜線を外れて待っていた等: 登山道へ戻る
          c.perception.knowsPosition = true;
          c.nav.path = [];
          transition(world, ctx, c, 'NAVIGATING_TO_TRAIL', 'restEnd');
          return;
        }
        ensureRouteAhead(ctx, c);
        transition(world, ctx, c, 'WALKING', 'restEnd');
      }
      return;
    }
    case 'SHELTERED':
    case 'BIVOUAC':
      if (untilReached(world, ctx, c, c.plan.bivouacUntil)) {
        leaveShelter(world, ctx, c);
        if (c.pos.mode === 'free') {
          c.perception.knowsPosition = true;
          c.nav.path = [];
          transition(world, ctx, c, 'NAVIGATING_TO_TRAIL', 'stayEnd');
          return;
        }
        ensureRouteAhead(ctx, c);
        transition(world, ctx, c, 'WALKING', 'stayEnd');
      }
      return;
    case 'WAITING_RESCUE':
      if (world.rescue.status === 'none') {
        // 通報できていない（未帰還通報もまだ）: その場で待つ
      }
      return;
    case 'STAYING':
    default:
      return;
  }
}

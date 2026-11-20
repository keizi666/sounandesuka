/**
 * 機器（docs/08 §4）: スマートフォンとヘッドランプの電池。
 * 寒さ: ポケット内の温度（局地気温 + 15℃）が 0℃ 未満で残量が 20% を下回ると、突然 0% になる。
 * モバイルバッテリー（ユーザーの指定）: 持っていれば、本人の判断（chargeDecision）で充電する。雨の中（外）では濡れるので充電できない。
 */
import type { ClimberState, StaticContext, World } from '../types';

/** スマホが頼りになる状態（道迷い・救助待ち・ビバーク・動けない・電波を探す）。このときは早めに充電する */
const DISTRESS = new Set(['LOST_AWARE', 'WAITING_RESCUE', 'BIVOUAC', 'STAYING', 'INCAPACITATED', 'SEEKING_SIGNAL', 'DESCENDING_DRAINAGE']);

/** 雨に濡れずに充電できる所にいるか（小屋・テント・ツェルトの中、または雨が弱い） */
export function canChargeDry(ctx: StaticContext, c: ClimberState): boolean {
  return c.body.shelterNodeId !== null || c.body.inBivy || c.local.precipMmH <= ctx.tuning.devices.chargeMaxRainMmH;
}

/**
 * 充電するかの判断（思考）: 残りが少なくなった（遭難のさなかは早めに）・バッテリーが残っている・濡れない所、のときに始め、
 * 十分たまるか、雨になるか、バッテリーが尽きたらやめる。'rain' は充電したいが雨でできない
 */
export function chargeDecision(ctx: StaticContext, c: ClimberState): 'charge' | 'idle' | 'rain' {
  const dt = ctx.tuning.devices;
  const ph = c.inv.phone;
  if (!ph.has || (c.inv.powerBankPct ?? 0) <= 0 || !c.body.alive || !c.body.conscious) return 'idle';
  const below = DISTRESS.has(c.state) || c.perception.awareLost ? dt.chargeBelowDistressPct : dt.chargeBelowPct;
  const want = c.inv.charging ? ph.batteryPct < dt.chargeUntilPct : ph.batteryPct < below || ph.dead;
  if (!want) return 'idle';
  return canChargeDry(ctx, c) ? 'charge' : 'rain';
}

export function drainDevices(world: World, ctx: StaticContext, c: ClimberState, dtMin: number): void {
  const dt = ctx.tuning.devices;
  const ph = c.inv.phone;
  // モバイルバッテリーで充電（電池が切れたスマホも、充電すればまた使える）
  const dec = chargeDecision(ctx, c);
  if (dec === 'charge') {
    const add = Math.min(dt.chargePctPerMin * dtMin, c.inv.powerBankPct ?? 0, 100 - ph.batteryPct);
    if (!c.inv.charging) ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, data: { chargeStart: true } });
    c.inv.charging = true;
    ph.batteryPct += add;
    c.inv.powerBankPct = Math.max(0, (c.inv.powerBankPct ?? 0) - add);
    if (ph.dead && ph.batteryPct > 0) ph.dead = false;
  } else c.inv.charging = false;
  if (ph.has && !ph.dead) {
    const rate = ph.trackRecording ? dt.phoneTrackPctH : dt.phoneIdlePctH;
    ph.batteryPct = Math.max(0, ph.batteryPct - (rate / 60) * dtMin);
    const pocketC = c.local.tempC + dt.phonePocketWarmC;
    if (pocketC < 0 && ph.batteryPct < dt.phoneColdCliffPct) ph.batteryPct = 0;
    if (ph.batteryPct <= 0) {
      ph.dead = true;
      ctx.events.push({ tMin: world.tMin, type: 'PHONE_DEAD', climberId: c.id, important: true });
    }
  }
  const lamp = c.inv.headlamp;
  if (lamp.on) {
    lamp.batteryH = Math.max(0, lamp.batteryH - dtMin / 60);
    if (lamp.batteryH <= 0) {
      if (lamp.spareBatteryH > 0) {
        lamp.batteryH = lamp.spareBatteryH;
        lamp.spareBatteryH = 0;
      } else {
        lamp.on = false;
        ctx.events.push({ tMin: world.tMin, type: 'LAMP_DEAD', climberId: c.id, important: true });
      }
    }
    // 明るくなったら消す
    if (!world.sun.isDark && !world.sun.twilight) lamp.on = false;
  }
}

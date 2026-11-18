/**
 * 機器（docs/08 §4）: スマートフォンとヘッドランプの電池。
 * 寒さ: ポケット内の温度（局地気温 + 15℃）が 0℃ 未満で残量が 20% を下回ると、突然 0% になる。
 */
import type { ClimberState, StaticContext, World } from '../types';

export function drainDevices(world: World, ctx: StaticContext, c: ClimberState, dtMin: number): void {
  const dt = ctx.tuning.devices;
  const ph = c.inv.phone;
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

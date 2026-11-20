/**
 * 通報が届いたときに、救助隊がどこへ向かうかを決める（callRescue と、仲間が知らせに行ったとき: climber/carry.ts）。
 * まだ向かっていなければこの場所へ出る。もう別の場所へ向かっていれば、この通報は覚えておき、そちらが済んだら向かう
 * （ユーザーの指定: 通報ごとの位置を覚える）
 */
import type { ClimberState, RescueReport, StaticContext, World } from '../types';

export type ReportVia = 'phone' | 'satellite' | 'relay';

/** 通報を受け付けて、救助隊が覚えた通報（を書き換えられる参照）を返す */
export function dispatchReport(world: World, ctx: StaticContext, c: ClimberState, report: RescueReport, via: ReportVia): RescueReport | null {
  const r = world.rescue;
  let stored: RescueReport | null = null;
  if (r.status === 'none' || r.status === 'searching' || r.status === 'contacted') {
    // まだ向かっていない（または、前の通報の人をみな収容し終えた）: この通報の場所へ出る
    if (r.status === 'contacted') {
      r.heli = { readyAtMin: null, nextCheckMin: null, state: 'idle' };
      r.ground = { readyAtMin: null, x: 0, z: 0, state: 'idle' };
    }
    r.status = 'dispatched';
    r.calledAtMin = world.tMin;
    r.via = via;
    const est = { x: report.x, z: report.z, radiusM: report.radiusM };
    r.locationEstimate = est;
    stored = est as RescueReport;
  } else {
    // もう別の場所へ向かっている: 同じ場所（収容の範囲の中）でなければ覚えておく
    const rr = ctx.tuning.rescue.contactRadiusM;
    const near = (a: { x: number; z: number }): boolean => (a.x - report.x) * (a.x - report.x) + (a.z - report.z) * (a.z - report.z) <= rr * rr;
    if (!r.reports) r.reports = [];
    const list = r.reports;
    const same = list.find((x) => x.by === c.id || near(x));
    if (r.locationEstimate && near(r.locationEstimate)) stored = r.locationEstimate as RescueReport;
    else if (same) {
      Object.assign(same, report);
      stored = same;
    } else {
      list.push(report);
      stored = report;
    }
  }
  ctx.events.push({ tMin: world.tMin, type: 'RESCUE_CALLED', climberId: c.id, important: true, data: { via } });
  // 救助隊が位置を知れたか（ユーザーの指定: ログに書く）。queued: もう別の場所へ向かっているので、覚えておいて後で向かう
  const queued = stored !== null && stored !== (r.locationEstimate as RescueReport | null);
  ctx.events.push({ tMin: world.tMin, type: 'SCRIPT_LOG', climberId: c.id, important: true, data: { rescueLoc: queued ? 'queued' : 'known', radiusM: stored?.radiusM ?? 0 } });
  return stored;
}

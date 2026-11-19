/**
 * 記録（docs/12 §1）。RunRecord は World とは別のオブジェクトで、決定論の対象（hashRecord）。
 * ループ・ヘッドレスがティックごとに onTick を呼ぶ。サンプルはゲーム内 5 分ごと。
 */
import { bacPct } from '../climber/physiology';
import { partyLeader } from '../climber/party';
import { findChoicePoint } from '../scenario/choices';
import { resolveEnding } from '../scenario/endings';
import type { VarValue } from '../scenario/vars';
import type { RunRecord, SimEvent, SimEventType, StaticContext, World } from '../types';

export const SAMPLE_EVERY_MIN = 5;
export const TRACK_STEP_M = 20;
export const TRACK_MAX = 5000;

/** 記録に残す重要イベント */
const KEEP: ReadonlySet<SimEventType> = new Set([
  'RAIN_START', 'SUNSET', 'SUNRISE', 'DARK', 'OFFROUTE', 'LOST_AWARE', 'BACK_ON_ROUTE', 'FALL', 'INJURY', 'STAGE_CHANGE',
  'RESCUE_CALLED', 'RESCUE_CALL_FAILED', 'RESCUED', 'DEATH', 'CARDIAC_ARREST', 'SHELTER_ENTER', 'BIVOUAC_START', 'FINISHED',
  'LIGHTNING_STRIKE', 'GEAR', 'PRECIP_TYPE', 'CHOICE_FIRED', 'CHOICE_RESOLVED', 'SCRIPT_LOG', 'FORECAST_UPDATE', 'ENDED',
  'LEADER_CHANGED', 'PARTY_SPLIT', 'SOAK', 'PHONE_DEAD', 'LAMP_DEAD', 'NODE_ARRIVE', 'SPEECH',
]);

/** 記録の途中経過（集計用。JSON 互換） */
export interface RecorderState {
  record: RunRecord;
  lastSampleMin: number;
  firstRainMin: number | null;
  rainwearOnMin: number | null;
  lostSinceMin: number | null;
  lastTrack: [number, number] | null;
}

export function createRecorder(world: World): RecorderState {
  const leader = partyLeader(world);
  return {
    record: {
      scenarioId: world.scenarioId,
      seed: world.seed,
      samples: [],
      decisions: [],
      events: [],
      track: [[leader.x, leader.z]],
      stats: {
        minCoreC: 37,
        maxAnxiety: 0,
        fallCount: 0,
        rainwearDelayMin: 0,
        wasLost: false,
        lostMinutes: 0,
        darkMinutesMoving: 0,
        rescueCalledAt: null,
        distanceM: 0,
      },
      ending: null,
    },
    lastSampleMin: -Infinity,
    firstRainMin: null,
    rainwearOnMin: leader.body.rainwearOn ? world.tMin : null,
    lostSinceMin: null,
    lastTrack: [leader.x, leader.z],
  };
}

/** 1 ティック分を記録する（events はそのティックに出たイベント） */
export function recordTick(rs: RecorderState, world: World, ctx: StaticContext, events: readonly SimEvent[], dtMin: number): void {
  const r = rs.record;
  const st = r.stats;
  const leader = partyLeader(world);
  for (const c of world.climbers) {
    if (!c.body.alive) continue;
    st.minCoreC = Math.min(st.minCoreC, c.body.coreC);
    st.maxAnxiety = Math.max(st.maxAnxiety, c.body.anxiety);
  }
  for (const e of events) {
    if (KEEP.has(e.type)) r.events.push({ ...e, data: e.data ? { ...e.data } : undefined });
    if (e.type === 'FALL' && e.data?.['injury'] !== 'none') st.fallCount += 1;
    if (e.type === 'RAIN_START' && rs.firstRainMin === null) rs.firstRainMin = e.tMin;
    if (e.type === 'GEAR' && e.climberId === leader.id && e.data?.['rainwearOn'] === true && rs.rainwearOnMin === null) rs.rainwearOnMin = e.tMin;
    if (e.type === 'OFFROUTE') st.wasLost = true;
    if (e.type === 'RESCUE_CALLED' && st.rescueCalledAt === null) st.rescueCalledAt = e.tMin;
    if (e.type === 'CHOICE_RESOLVED') {
      const cpId = String(e.data?.['cp'] ?? '');
      const optionId = String(e.data?.['option'] ?? '');
      const cp = findChoicePoint(ctx, cpId)?.cp;
      const opt = cp?.options.find((o) => o.id === optionId);
      const d = world.decisions.find((x) => x.cpId === cpId && x.optionId === optionId && x.tMin === e.tMin);
      r.decisions.push({ cpId, title: cp?.title ?? cpId, tMin: e.tMin, optionId, label: opt?.label ?? optionId, by: d?.by ?? 'policy', tags: [...(opt?.tags ?? [])] });
    }
  }
  // 道迷いの時間・暗い中を歩いた時間
  const offroute = ['OFFROUTE_UNAWARE', 'LOST_AWARE', 'BACKTRACKING', 'NAVIGATING_TO_TRAIL', 'DESCENDING_DRAINAGE'].includes(leader.state);
  if (offroute) st.lostMinutes += dtMin;
  if (world.sun.isDark && leader.speedMs > 0) st.darkMinutesMoving += dtMin;
  // 軌跡（20 m ごと）
  const lt = rs.lastTrack!;
  const d = Math.sqrt((leader.x - lt[0]) * (leader.x - lt[0]) + (leader.z - lt[1]) * (leader.z - lt[1]));
  if (d >= TRACK_STEP_M) {
    st.distanceM += d;
    r.track.push([leader.x, leader.z]);
    rs.lastTrack = [leader.x, leader.z];
    if (r.track.length > TRACK_MAX) r.track = r.track.filter((_, i) => i % 2 === 0);
  }
  // 5 分ごとのサンプル
  if (world.tMin - rs.lastSampleMin >= SAMPLE_EVERY_MIN - 1e-9 || world.ended) {
    rs.lastSampleMin = world.tMin;
    const l = leader.local;
    r.samples.push({
      t: world.tMin,
      climbers: world.climbers.map((c) => ({
        id: c.id,
        x: c.x,
        z: c.z,
        elevM: c.elevM,
        coreC: c.body.coreC,
        glycogenKcal: c.body.glycogenKcal,
        waterDeficitL: c.body.waterDeficitL,
        fatigue: c.body.fatigue,
        wetness: c.body.wetness,
        anxiety: c.body.anxiety,
        J: c.J,
        M: c.M,
        state: c.state,
        // 血中アルコール濃度（%）。飲んでいるときだけ
        ...(c.body.alcoholG ? { bac: bacPct(c) } : {}),
      })),
      local: { tempC: l.tempC, windMs: l.windMs, precipMmH: l.precipMmH, precipType: l.precipType, visibilityM: l.visibilityM, thunder: l.thunder, windChillC: l.windChillC },
    });
  }
  if (world.ended && !r.ending) finishRecord(rs, world, ctx);
}

/** 終了時: 雨具の遅れ・結末を確定する */
export function finishRecord(rs: RecorderState, world: World, ctx: StaticContext): void {
  const st = rs.record.stats;
  if (rs.firstRainMin !== null) {
    const on = rs.rainwearOnMin ?? world.tMin;
    st.rainwearDelayMin = Math.max(0, on - rs.firstRainMin);
  }
  const e = resolveEnding(world, ctx, recVars(rs, world));
  if (e) rs.record.ending = { kind: e.kind, title: e.title ?? '', text: e.text ?? '', perClimber: e.perClimber.map((p) => ({ id: p.id, state: p.state, cause: p.cause })) };
}

/** 条件 DSL の rec.* に渡す値（docs/09 §10） */
export function recVars(rs: RecorderState, world: World): Record<string, VarValue | null> {
  const st = rs.record.stats;
  const leader = partyLeader(world);
  const rainDelay = rs.firstRainMin !== null ? Math.max(0, (rs.rainwearOnMin ?? world.tMin) - rs.firstRainMin) : 0;
  return {
    deathCount: world.climbers.filter((c) => !c.body.alive).length,
    minCoreC: st.minCoreC,
    maxAnxiety: st.maxAnxiety,
    fallCount: st.fallCount,
    rainwearDelayMin: rainDelay,
    wasLost: st.wasLost,
    lostMinutes: st.lostMinutes,
    darkMinutesMoving: st.darkMinutesMoving,
    rescueCalledAt: st.rescueCalledAt,
    finalState: leader.state,
    endingKind: world.ended?.kind ?? null,
  };
}

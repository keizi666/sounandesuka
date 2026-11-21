/**
 * 「みんなの遭難記録」に載せる記録を作る・読む（docs/20_community.md §3.3）。
 * 記録（RunRecord）は大きいので、振り返りのグラフと地図に要るものだけを残し、数値を丸めてから gzip + base64 にする。
 */
import type { RunRecord, ScenarioDef } from '../sim/types';
import type { RunSummaryInput } from './communityTypes';

/** 振り返りの印に使う出来事（これ以外は送らない） */
const KEEP_EVENTS = new Set(['FALL', 'DEATH', 'RESCUED', 'LOST_AWARE', 'LIGHTNING_STRIKE', 'CARDIAC_ARREST', 'RESCUE_CALLED', 'SHELTER_ENTER', 'BIVOUAC_START', 'FINISHED']);

const r0 = (v: number): number => Math.round(v);
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** 載せる形の記録（RunRecord と同じ形。中身を減らしただけ） */
export function slimRecord(rec: RunRecord): RunRecord {
  return {
    scenarioId: rec.scenarioId,
    seed: rec.seed,
    samples: rec.samples.map((s) => ({
      t: r1(s.t),
      climbers: s.climbers.map((c) => ({
        id: c.id, x: r0(c.x), z: r0(c.z), elevM: r0(c.elevM), coreC: r2(c.coreC), glycogenKcal: r0(c.glycogenKcal),
        waterDeficitL: r2(c.waterDeficitL), fatigue: r1(c.fatigue), wetness: r2(c.wetness), anxiety: r1(c.anxiety), J: r2(c.J), M: r2(c.M), state: c.state,
        ...(c.bac ? { bac: Math.round(c.bac * 1000) / 1000 } : {}),
      })),
      local: {
        tempC: r1(s.local.tempC), windMs: r1(s.local.windMs), precipMmH: r1(s.local.precipMmH), precipType: s.local.precipType,
        visibilityM: r0(s.local.visibilityM), thunder: s.local.thunder, windChillC: r1(s.local.windChillC),
      },
    })),
    decisions: rec.decisions.map((d) => ({ ...d, tMin: r1(d.tMin) })),
    events: rec.events.filter((e) => KEEP_EVENTS.has(e.type)).map((e) => ({ tMin: r1(e.tMin), type: e.type, ...(e.climberId ? { climberId: e.climberId } : {}), ...(e.text ? { text: e.text } : {}) })),
    track: rec.track.map(([x, z]) => [r0(x), r0(z)]),
    stats: rec.stats,
    ending: rec.ending,
  };
}

async function gzipBase64(text: string): Promise<string> {
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 記録を載せる形の文字列にする */
export function packRecord(rec: RunRecord): Promise<string> {
  return gzipBase64(JSON.stringify(slimRecord(rec)));
}

/** 載せた記録を読む。形がおかしければ例外 */
export async function unpackRecord(b64: string): Promise<RunRecord> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const r = JSON.parse(text) as RunRecord;
  if (!Array.isArray(r.samples) || !Array.isArray(r.track) || !Array.isArray(r.decisions) || !Array.isArray(r.events)) throw new Error('record');
  return r;
}

/** 一覧に出す要約 */
export function runSummary(o: {
  scenario: ScenarioDef;
  rec: RunRecord;
  ending: { kind: string; title: string };
  startMin: number;
  endMin: number;
  deaths: number;
  conditions: boolean;
  appVersion: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  label: (cpId: string, optionId: string) => string;
  title: (cpId: string, fallback: string) => string;
}): RunSummaryInput {
  return {
    scenarioId: o.scenario.id,
    scenarioTitle: o.scenario.title,
    ending: o.ending.kind,
    endingTitle: o.ending.title,
    durationMin: r1(Math.max(0, o.endMin - o.startMin)),
    distanceM: r0(o.rec.stats.distanceM),
    minCoreC: r2(o.rec.stats.minCoreC),
    partySize: o.scenario.party.length,
    deaths: o.deaths,
    decisions: o.rec.decisions
      .filter((d) => d.by === 'user' || d.by === 'bias')
      .slice(0, 40)
      .map((d) => ({ tMin: r1(d.tMin), title: o.title(d.cpId, d.title).slice(0, 80), label: o.label(d.cpId, d.optionId).slice(0, 80), auto: d.by !== 'user' })),
    conditions: o.conditions,
    appVersion: o.appVersion.slice(0, 40),
    ...(o.difficulty ? { difficulty: o.difficulty } : {}),
  };
}

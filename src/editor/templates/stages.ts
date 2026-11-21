/**
 * 箱庭岳のステージ（コース）と、季節に合わせた開始日。新規作成のダイアログと「人と計画」のタブで使う。
 * ルートは public/maps/sounan.json の地点 ID（tests/editorTemplates.test.ts で道がつながっていることを確かめる）。
 */
import { formatTimeRef, parseTimeRef } from '../../sim/core/clock';
import type { MapDef, ScenarioDef } from '../../sim/types';
import { hhmm, sunTimes } from '../geo/sunrise';

type Season = ScenarioDef['season'];

/** 架空の箱庭岳のマップ ID */
export const HAKONIWA_MAP_IDS = ['sounan', 'hakoniwa'];

export interface HakoniwaStage {
  id: string;
  label: string;
  hint: string;
  route: string[];
  goalNodes: string[];
}

export const HAKONIWA_STAGES: HakoniwaStage[] = [
  { id: 'traverse', label: '縦走: 沢入口 → 山頂 → 北登山口', hint: '烏帽子尾根を登り、稜線小屋・山頂・北の鞍部・見返り峰を経て北登山口へ（作例「稜線の冷たい雨」と同じ）', route: ['TH_SAWA', 'J_FOREST', 'EBOSHI', 'HUT_RIDGE', 'SUMMIT', 'SADDLE_N', 'MIKAERI', 'TH_KITA'], goalNodes: ['TH_KITA', 'TH_SAWA'] },
  { id: 'loopWest', label: '周回: 沢入口 → 山頂 → 西尾根 → 沢入口', hint: '山頂から北の鞍部へ下り、目印の少ない西尾根で沢入口へ戻る（作例「霧の下山路」と同じ）', route: ['TH_SAWA', 'J_FOREST', 'EBOSHI', 'HUT_RIDGE', 'SUMMIT', 'SADDLE_N', 'W_SHOULDER', 'J_FOREST', 'TH_SAWA'], goalNodes: ['TH_SAWA', 'TH_KITA'] },
  { id: 'reverse', label: '縦走（逆回り）: 北登山口 → 山頂 → 沢入口', hint: '北尾根を登り、クサリ場を越えて山頂、烏帽子尾根を下る', route: ['TH_KITA', 'MIKAERI', 'SADDLE_N', 'SUMMIT', 'HUT_RIDGE', 'EBOSHI', 'J_FOREST', 'TH_SAWA'], goalNodes: ['TH_SAWA', 'TH_KITA'] },
  { id: 'summitBack', label: '往復: 沢入口 → 山頂', hint: '烏帽子尾根を山頂まで登り、同じ道を戻る', route: ['TH_SAWA', 'J_FOREST', 'EBOSHI', 'HUT_RIDGE', 'SUMMIT', 'HUT_RIDGE', 'EBOSHI', 'J_FOREST', 'TH_SAWA'], goalNodes: ['TH_SAWA', 'TH_KITA'] },
  { id: 'eboshi', label: '往復: 沢入口 → 烏帽子ノ頭（短め）', hint: '稜線には出ず、烏帽子ノ頭で引き返す', route: ['TH_SAWA', 'J_FOREST', 'EBOSHI', 'J_FOREST', 'TH_SAWA'], goalNodes: ['TH_SAWA'] },
  { id: 'northBack', label: '往復: 北登山口 → 山頂', hint: '北尾根から見返り峰・北の鞍部・クサリ場を経て山頂、同じ道を戻る', route: ['TH_KITA', 'MIKAERI', 'SADDLE_N', 'SUMMIT', 'SADDLE_N', 'MIKAERI', 'TH_KITA'], goalNodes: ['TH_KITA', 'TH_SAWA'] },
];

export function isHakoniwa(map: Pick<MapDef, 'id'>): boolean {
  return HAKONIWA_MAP_IDS.includes(map.id);
}

/** ルートのコースタイムの合計（分）。地図の道の courseTimeMin（[from→to, to→from]）を足す。道がなければ null */
export function routeCourseMin(map: Pick<MapDef, 'edges'>, route: readonly string[]): number | null {
  let sum = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const e = map.edges.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    if (!e) return null;
    const ct = e.courseTimeMin;
    sum += ct ? (e.from === a ? ct[0] : ct[1]) : 60;
  }
  return sum;
}

/** ステージを計画に入れる。予定下山はコースタイム ×1.15（休憩）を 30 分単位で切り上げ、家族の通報はその 5 時間半後 */
export function applyStage(s: ScenarioDef, map: Pick<MapDef, 'edges'>, st: HakoniwaStage): void {
  const ct = routeCourseMin(map, st.route) ?? 360;
  const finish = Math.ceil((parseTimeRef(s.startAt) + ct * 1.15) / 30) * 30;
  s.plan = { ...s.plan, route: [...st.route], goalNodes: [...st.goalNodes], plannedFinish: formatTimeRef(finish), reportIfNotBackBy: formatTimeRef(finish + 330) };
}

export const SEASON_OPTIONS: [Season, string][] = [['autumn', '秋（10 月）'], ['summer', '夏（8 月）'], ['spring', '春（5 月）'], ['winter', '冬（1 月）']];

/** 季節ごとの開始日と出発時刻（日帰りの目安） */
const SEASON_START: Record<Season, { date: string; startAt: string }> = {
  spring: { date: '2026-05-16', startAt: 'D0 06:00' },
  summer: { date: '2026-08-08', startAt: 'D0 05:00' },
  autumn: { date: '2026-10-17', startAt: 'D0 06:00' },
  winter: { date: '2027-01-16', startAt: 'D0 07:00' },
};

/** 季節を変え、開始日・出発時刻・日の出入りを合わせる（緯度経度がなければ本州の中ほど） */
export function applySeason(s: ScenarioDef, season: Season, lat = 36, lon = 138): void {
  const st = SEASON_START[season];
  const t = sunTimes(st.date, lat, lon);
  s.season = season;
  s.startDate = st.date;
  s.startAt = st.startAt;
  s.sun = { ...s.sun, sunrise: hhmm(t.sunriseMin), sunset: hhmm(t.sunsetMin) };
}

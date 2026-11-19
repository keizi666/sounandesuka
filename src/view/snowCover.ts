/**
 * 季節の積雪の見た目（ユーザーの指定: 雪山は雪山として描く）。
 * シナリオに snowpack（始まりの積雪）があればその標高、なければ月と緯度からのおよその雪線（本州中部の山の目安）。
 * シミュレーションの積雪（降った雪）が低ければ、そちらを使う（weatherFx）。
 */
import type { ScenarioDef } from '../sim/types';

/** 月ごとの、山の斜面が雪で白くなるおよその標高（m、北緯 36° の目安）。夏は雪なし */
const LINE_BY_MONTH: Record<number, number> = {
  1: 1300, 2: 1200, 3: 1400, 4: 1900, 5: 2300, 6: 2800,
  7: Infinity, 8: Infinity, 9: Infinity, 10: Infinity,
  11: 2300, 12: 1700,
};

/** 緯度 1° 北で雪線が下がる量（m） */
const PER_DEG_LAT = 120;

export function baseSnowLineM(scenario: ScenarioDef, latDeg = 36): number {
  if (scenario.snowpack) return scenario.snowpack.depthCm > 0 ? scenario.snowpack.lineM : Infinity;
  const month = Number(scenario.startDate.slice(5, 7));
  const line = LINE_BY_MONTH[month] ?? Infinity;
  return Number.isFinite(line) ? line - (latDeg - 36) * PER_DEG_LAT : Infinity;
}

/** 雪に埋もれる草・低い木（雪線より上）。深さは雪線から 300 m で目いっぱい */
export function buriedFraction(elevM: number, lineM: number): number {
  if (!Number.isFinite(lineM) || elevM <= lineM) return 0;
  return Math.min(1, (elevM - lineM) / 300);
}

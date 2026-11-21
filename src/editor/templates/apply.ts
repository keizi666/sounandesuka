/**
 * テンプレートをシナリオに当てる（新規作成のダイアログと各タブで共通）。
 */
import { parseHHMM } from '../../sim/core/clock';
import type { EditorProject, ScenarioDef } from '../../sim/types';
import type { PortraitGroup } from '../../ui/avatar';
import { draftForecast } from '../weather/forecast';
import { generateParty, type PartyOpts } from './party';
import { applySeason, applyStage, HAKONIWA_STAGES, isHakoniwa } from './stages';
import { weatherFromTemplate, type WeatherTemplateId } from './weather';

/** 天候テンプレートを当てる（キーフレームと雷雲セルを置き換える）。forecast なら予報も下書きし直す */
export function applyWeatherTemplate(s: ScenarioDef, mapSizeM: number, id: WeatherTemplateId, strength: number, forecast: boolean): void {
  const w = structuredClone(s.weather);
  const g = weatherFromTemplate(id, { season: s.season, refElevM: w.refElevM, lapseRateCPer100m: w.lapseRateCPer100m, sunriseMin: parseHHMM(s.sun.sunrise), s: strength, mapSizeM });
  w.keyframes = g.keyframes;
  w.thunderCells = g.cells.length ? g.cells : undefined;
  if (!w.thunderCells) delete w.thunderCells;
  s.weather = w;
  if (forecast) s.briefing = { ...s.briefing, forecast: draftForecast(s) };
}

export interface NewProjectTemplates {
  season: ScenarioDef['season'];
  /** 箱庭岳のステージ ID（箱庭岳のときだけ） */
  stage?: string;
  /** 天候テンプレート（'' なら晴れの 1 点のまま） */
  weather: WeatherTemplateId | '';
  party: PartyOpts | null;
}

/** 新規プロジェクトにテンプレートを当てる */
export function applyNewProjectTemplates(p: EditorProject, t: NewProjectTemplates, counts: Partial<Record<PortraitGroup, number>> | null, rnd: () => number = Math.random): void {
  const s = p.scenario;
  s.title = p.name;
  applySeason(s, t.season, p.map.geo?.centerLat, p.map.geo?.centerLon);
  const st = HAKONIWA_STAGES.find((x) => x.id === t.stage);
  if (st && isHakoniwa(p.map)) applyStage(s, p.map, st);
  // 天候の 1 点目は開始時刻に合わせる（テンプレートなしのとき）
  if (t.weather) applyWeatherTemplate(s, p.map.size, t.weather, 1, true);
  else s.weather = { ...s.weather, keyframes: s.weather.keyframes.map((k, i) => (i === 0 ? { ...k, at: s.startAt } : k)) };
  if (t.party) s.party = generateParty({ ...t.party, season: t.season }, counts, rnd);
}

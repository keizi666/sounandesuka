/**
 * 地理院地図（最適化ベクトルタイル z16）からの取り込み（環境タブ・登山道と地点のタブで共通）:
 * 森の種類（植生記号）、市街地（建物・道路・鉄道）、地図記号の施設と送電線（鉄塔は送電線の尾根に置く）。
 * どれも同じタイルを使い、一度取ったタイルは取り直さない。結果は 1 つの Undo の単位で入れる。
 */
import { nextPaint, showLoading } from '../ui/loading';
import type { Ed } from './context';
import { fetchVectorTiles, forestSymbols, mergeForestOverrides } from './geo/gsiVector';
import { landmarksFromTiles, withTowers } from './geo/landmarks';
import { mergeUrbanOverrides, urbanCells, urbanFromTiles } from './geo/urban';
import { sampleElevAt } from './panels/elev';

const fmt = (n: number): string => n.toLocaleString('ja-JP');

export interface GsiWhat {
  forest: boolean;
  urban: boolean;
  landmarks: boolean;
}

/** 取り込んで入れる。返り値は結果の説明（失敗したときは理由） */
export async function importGsi(ed: Ed, what: GsiWhat): Promise<string> {
  const g = ed.p.map.geo;
  const rt = ed.runtime();
  if (!g || !rt) return '先にタブ 1 で標高を取得してください';
  if (what.landmarks && (ed.p.map.landmarks?.length ?? 0) > 0 && !confirm('いまの施設・鉄塔・送電線を、地図記号から取り込み直したものに置き換えます（動かしたり足したりした分も置き換わります）。よろしいですか？（Ctrl＋Z で戻せます）')) return '';
  const ld = showLoading('地理院地図から取り込んでいます');
  try {
    ld.step('地理院地図のタイルを取得しています…', 0);
    const tiles = await fetchVectorTiles(g.centerLat, g.centerLon, ed.p.map.size, (d, t) => ld.step(`地理院地図のタイルを取得しています…（${d} / ${t} 枚）`, (d / t) * 0.8));
    const notes: string[] = [];
    const vg = ed.p.map.vegetation;
    let overrides = vg.overrides;
    let urban = ed.p.map.urban;
    let landmarks = ed.p.map.landmarks;
    let powerLines = ed.p.map.powerLines;
    if (what.urban) {
      ld.step('建物・道路・鉄道を読み、市街地のセルを塗っています…', 0.84);
      await nextPaint();
      urban = urbanFromTiles(tiles, g.centerLat, g.centerLon, ed.p.map.size);
      const m = mergeUrbanOverrides(rt.n, overrides, urbanCells(rt, urban));
      overrides = m.overrides;
      notes.push(`建物 ${fmt(urban.buildings.length)} 棟・道路 ${urban.lines.filter((l) => l.kind === 'road').length} 本・鉄道 ${urban.lines.filter((l) => l.kind === 'rail').length} 本を取り込み、${fmt(m.count)} セルを市街地にしました`);
    }
    if (what.forest) {
      ld.step('植生記号から森の種類を塗っています…', 0.9);
      await nextPaint();
      const symbols = forestSymbols(tiles);
      const f = mergeForestOverrides(rt, g.centerLat, g.centerLon, overrides, symbols);
      overrides = f.overrides;
      notes.push(symbols.length ? `植生記号 ${fmt(symbols.length)} 個から、広葉樹林 ${fmt(f.counts['broadleaf'] ?? 0)} セル・針葉樹林 ${fmt(f.counts['conifer'] ?? 0)} セルを塗りました` : 'この範囲の地形図には森の種類の記号がありませんでした（自動のまま）');
    }
    if (what.landmarks) {
      ld.step('地図記号の施設と送電線を読み、鉄塔を尾根に置いています…', 0.95);
      await nextPaint();
      const r = landmarksFromTiles(tiles, g.centerLat, g.centerLon, ed.p.map.size);
      landmarks = withTowers(rt, r.landmarks, r.powerLines, (x, z) => sampleElevAt(rt, x, z));
      powerLines = r.powerLines;
      const towers = landmarks.filter((l) => l.kind === 'tower').length;
      notes.push(`施設 ${landmarks.length - towers} か所・送電線 ${powerLines.length} 本（鉄塔 ${towers} 基）を置きました`);
    }
    ed.change('地理院地図から取り込む', () => {
      if (what.urban && urban) ed.p.map.urban = urban;
      if (overrides) vg.overrides = overrides;
      if (what.landmarks) {
        ed.p.map.landmarks = landmarks;
        ed.p.map.powerLines = powerLines;
      }
      // 出典を出すための記録
      ed.p.raw.gsiVector = { fetchedAt: new Date().toISOString() };
    }, true);
    ld.step('取り込みました', 1);
    await nextPaint();
    return `${notes.join('。')}。`;
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  } finally {
    ld.done();
  }
}

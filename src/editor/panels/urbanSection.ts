/**
 * 環境タブの「地理院地図から取り込む」: 地形図の植生記号から森の種類（広葉樹林・針葉樹林）を塗り分ける、
 * 建物・道路・鉄道を取り込んで植生の「市街地」を塗る（3D では建物と道路を描き、市街地には木を置かない）。
 * どちらも同じタイル（地理院の最適化ベクトルタイル z16）を使い、一度取ったタイルは取り直さない。
 */
import { el } from '../../ui/dom';
import { nextPaint, showLoading } from '../../ui/loading';
import type { Ed } from '../context';
import { button, section } from '../forms/fields';
import { fetchVectorTiles, forestSymbols, mergeForestOverrides } from '../geo/gsiVector';
import { clearUrbanOverrides, mergeUrbanOverrides, urbanCells, urbanFromTiles } from '../geo/urban';
import { VegClass } from '../../sim/types';
import { decodeGrid, encodeGrid } from '../../sim/terrain/codec';

let msg = '';
const fmt = (n: number): string => n.toLocaleString('ja-JP');

export function urbanSection(ed: Ed): HTMLElement | null {
  const g = ed.p.map.geo;
  if (!g) return null;
  const u = ed.p.map.urban;
  const roads = u?.lines.filter((l) => l.kind === 'road').length ?? 0;
  const rails = u?.lines.filter((l) => l.kind === 'rail').length ?? 0;
  const run = async (what: { forest: boolean; urban: boolean }): Promise<void> => {
    const rt = ed.runtime();
    if (!rt) return ed.toast('先にタブ 1 で標高を取得してください');
    const ld = showLoading('地理院地図から取り込んでいます');
    try {
      ld.step('地理院地図のタイルを取得しています…', 0);
      const tiles = await fetchVectorTiles(g.centerLat, g.centerLon, ed.p.map.size, (d, t) => ld.step(`地理院地図のタイルを取得しています…（${d} / ${t} 枚）`, (d / t) * 0.8));
      const notes: string[] = [];
      const vg = ed.p.map.vegetation;
      let overrides = vg.overrides;
      let urban = ed.p.map.urban;
      if (what.urban) {
        ld.step('建物・道路・鉄道を読み、市街地のセルを塗っています…', 0.85);
        await nextPaint();
        urban = urbanFromTiles(tiles, g.centerLat, g.centerLon, ed.p.map.size);
        const m = mergeUrbanOverrides(rt.n, overrides, urbanCells(rt, urban));
        overrides = m.overrides;
        notes.push(`建物 ${fmt(urban.buildings.length)} 棟・道路 ${urban.lines.filter((l) => l.kind === 'road').length} 本・鉄道 ${urban.lines.filter((l) => l.kind === 'rail').length} 本を取り込み、${fmt(m.count)} セルを市街地に`);
      }
      if (what.forest) {
        ld.step('植生記号から森の種類を塗っています…', 0.92);
        await nextPaint();
        const symbols = forestSymbols(tiles);
        const f = mergeForestOverrides(rt, g.centerLat, g.centerLon, overrides, symbols);
        overrides = f.overrides;
        notes.push(symbols.length ? `植生記号 ${fmt(symbols.length)} 個から、広葉樹林 ${fmt(f.counts['broadleaf'] ?? 0)} セル・針葉樹林 ${fmt(f.counts['conifer'] ?? 0)} セルを塗りました` : 'この範囲の地形図には森の種類の記号がありませんでした（自動のまま）');
      }
      ed.change(what.forest && what.urban ? '地理院地図から取り込む' : what.forest ? '森の種類を塗る' : '市街地の取り込み', () => {
        if (urban) ed.p.map.urban = urban;
        if (overrides) vg.overrides = overrides;
        // 出典を出すための記録（森の種類だけを塗ったときも）
        ed.p.raw.gsiVector = { fetchedAt: new Date().toISOString() };
      }, true);
      msg = `${notes.join('。')}。`;
      ld.step('取り込みました', 1);
      await nextPaint();
    } catch (e) {
      msg = String(e instanceof Error ? e.message : e);
    } finally {
      ld.done();
      ed.refresh();
    }
  };
  /** 森の種類の塗りだけを消す（市街地・作者の塗りは残す） */
  const clearForest = (): void =>
    ed.change('森の種類の塗りを消す', () => {
      const vg = ed.p.map.vegetation;
      if (!vg.overrides) return;
      const n = ed.p.map.resolution;
      const grid = decodeGrid(vg.overrides, n * n);
      for (let i = 0; i < n * n; i += 1) if (grid[i] === VegClass.BROADLEAF + 1 || grid[i] === VegClass.CONIFER + 1) grid[i] = 0;
      vg.overrides = encodeGrid(grid);
    }, true);
  return section('地理院地図から取り込む（森の種類・建物・道路）', [
    el('p', { class: 'note' }, '地形図の植生記号（広葉樹林・針葉樹林）から森の種類を塗り分けます（記号から遠いセルと、塗り直した岩場・沢などはそのまま）。建物・道路・鉄道を取り込むと、建物の周りと道路のセルを「市街地」にし、3D で建物と道路を描きます（トンネル・徒歩道は除く）。'),
    u ? el('p', {}, `取り込み済みの市街地: 建物 ${fmt(u.buildings.length)} 棟・道路 ${roads} 本・鉄道 ${rails} 本（${u.source.fetchedAt.slice(0, 10)}）`) : null,
    el('div', {}, [
      button('森の種類と建物・道路をまとめて取り込む', () => void run({ forest: true, urban: true }), 'primary'),
      button('森の種類だけ塗る', () => void run({ forest: true, urban: false })),
      button(u ? '建物・道路だけ取り込み直す' : '建物・道路だけ取り込む', () => void run({ forest: false, urban: true })),
    ]),
    el('div', {}, [
      ed.p.map.vegetation.overrides ? button('森の種類の塗りを消す', clearForest) : null,
      u
        ? button('市街地を消す', () => ed.change('市街地を消す', () => {
            delete ed.p.map.urban;
            const ov = clearUrbanOverrides(ed.p.map.resolution, ed.p.map.vegetation.overrides);
            if (ov) ed.p.map.vegetation.overrides = ov;
          }, true))
        : null,
    ]),
    msg ? el('p', { class: 'note' }, msg) : null,
    el('p', { class: 'note' }, '出典: 国土地理院（ベクトルタイル）。取り込むと書き出しの出典に自動で入ります。'),
  ]);
}

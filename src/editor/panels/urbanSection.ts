/**
 * 環境タブの「地理院地図から取り込む」: 地形図の植生記号から森の種類（広葉樹林・針葉樹林）を塗り分ける、
 * 建物・道路・鉄道を取り込んで植生の「市街地」を塗る（3D では建物と道路を描き、市街地には木を置かない）。
 * どちらも同じタイル（地理院の最適化ベクトルタイル z16）を使い、一度取ったタイルは取り直さない。
 */
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, section } from '../forms/fields';
import { clearUrbanOverrides } from '../geo/urban';
import { importGsi, type GsiWhat } from '../gsiImport';
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
  const run = async (what: GsiWhat): Promise<void> => {
    const r = await importGsi(ed, what);
    if (r) msg = r;
    ed.refresh();
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
  return section('地理院地図から取り込む（森の種類・建物・道路・地図記号）', [
    el('p', { class: 'note' }, '地形図の植生記号（広葉樹林・針葉樹林）から森の種類を塗り分けます（記号から遠いセルと、塗り直した岩場・沢などはそのまま）。建物・道路・鉄道を取り込むと、建物の周りと道路のセルを「市街地」にし、3D で建物と道路を描きます（トンネル・徒歩道は除く）。地図記号の寺・神社・駅・交番・学校・郵便局などと送電線を取り込み、送電線の鉄塔は線の上の尾根に置きます（タブ 3「地点」で動かせます）。'),
    u ? el('p', {}, `取り込み済みの市街地: 建物 ${fmt(u.buildings.length)} 棟・道路 ${roads} 本・鉄道 ${rails} 本（${u.source.fetchedAt.slice(0, 10)}）`) : null,
    el('div', {}, [
      button('森の種類・建物・道路・地図記号をまとめて取り込む', () => void run({ forest: true, urban: true, landmarks: true }), 'primary'),
      button('森の種類だけ塗る', () => void run({ forest: true, urban: false, landmarks: false })),
      button(u ? '建物・道路だけ取り込み直す' : '建物・道路だけ取り込む', () => void run({ forest: false, urban: true, landmarks: false })),
      button('地図記号（寺・駅・送電線など）だけ取り込む', () => void run({ forest: false, urban: false, landmarks: true })),
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

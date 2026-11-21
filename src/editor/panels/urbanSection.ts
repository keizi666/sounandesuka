/**
 * 環境タブの「市街地・道路（地理院地図）」: 建物・道路・鉄道を取り込み、植生の「市街地」を塗る。3D では建物と道路を描き、市街地のセルには木を置かない。
 */
import { el } from '../../ui/dom';
import { nextPaint, showLoading } from '../../ui/loading';
import type { Ed } from '../context';
import { button, section } from '../forms/fields';
import { clearUrbanOverrides, fetchUrban, mergeUrbanOverrides, urbanCells } from '../geo/urban';

let msg = '';

export function urbanSection(ed: Ed): HTMLElement | null {
  const g = ed.p.map.geo;
  if (!g) return null;
  const u = ed.p.map.urban;
  const roads = u?.lines.filter((l) => l.kind === 'road').length ?? 0;
  const rails = u?.lines.filter((l) => l.kind === 'rail').length ?? 0;
  const run = async (): Promise<void> => {
    const rt = ed.runtime();
    if (!rt) return ed.toast('先にタブ 1 で標高を取得してください');
    const ld = showLoading('地理院地図から市街地を取り込んでいます');
    try {
      ld.step('建物・道路・鉄道のタイルを取得しています…', 0);
      const urban = await fetchUrban(g.centerLat, g.centerLon, ed.p.map.size, (d, t) => ld.step(`建物・道路・鉄道のタイルを取得しています…（${d} / ${t} 枚）`, (d / t) * 0.85));
      ld.step(`市街地のセルを塗っています…（建物 ${urban.buildings.length.toLocaleString('ja-JP')} 棟・道路と鉄道 ${urban.lines.length.toLocaleString('ja-JP')} 本）`, 0.9);
      await nextPaint();
      const cells = urbanCells(rt, urban);
      const vg = ed.p.map.vegetation;
      const m = mergeUrbanOverrides(rt.n, vg.overrides, cells);
      ed.change('市街地の取り込み', () => {
        ed.p.map.urban = urban;
        vg.overrides = m.overrides;
      }, true);
      msg = `建物 ${urban.buildings.length.toLocaleString('ja-JP')} 棟・道路 ${urban.lines.filter((l) => l.kind === 'road').length} 本・鉄道 ${urban.lines.filter((l) => l.kind === 'rail').length} 本を取り込み、${m.count.toLocaleString('ja-JP')} セルを市街地にしました。`;
      ld.step('取り込みました', 1);
      await nextPaint();
    } catch (e) {
      msg = String(e instanceof Error ? e.message : e);
    } finally {
      ld.done();
      ed.refresh();
    }
  };
  return section('市街地・道路（地理院地図）', [
    el('p', { class: 'note' }, '地理院地図（ベクトルタイル）の建物・道路・鉄道を取り込み、建物の周りと道路のセルを「市街地」にします。3D では建物と道路を描き、市街地には木を置きません。トンネルと徒歩道（登山道）は除きます。'),
    u ? el('p', {}, `取り込み済み: 建物 ${u.buildings.length.toLocaleString('ja-JP')} 棟・道路 ${roads} 本・鉄道 ${rails} 本（${u.source.fetchedAt.slice(0, 10)}）`) : null,
    button(u ? '取り込み直す' : '建物・道路を取り込む', () => void run(), u ? '' : 'primary'),
    u
      ? button('市街地を消す', () => ed.change('市街地を消す', () => {
          delete ed.p.map.urban;
          const ov = clearUrbanOverrides(ed.p.map.resolution, ed.p.map.vegetation.overrides);
          if (ov) ed.p.map.vegetation.overrides = ov;
        }, true))
      : null,
    msg ? el('p', { class: 'note' }, msg) : null,
    el('p', { class: 'note' }, '出典: 国土地理院（ベクトルタイル）。取り込むと書き出しの出典に自動で入ります。'),
  ]);
}

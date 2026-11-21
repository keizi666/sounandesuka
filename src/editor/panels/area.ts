/**
 * タブ 1 エリア（docs/16 §3）: 範囲（中心の緯度経度・一辺）を置き、標高タイルから地形を作る。背景地図の切替、派生レイヤーの確認。
 */
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { baseElevationFor, suggestForestLine } from '../geo/dem';
import type { DemMessage, DemRequest } from '../geo/dem.worker';
import { gridFor } from '../geo/projection';
import { keepHintsOnRecenter } from '../geo/skeletonBind';
import type { BaseLayer } from '../geo/tiles';
import { areaRect, type OverlayKind } from '../map/layers';
import type { MapTool } from '../map/TileMapView';
import { button, check, num, section, select } from '../forms/fields';
import { hasTerrain, setHeights } from '../store/project';
import type { EditorApp } from '../EditorApp';
import type { Panel } from './types';

let smoothing = 1;
/** 直近の取得結果（再描画で消えないように） */
let lastMsg = '';
let overlay: OverlayKind = 'none';

/** 範囲の中心を変える（スケルトンの地点の位置の手がかりは同じ緯度経度に保つ） */
function recenter(ed: Ed, lat: number, lon: number): void {
  const g = ed.p.map.geo!;
  const old = { lat: g.centerLat, lon: g.centerLon };
  g.centerLat = lat;
  g.centerLon = lon;
  keepHintsOnRecenter(ed.p.map, old.lat, old.lon);
}

/** 範囲を動かす・角で大きさを変える道具（地形を取得する前だけ） */
function areaTool(ed: Ed): MapTool | null {
  if (!ed.p.map.geo) return null;
  let mode: null | 'move' | 'resize' = null;
  let start = { pLat: 0, pLon: 0, lat: 0, lon: 0 };
  return {
    cursor: 'move',
    down(p) {
      if (hasTerrain(ed.p)) return false;
      const r = areaRect(ed.view, ed.p.map.size);
      const nearCorner = Math.hypot(p.px - (r.x + r.w), p.py - (r.y + r.h)) < 14;
      const inside = p.px > r.x && p.px < r.x + r.w && p.py > r.y && p.py < r.y + r.h;
      if (!nearCorner && !inside) return false;
      mode = nearCorner ? 'resize' : 'move';
      ed.checkpoint('範囲');
      start = { pLat: p.lat, pLon: p.lon, lat: ed.p.map.geo!.centerLat, lon: ed.p.map.geo!.centerLon };
      return true;
    },
    move(p, dragging) {
      if (!dragging || !mode) return;
      const g = ed.p.map.geo!;
      if (mode === 'move') {
        g.centerLat = start.lat + (p.lat - start.pLat);
        g.centerLon = start.lon + (p.lon - start.pLon);
        ed.view.lat0 = g.centerLat;
        ed.view.lon0 = g.centerLon;
      } else {
        const half = Math.max(Math.abs(p.x), Math.abs(p.z));
        const gr = gridFor(Math.min(12288, Math.max(2048, half * 2)));
        ed.p.map.size = gr.size;
        ed.p.map.resolution = gr.resolution;
      }
      ed.view.redraw();
    },
    up() {
      if (mode === 'move') keepHintsOnRecenter(ed.p.map, start.lat, start.lon);
      if (mode) ed.touched(true);
      mode = null;
    },
  };
}

function fetchTerrain(ed: Ed, progress: HTMLProgressElement, msg: HTMLElement): void {
  const g = ed.p.map.geo!;
  const w = new Worker(new URL('../geo/dem.worker.ts', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  msg.textContent = '標高タイルを取得しています…';
  w.onmessage = (ev: MessageEvent<DemMessage>) => {
    const m = ev.data;
    if (m.type === 'progress') {
      progress.max = m.total;
      progress.value = m.done;
      return;
    }
    w.terminate();
    if (m.type === 'error') {
      lastMsg = m.message;
      msg.textContent = m.message;
      ed.toast(m.message, 8000);
      return;
    }
    let min = Infinity;
    for (const v of m.heights) min = Math.min(min, v);
    setHeights(ed.p, m.heights, { baseElevation: baseElevationFor(min), smoothing, fetchedAt: new Date().toISOString() });
    ed.p.map.vegetation.forestLine = suggestForestLine(g.centerLat);
    ed.p.map.vegetation.broadleafLine = ed.p.map.vegetation.forestLine - 900;
    (ed as EditorApp).mapReplaced();
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    lastMsg = `地形を作りました（${sec} 秒${m.fallback > 0 ? `、無効値 ${m.fallback} 点を最小標高で埋めた` : ''}${m.failedTiles > 0 ? `、タイルなし ${m.failedTiles} 枚` : ''}）。森林限界 ${ed.p.map.vegetation.forestLine} m を提案しました（タブ 4 で確認）。`;
    msg.textContent = lastMsg;
    ed.refresh();
    ed.toggle3d(true);
  };
  w.postMessage({ lat0: g.centerLat, lon0: g.centerLon, size: ed.p.map.size, n: ed.p.map.resolution, smoothing } satisfies DemRequest);
}

export const areaPanel: Panel = {
  id: 'area',
  label: 'エリア',
  tool: areaTool,
  render(ed) {
    const v = ed.view;
    const g = ed.p.map.geo;
    const progress = el('progress', { value: 0, max: 1 });
    const msg = el('p', { class: 'note dem-msg' }, lastMsg);
    const terrain = hasTerrain(ed.p);
    const bg = section('背景地図', [
      select<BaseLayer | 'none'>('背景', v.base, [['std', '標準地図'], ['pale', '淡色地図'], ['seamlessphoto', '写真'], ['none', 'なし']], (b) => {
        v.base = b;
        v.redraw();
      }),
      check('陰影を重ねる', v.hillshade, (h) => {
        v.hillshade = h;
        v.redraw();
      }),
      el('p', { class: 'note' }, '地図: 地理院タイル（国土地理院）'),
    ]);
    const derived = section('派生レイヤーの確認', [
      select<OverlayKind>('重ね表示', overlay, [['none', 'なし'], ['slope', '傾斜'], ['veg', '植生'], ['radio', '電波'], ['tpi', '風の露出（尾根・谷）'], ['sky', '空の見通し']], (k) => {
        overlay = k;
        ed.setOverlay(k);
      }),
      button('3D で確認', () => ed.toggle3d(true)),
    ]);
    if (!g) {
      ed.inspector.replaceChildren(
        el('h2', {}, 'エリア'),
        el('p', {}, `架空の山「${ed.p.map.name}」（手続き生成、一辺 ${(ed.p.map.size / 1000).toFixed(2)} km・${ed.p.map.resolution} 頂点）。範囲と地形は固定です。`),
        derived,
      );
      ed.bottom.replaceChildren();
      return;
    }
    const center = section('範囲', [
      el('p', { class: 'note' }, '地名検索はありません。緯度経度を入れるか、地図を動かして探してください。範囲の枠はドラッグで移動、右下の角で大きさを変えられます（標高の取得前のみ）。'),
      num('中心の緯度', g.centerLat, (x) => ed.change('中心', () => recenter(ed, x, g.centerLon), true), { step: 0.0001 }),
      num('中心の経度', g.centerLon, (x) => ed.change('中心', () => recenter(ed, g.centerLat, x), true), { step: 0.0001 }),
      num('一辺', Math.round(ed.p.map.size), (s) => ed.change('大きさ', () => {
        const gr = gridFor(s);
        ed.p.map.size = gr.size;
        ed.p.map.resolution = gr.resolution;
      }, true), { min: 2048, max: 12288, step: 128, unit: 'm' }),
      el('p', {}, `解像度 ${ed.p.map.resolution} 頂点・セル ${(ed.p.map.size / (ed.p.map.resolution - 1)).toFixed(0)} m`),
      button('範囲を地図の中心に置く', () => {
        if (terrain && !confirm('取得済みの地形は消えます。範囲を置き直しますか？')) return;
        ed.change('範囲を置く', () => {
          recenter(ed, v.lat, v.lon);
          if (terrain) {
            ed.p.heightsBuffer = null;
          }
        }, true);
        v.lat0 = g.centerLat;
        v.lon0 = g.centerLon;
      }),
      button('範囲を画面に合わせる', () => v.fitArea(ed.p.map.size)),
    ]);
    const dem = section('地形を作る', [
      select<number>('平滑化', smoothing, [[0, 'なし'], [1, '1 回（既定）'], [2, '2 回'], [3, '3 回']], (s) => (smoothing = s), 'DEM10B の段差ノイズを 3×3 ガウシアンでならす'),
      button(terrain ? '標高を取り直す' : '標高を取得する（地理院 標高タイル）', () => {
        v.lat0 = g.centerLat;
        v.lon0 = g.centerLon;
        fetchTerrain(ed, progress, msg);
      }, 'primary'),
      progress,
      msg,
      terrain && ed.p.map.terrain.type === 'heightmap'
        ? el('p', { class: 'note' }, `標高 ${Math.round(ed.p.map.terrain.minElevM)}〜${Math.round(ed.p.map.terrain.maxElevM)} m、台座 ${ed.p.map.terrain.baseElevation} m`)
        : null,
    ]);
    v.lat0 = g.centerLat;
    v.lon0 = g.centerLon;
    ed.inspector.replaceChildren(el('h2', {}, 'エリア'), center, dem, bg, derived);
    ed.bottom.replaceChildren();
  },
};

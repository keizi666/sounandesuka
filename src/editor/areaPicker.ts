/**
 * 新しいプロジェクトの範囲を、日本地図（地理院タイル）から選ぶ（docs/16 §2）。
 * 日本全体から始め、ホイールで近づき、地図を押すとそこが範囲の中心になる。四角の中をつまむと範囲を動かせる。
 * 有名な山へのひとっ飛び（緯度・経度は概略）と、地名・山名の検索（Overpass API。geo/placeSearch.ts）。緯度・経度・一辺の入力と相互に同期する。
 */
import { el } from '../ui/dom';
import { searchPlaces, type PlaceHit } from './geo/placeSearch';
import { toLatLon } from './geo/projection';
import { TileMapView, type MapLayer, type MapPointer } from './map/TileMapView';

export interface AreaPicker {
  el: HTMLElement;
  /** 入力欄が変わったとき（地図の四角を合わせる） */
  sync(): void;
  dispose(): void;
}

/** ひとっ飛びの候補（中心の緯度・経度は概略。一辺 m） */
export const AREA_PRESETS: { name: string; lat: number; lon: number; size: number }[] = [
  { name: '大雪山 トムラウシ山', lat: 43.526, lon: 142.846, size: 12288 },
  { name: '谷川岳', lat: 36.837, lon: 138.93, size: 6144 },
  { name: '北アルプス 白馬岳', lat: 36.759, lon: 137.759, size: 8192 },
  { name: '北アルプス 槍ヶ岳・穂高岳', lat: 36.32, lon: 137.65, size: 8192 },
  { name: '八ヶ岳 赤岳', lat: 35.971, lon: 138.37, size: 6144 },
  { name: '南アルプス 北岳', lat: 35.674, lon: 138.239, size: 8192 },
  { name: '富士山', lat: 35.361, lon: 138.727, size: 8192 },
  { name: '奥多摩 笙ノ岩山・川苔山', lat: 35.853, lon: 139.064, size: 6144 },
  { name: '丹沢 塔ノ岳', lat: 35.451, lon: 139.164, size: 6144 },
  { name: '高尾山', lat: 35.625, lon: 139.244, size: 4096 },
  { name: '屋久島 宮之浦岳', lat: 30.336, lon: 130.505, size: 8192 },
];

export function createAreaPicker(inputs: { lat: HTMLInputElement; lon: HTMLInputElement; size: HTMLInputElement }): AreaPicker {
  const mapBox = el('div', { class: 'area-picker-map' });
  const presets = el(
    'select',
    { class: 'area-picker-presets', 'aria-label': '山へ移動' },
    [el('option', { value: '' }, '山へ移動…'), ...AREA_PRESETS.map((p, i) => el('option', { value: String(i) }, p.name))],
  );
  const hint = el('p', { class: 'note' }, 'ホイールで拡大・縮小、ドラッグで地図を動かします。地図を押すとそこが範囲の中心になり、四角の中をつまむと範囲を動かせます。');
  const q = el('input', { type: 'search', class: 'area-picker-q', placeholder: '地名・山名で探す（例: 白馬岳、上高地）', 'aria-label': '地名・山名で探す' });
  const go = el('button', { type: 'button' }, '検索');
  const results = el('div', { class: 'area-picker-results', hidden: true });
  const searchNote = el('span', { class: 'note area-picker-msg' }, '');
  const root = el('div', { class: 'area-picker' }, [
    el('div', { class: 'area-picker-bar' }, [q, go, presets, searchNote]),
    results,
    mapBox,
    hint,
    el('p', { class: 'note' }, '地名・山名の検索: © OpenStreetMap contributors（Overpass API）。押したときだけ問い合わせます。'),
  ]);

  const view = new TileMapView(mapBox);
  view.minZoom = 5;
  const center = (): { lat: number; lon: number } => ({ lat: Number(inputs.lat.value), lon: Number(inputs.lon.value) });
  const sizeM = (): number => Math.min(12288, Math.max(2048, Number(inputs.size.value) || 6000));
  const setCenter = (lat: number, lon: number): void => {
    inputs.lat.value = lat.toFixed(4);
    inputs.lon.value = lon.toFixed(4);
    view.redraw();
  };
  /** 範囲の四角の角（画面の px） */
  const corners = (v: TileMapView): { px: number; py: number }[] => {
    const c = center();
    const h = sizeM() / 2;
    return ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([x, z]) => {
      const ll = toLatLon(c.lat, c.lon, x, z);
      return v.toPx(ll.lat, ll.lon);
    });
  };
  const area: MapLayer = {
    id: 'area',
    visible: true,
    draw(g, v) {
      const c = center();
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
      const pts = corners(v);
      const w = Math.hypot(pts[1]!.px - pts[0]!.px, pts[1]!.py - pts[0]!.py);
      const m = v.toPx(c.lat, c.lon);
      g.save();
      if (w < 14) {
        // 遠くから見ているときは印で示す
        g.strokeStyle = '#d23c1e';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(m.px, m.py, 9, 0, Math.PI * 2);
        g.moveTo(m.px - 15, m.py);
        g.lineTo(m.px + 15, m.py);
        g.moveTo(m.px, m.py - 15);
        g.lineTo(m.px, m.py + 15);
        g.stroke();
      } else {
        g.fillStyle = 'rgba(210, 60, 30, 0.12)';
        g.strokeStyle = '#d23c1e';
        g.lineWidth = 2;
        g.beginPath();
        pts.forEach((p, i) => (i === 0 ? g.moveTo(p.px, p.py) : g.lineTo(p.px, p.py)));
        g.closePath();
        g.fill();
        g.stroke();
        g.font = '12px system-ui, sans-serif';
        g.fillStyle = '#7a1e0c';
        g.fillText(`${(sizeM() / 1000).toFixed(1)} km 四方`, pts[0]!.px + 4, pts[0]!.py - 6);
      }
      g.restore();
    },
  };
  view.layers.push(area);
  const inside = (p: MapPointer): boolean => {
    const pts = corners(view);
    const xs = pts.map((q) => q.px);
    const ys = pts.map((q) => q.py);
    return p.px >= Math.min(...xs) && p.px <= Math.max(...xs) && p.py >= Math.min(...ys) && p.py <= Math.max(...ys) && Math.max(...xs) - Math.min(...xs) >= 14;
  };
  let grab: { dLat: number; dLon: number } | null = null;
  view.tool = {
    cursor: 'crosshair',
    down(p) {
      if (!inside(p)) return false;
      const c = center();
      grab = { dLat: c.lat - p.lat, dLon: c.lon - p.lon };
      view.setCursor('grabbing');
      return true;
    },
    move(p, dragging) {
      if (dragging && grab) setCenter(p.lat + grab.dLat, p.lon + grab.dLon);
      else view.setCursor(inside(p) ? 'grab' : 'crosshair');
    },
    up() {
      grab = null;
      view.setCursor('grab');
    },
    click(p) {
      if (grab) return;
      setCenter(p.lat, p.lon);
      // 遠くから選んだら、範囲が見えるところまで近づく
      if (view.zoom < 11) view.setView(p.lat, p.lon, 12);
    },
  };
  view.setCursor('crosshair');
  /** 検索の結果を選んだら、そこを範囲の中心にして近づく */
  const jump = (h: { lat: number; lon: number }): void => {
    setCenter(h.lat, h.lon);
    view.lat0 = h.lat;
    view.lon0 = h.lon;
    view.fitArea(sizeM() * 1.6);
  };
  const showHits = (hits: PlaceHit[]): void => {
    results.replaceChildren(
      ...hits.map((h) =>
        el('button', {
          type: 'button',
          class: 'area-picker-hit',
          onclick: () => {
            jump(h);
            results.hidden = true;
            searchNote.textContent = `${h.name}へ移動しました`;
          },
        }, [el('strong', {}, h.name), el('small', {}, ` ${h.kind}${h.elevM !== undefined ? ` ${h.elevM.toLocaleString('ja-JP')} m` : ''}　${h.lat.toFixed(3)}, ${h.lon.toFixed(3)}`)]),
      ),
    );
    results.hidden = hits.length === 0;
  };
  let searching = false;
  const search = async (): Promise<void> => {
    const text = q.value.trim();
    if (!text || searching) return;
    // 収録の山の候補は通信せずに先に出す
    const local: PlaceHit[] = AREA_PRESETS.filter((p) => p.name.includes(text)).map((p) => ({ name: p.name, kind: '候補', lat: p.lat, lon: p.lon }));
    showHits(local);
    searching = true;
    go.disabled = true;
    const t0 = performance.now();
    let retry = '';
    const tick = (): void => {
      searchNote.textContent = `探しています…（OpenStreetMap。${Math.round((performance.now() - t0) / 1000)} 秒。混んでいると 1 分ほどかかります）${retry}`;
    };
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const hits = await searchPlaces(text, (n) => {
        retry = ` 検索サーバーが混み合っているので、少し待ってやり直しています（${n} 回目）`;
        tick();
      });
      showHits([...local, ...hits]);
      searchNote.textContent = local.length + hits.length === 0 ? `「${text}」は見つかりませんでした。別の書き方（「岳」「山」を付ける・外す）でも試してください` : `${local.length + hits.length} 件。選ぶとそこへ移動します`;
    } catch (e) {
      searchNote.textContent = String(e instanceof Error ? e.message : e);
    } finally {
      clearInterval(timer);
      searching = false;
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void search());
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // ダイアログの「作る」を押したことにしない
      e.preventDefault();
      void search();
    }
  });
  presets.addEventListener('change', () => {
    const p = AREA_PRESETS[Number(presets.value)];
    if (!p) return;
    inputs.size.value = String(p.size);
    setCenter(p.lat, p.lon);
    view.lat0 = p.lat;
    view.lon0 = p.lon;
    view.fitArea(p.size * 1.6);
    presets.value = '';
  });
  // 日本全体から始める
  requestAnimationFrame(() => view.setView(37.6, 137.6, 5));
  return {
    el: root,
    sync: () => view.redraw(),
    dispose: () => root.remove(),
  };
}

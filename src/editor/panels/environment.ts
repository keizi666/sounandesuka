/**
 * タブ 4 環境（docs/16 §6）: 植生（森林限界の提案・ブラシで塗り直し）、電波（基地局・塗り、近似であることを明記）、地形の確認表示。
 */
import { VegClass, type RadioStationDef } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, fill, num, section, select } from '../forms/fields';
import { suggestForestLine } from '../geo/dem';
import type { OverlayKind } from '../map/layers';
import { paintCircle } from '../map/tools';
import type { MapTool } from '../map/TileMapView';
import { sampleElevAt } from './elev';
import type { Panel } from './types';

type Mode = 'view' | 'veg' | 'radio' | 'station';
let mode: Mode = 'view';
let vegClass = VegClass.ROCK + 1;
let radioValue = 1;
let radius = 60;
let overlay: OverlayKind = 'veg';

const VEG_OPTS: [number, string][] = [
  [0, '自動に戻す（消しゴム）'],
  [VegClass.BROADLEAF + 1, '広葉樹林'],
  [VegClass.CONIFER + 1, '針葉樹林'],
  [VegClass.KRUMMHOLZ + 1, 'ハイマツ帯'],
  [VegClass.ALPINE + 1, '高山草原'],
  [VegClass.ROCK + 1, '岩場'],
  [VegClass.STREAM + 1, '沢'],
];

function tool(ed: Ed): MapTool | null {
  if (mode === 'view') return null;
  if (mode === 'station') {
    return {
      cursor: 'crosshair',
      click(p) {
        const rt = ed.runtime();
        const elev = rt && Math.abs(p.x) <= ed.p.map.size / 2 && Math.abs(p.z) <= ed.p.map.size / 2 ? sampleElevAt(rt, p.x, p.z) : (ed.p.map.terrain.baseElevation ?? 0);
        ed.change('基地局', () => {
          const id = `st${ed.p.map.radio.stations.length + 1}`;
          ed.p.map.radio.stations.push({ id, x: Math.round(p.x), z: Math.round(p.z), elevM: Math.round(elev), antennaM: 40, rangeM: 15000 });
        }, true);
      },
    };
  }
  let painting = false;
  let dirty = false;
  const paint = (x: number, z: number): void => {
    const map = ed.p.map;
    if (mode === 'veg') map.vegetation.overrides = paintCircle(map.vegetation.overrides, map, x, z, radius, vegClass);
    else map.radio.paint = paintCircle(map.radio.paint, map, x, z, radius, radioValue === -1 ? 255 : radioValue);
    dirty = true;
    ed.view.redraw();
  };
  return {
    cursor: 'cell',
    down(p) {
      painting = true;
      dirty = false;
      // 塗りの 1 筆を Undo の 1 単位にする（先に記録してから塗る）
      ed.checkpoint(mode === 'veg' ? '植生の塗り' : '電波の塗り');
      paint(p.x, p.z);
      return true;
    },
    move(p, dragging) {
      if (painting && dragging) paint(p.x, p.z);
    },
    up() {
      painting = false;
      if (dirty) ed.touched(true);
    },
  };
}

function stationRow(ed: Ed, st: RadioStationDef): HTMLElement {
  const set = (f: () => void): void => ed.change('基地局', f, true);
  return el('div', { class: 'f-section' }, [
    el('strong', {}, `基地局 ${st.id}`),
    num('標高', st.elevM, (v) => set(() => (st.elevM = v)), { unit: 'm' }),
    num('アンテナ高', st.antennaM, (v) => set(() => (st.antennaM = v)), { min: 0, unit: 'm' }),
    num('到達距離', st.rangeM, (v) => set(() => (st.rangeM = v)), { min: 500, step: 500, unit: 'm' }),
    button('削除', () => set(() => (ed.p.map.radio.stations = ed.p.map.radio.stations.filter((x) => x !== st)))),
  ]);
}

/** 初期配置の提案: エリア周辺のいちばん低い方角の 8 km 先に 1 局 */
function proposeStation(ed: Ed): void {
  const rt = ed.runtime();
  if (!rt) return;
  const half = ed.p.map.size / 2;
  let best = { x: 0, z: 0, e: Infinity };
  for (let a = 0; a < 16; a += 1) {
    const ang = (a / 16) * Math.PI * 2;
    const x = Math.cos(ang) * half * 0.95;
    const z = Math.sin(ang) * half * 0.95;
    const e = sampleElevAt(rt, x, z);
    if (e < best.e) best = { x, z, e };
  }
  const len = Math.hypot(best.x, best.z) || 1;
  const d = half + 8000;
  ed.change('基地局の提案', () => ed.p.map.radio.stations.push({ id: `st${ed.p.map.radio.stations.length + 1}`, x: Math.round((best.x / len) * d), z: Math.round((best.z / len) * d), elevM: Math.round(best.e - 200), antennaM: 40, rangeM: 20000 }), true);
}

export const environmentPanel: Panel = {
  id: 'environment',
  label: '環境',
  tool,
  render(ed) {
    const vg = ed.p.map.vegetation;
    const set = (label: string, f: () => void): void => ed.change(label, f, true);
    const lat = ed.p.map.geo?.centerLat;
    const showPaint = (): void => ed.setOverlay(overlay, mode === 'veg' ? 'veg' : mode === 'radio' ? 'radio' : null);
    showPaint();
    fill(
      ed.inspector,
      el('h2', {}, '環境'),
      select<Mode>('道具', mode, [['view', '見るだけ'], ['veg', '植生を塗る'], ['radio', '電波を塗る'], ['station', '基地局を置く（クリック）']], (m) => {
        mode = m;
        if (m === 'veg') overlay = 'veg';
        if (m === 'radio' || m === 'station') overlay = 'radio';
        ed.refresh();
      }),
      select<OverlayKind>('確認表示', overlay, [['none', 'なし'], ['veg', '植生'], ['radio', '電波'], ['slope', '傾斜'], ['tpi', '風の露出（TPI）'], ['sky', '空の見通し']], (k) => {
        overlay = k;
        showPaint();
      }),
      button('3D で確認', () => ed.toggle3d(true)),
      section('植生', [
        num('森林限界', vg.forestLine, (v) => set('森林限界', () => (vg.forestLine = v)), { step: 50, unit: 'm' }),
        lat !== undefined ? button(`緯度から提案（${suggestForestLine(lat)} m）`, () => set('森林限界', () => (vg.forestLine = suggestForestLine(lat)))) : null,
        el('p', { class: 'note' }, '目安: 北アルプス 2,500 m、八ヶ岳 2,400 m、東北 1,600 m 前後。必ず確認してください。'),
        num('揺らぎ', vg.forestLineNoise, (v) => set('揺らぎ', () => (vg.forestLineNoise = v)), { min: 0, step: 10, unit: 'm' }),
        num('広葉樹林の上限', vg.broadleafLine, (v) => set('広葉樹林', () => (vg.broadleafLine = v)), { step: 50, unit: 'm' }),
        num('ハイマツ帯の幅', vg.krummholzBandM ?? 200, (v) => set('ハイマツ帯', () => (vg.krummholzBandM = v)), { min: 0, step: 25, unit: 'm' }),
        mode === 'veg' ? select('塗る植生', vegClass, VEG_OPTS, (v) => (vegClass = v)) : null,
        mode === 'veg' || mode === 'radio' ? num('ブラシの半径', radius, (v) => (radius = v), { min: 20, max: 200, step: 10, unit: 'm' }) : null,
        vg.overrides ? button('植生の塗りをすべて消す', () => set('植生の塗り', () => delete vg.overrides)) : null,
      ]),
      section('電波（近似）', [
        el('p', { class: 'note' }, '実在のキャリアのエリアマップは使えないため、基地局からの見通しで近似します。山頂で通じた・小屋で通じないなどの経験は「塗り」で反映してください。'),
        ...ed.p.map.radio.stations.map((st) => stationRow(ed, st)),
        button('基地局を提案（いちばん低い方角の 8 km 先）', () => proposeStation(ed)),
        mode === 'radio' ? select('塗る値', radioValue, [[1, '電波あり（強制）'], [-1, '圏外（強制）'], [0, '自動に戻す']], (v) => (radioValue = v)) : null,
        ed.p.map.radio.paint ? button('電波の塗りをすべて消す', () => set('電波の塗り', () => delete ed.p.map.radio.paint)) : null,
      ]),
    );
    ed.bottom.replaceChildren();
  },
};

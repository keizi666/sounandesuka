/**
 * 地点・施設・危険箇所の部品（登山道と地点のタブで使う。ユーザーの指定で、登山道のタブと地点のタブを 1 つにした）:
 * 地点を足す（道の上なら挿入）、施設・鉄塔・滝・保護範囲・鎖場・落石帯を置く、地点・危険箇所のインスペクタ、地点の一覧。
 */
import type { HazardDef, LandmarkDef, LandmarkKind, NodeDef, NodeType } from '../../sim/types';
import { deleteLandmark, hitLandmark, landmarkInspector, landmarkSection, moveLandmark, placeLandmark } from './landmarkTools';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, check, num, section, select, text } from '../forms/fields';
import type { ToolDef } from '../forms/toolPalette';
import { hitEdge, hitHazard, hitNode, insertNodeOnEdge, renameNode } from '../map/tools';
import type { MapPointer } from '../map/TileMapView';
import { nextId } from '../store/project';
import { removeSelection } from '../map/edgeSelection';

export type PointMode = 'landmark' | 'waterfall' | 'protectionZone' | 'chain' | 'rockfallZone';
export const POINT_TOOLS: ToolDef<PointMode>[] = [
  { id: 'landmark', icon: 'templeBuddhist', label: '施設・鉄塔を置く', key: 'l', hint: 'クリックした所に置く（種類は下で選ぶ。鉄塔は送電線の上に載せる）。置いた施設は「選択」でドラッグして動かす' },
  { id: 'waterfall', icon: 'waves', label: '滝を置く', key: 'w', hint: 'クリックした所に置く' },
  { id: 'protectionZone', icon: 'shield', label: '保護範囲を置く', key: 'z', hint: 'クリックした所に置く' },
  { id: 'chain', icon: 'link', label: '鎖場', key: 'c', hint: '道の上を 2 回クリック（始まりと終わり）' },
  { id: 'rockfallZone', icon: 'landslide', label: '落石帯', key: 'f', hint: '道の上を 2 回クリック（始まりと終わり）' },
];
export const POINT_MODES: readonly string[] = POINT_TOOLS.map((t) => t.id);

let draggingLm: LandmarkDef | null = null;
let lmMoved = false;
let newLandmark: LandmarkKind = 'tower';
let newType: NodeType = 'junction';
let sectionStart: { edge: string; s: number } | null = null;

const TYPES: [NodeType, string][] = [
  ['trailhead', '登山口・下山口'],
  ['junction', '分岐'],
  ['peak', '山頂'],
  ['saddle', '鞍部'],
  ['hut', '山小屋'],
  ['shelter', '避難小屋'],
  ['landmark', '目印'],
  ['boundary', '境界点（範囲の外へ続く道の端）'],
];

/** エッジ上の位置（沿った距離 s）。samples の s を使う */
function sOnEdge(ed: Ed, edgeId: string, x: number, z: number): number {
  const t = ed.runtime()?.trails[edgeId];
  if (!t) return 0;
  let best = 0;
  let bd = Infinity;
  for (const p of t.samples) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = p.s;
    }
  }
  return Math.round(best);
}

/** 地点を足す（N）: 道の上なら道に挿入、なにもない所なら置く（種類は newType） */
export function placeNode(ed: Ed, p: MapPointer): void {
  const map = ed.p.map;
  const ids = [...map.nodes.map((n) => n.id), ...map.edges.map((e) => e.id)];
  const id = nextId(ids, 'N');
  const shelter = newType === 'hut' ? { kind: 'staffed' as const, open: true } : newType === 'shelter' ? { kind: 'emergency' as const, open: true } : undefined;
  const onEdge = hitNode(ed.view, map, p.px, p.py) ? null : hitEdge(ed.view, map, ed.runtime(), p.px, p.py);
  if (onEdge) {
    ed.change('地点を挿入', () => {
      insertNodeOnEdge(map, ed.p.scenario, onEdge.edge, { x: p.x, z: p.z }, id, nextId([...ids, id], 'E'));
      const nd = map.nodes.find((n) => n.id === id);
      if (nd) {
        nd.type = newType;
        if (shelter) nd.shelter = shelter;
      }
      ed.p.editorState.selection = { kind: 'node', id };
    }, true);
    return;
  }
  ed.change('地点を置く', () => {
    map.nodes.push({ id, name: id, type: newType, x: p.x, z: p.z, shelter, snap: false, source: 'manual' });
    ed.p.editorState.selection = { kind: 'node', id };
  }, true);
}

/** 施設・滝・保護範囲・鎖場・落石帯を置く（地図のクリック） */
export function pointClick(ed: Ed, mode: PointMode, p: MapPointer): void {
  const map = ed.p.map;
  if (mode === 'landmark') return placeLandmark(ed, newLandmark, p.x, p.z);
  if (mode === 'waterfall' || mode === 'protectionZone') {
    const id = nextId(map.hazards.map((h) => h.id), mode === 'waterfall' ? 'WF' : 'PZ');
    ed.change('危険箇所', () => {
      map.hazards.push(mode === 'waterfall' ? { id, type: 'waterfall', name: '滝', x: p.x, z: p.z, radius: 40 } : { id, type: 'protectionZone', name: '保護範囲', x: p.x, z: p.z, radius: 80 });
      ed.p.editorState.selection = { kind: 'hazard', id };
    }, true);
    return;
  }
  // 鎖場・落石帯: 同じ道の上を 2 回クリック
  const h = hitEdge(ed.view, map, ed.runtime(), p.px, p.py);
  if (!h) return;
  const s = sOnEdge(ed, h.edge.id, p.x, p.z);
  if (!sectionStart || sectionStart.edge !== h.edge.id) {
    sectionStart = { edge: h.edge.id, s };
    ed.toast('区間の終わりを同じ道の上でクリックしてください');
    return;
  }
  const range: [number, number] = [Math.min(sectionStart.s, s), Math.max(sectionStart.s, s)];
  sectionStart = null;
  const id = nextId(map.hazards.map((x) => x.id), mode === 'chain' ? 'CH' : 'RF');
  ed.change('区間の危険箇所', () => {
    map.hazards.push(mode === 'chain' ? { id, type: 'chain', name: '鎖場', onEdge: h.edge.id, sRange: range } : { id, type: 'rockfallZone', name: '落石帯', onEdge: h.edge.id, sRange: range });
    ed.p.editorState.selection = { kind: 'hazard', id };
  }, true);
}

/** 道具を持ち替えたとき（鎖場・落石帯の始まりを忘れる） */
export function resetPointTool(): void {
  sectionStart = null;
}

/** 選択の道具で、施設・鉄塔・危険箇所をクリックしたら選ぶ（選んだら true） */
export function selectPointAt(ed: Ed, p: MapPointer): boolean {
  const lm = hitLandmark(ed, p.px, p.py);
  if (lm) {
    ed.select('landmark', lm.id);
    return true;
  }
  const h = hitHazard(ed.view, ed.p.map, p.px, p.py);
  if (h) {
    ed.select('hazard', h.id);
    return true;
  }
  return false;
}

/** 施設・鉄塔のドラッグ（選択の道具で、施設の上で押したとき） */
export const landmarkDrag = {
  down(ed: Ed, p: MapPointer): boolean {
    draggingLm = hitLandmark(ed, p.px, p.py, 12);
    lmMoved = false;
    return draggingLm !== null;
  },
  move(ed: Ed, p: MapPointer, dragging: boolean): boolean {
    if (!dragging || !draggingLm) return false;
    if (!lmMoved) {
      ed.checkpoint('施設・鉄塔を動かす');
      lmMoved = true;
    }
    moveLandmark(ed, draggingLm, p.x, p.z);
    ed.view.redraw();
    return true;
  },
  up(ed: Ed): boolean {
    const lm = draggingLm;
    const was = lmMoved;
    draggingLm = null;
    lmMoved = false;
    if (!lm || !was) return false;
    ed.p.editorState.selection = { kind: 'landmark', id: lm.id };
    ed.touched(true);
    return true;
  },
};

function confuserTable(ed: Ed, n: NodeDef): HTMLElement {
  const out = ed.p.map.edges.filter((e) => e.from === n.id || e.to === n.id);
  if (out.length < 2) return el('p', { class: 'note' }, '分岐ではありません');
  // 行: 進むつもりの道、列: 間違えて入る道
  const amb = (intend: string, wrong: string): number => n.confusers?.find((c) => c.edge === wrong && c.whenIntending.includes(intend))?.ambiguity ?? 0;
  const setAmb = (intend: string, wrong: string, v: number): void =>
    ed.change('紛らわしさ', () => {
      n.confusers ??= [];
      let c = n.confusers.find((x) => x.edge === wrong && x.whenIntending.includes(intend));
      if (!c && v > 0) n.confusers.push((c = { edge: wrong, whenIntending: [intend], ambiguity: v }));
      else if (c) {
        if (v <= 0) {
          c.whenIntending = c.whenIntending.filter((x) => x !== intend);
          if (c.whenIntending.length === 0) n.confusers = n.confusers.filter((x) => x !== c);
        } else c.ambiguity = v;
      }
    }, true);
  return el('table', { class: 'ed-table' }, [
    el('tr', {}, [el('th', {}, '進むつもり＼入る道'), ...out.map((w) => el('th', {}, w.id))]),
    ...out
      .filter((e) => e.kind === 'trail')
      .map((intend) =>
        el('tr', {}, [
          el('th', {}, intend.id),
          ...out.map((wrong) => {
            if (wrong === intend) return el('td', {}, '—');
            const i = el('input', { type: 'number', min: 0, max: 0.9, step: 0.05, value: amb(intend.id, wrong.id), style: 'width:4.5em' });
            i.addEventListener('change', () => setAmb(intend.id, wrong.id, Number(i.value)));
            return el('td', {}, i);
          }),
        ]),
      ),
  ]);
}

/** 地点の編集欄 */
export function nodeInspector(ed: Ed, n: NodeDef): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f, true);
  const idIn = el('input', { value: n.id });
  idIn.addEventListener('change', () => {
    const to = idIn.value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(to)) return ed.toast('ID は英字で始まる英数字と _ にしてください');
    if (ed.p.map.nodes.some((x) => x.id === to)) return ed.toast(`${to} はもう使われています`);
    const from = n.id;
    set('ID の書き換え', () => {
      ed.p.scenario = renameNode(ed.p.map, ed.p.scenario, from, to);
      ed.p.editorState.selection = { kind: 'node', id: to };
    });
  });
  return el('div', {}, [
    el('h3', {}, `地点 ${n.id}`),
    el('label', { class: 'f-row', title: '変えるとシナリオの参照（ルート・条件）も書き換えます' }, [el('span', { class: 'f-label' }, 'ID'), idIn]),
    text('名前', n.name, (v) => set('地点の名前', () => (n.name = v))),
    select('種類', n.type, TYPES, (v) => set('地点の種類', () => {
      n.type = v;
      if (v === 'hut') n.shelter = { kind: 'staffed', open: true };
      else if (v === 'shelter') n.shelter = { kind: 'emergency', open: true };
      else delete n.shelter;
    })),
    n.shelter ? select('小屋', n.shelter.kind, [['staffed', '営業小屋'], ['emergency', '避難小屋']], (v) => set('小屋の種類', () => (n.shelter!.kind = v))) : null,
    n.shelter ? check('営業中（シナリオの nodeOverrides でも上書きできる）', n.shelter.open, (v) => set('営業', () => (n.shelter!.open = v))) : null,
    n.shelter ? check(`このシナリオでは閉まっている（nodeOverrides）`, ed.p.scenario.nodeOverrides?.[n.id]?.open === false, (v) => ed.change('小屋の営業', () => {
      ed.p.scenario.nodeOverrides ??= {};
      if (v) ed.p.scenario.nodeOverrides[n.id] = { open: false };
      else delete ed.p.scenario.nodeOverrides[n.id];
    })) : null,
    check('山頂・鞍部に自動で合わせる（snap）', n.snap ?? false, (v) => set('snap', () => (n.snap = v))),
    el('p', { class: 'note' }, `標高 ${Math.round(ed.runtime()?.nodes[n.id]?.elevM ?? NaN)} m（DEM から）`),
    section('紛らわしい分岐（ambiguity 0〜0.9）', [confuserTable(ed, n)]),
    (() => {
      const k = ed.p.map.edges.filter((e) => e.from === n.id || e.to === n.id).length;
      return button(k ? `この地点を削除（つながる道 ${k} 本も）` : 'この地点を削除', () => deleteNode(ed, n.id), 'danger');
    })(),
    el('p', { class: 'note' }, 'Delete キーでも消せます。ルート・下山口に使っている地点は、確かめてから消します（Ctrl＋Z で戻せます）。'),
  ]);
}

/** 地点を消す（つながる道も） */
function deleteNode(ed: Ed, id: string): void {
  const before = ed.p.map.edges.length;
  if (removeSelection(ed, [], [id])) ed.toast(`地点 ${id} を削除しました${ed.p.map.edges.length < before ? `（つながる道 ${before - ed.p.map.edges.length} 本も）` : ''}（Ctrl＋Z で戻せます）`);
}

function deleteHazard(ed: Ed, id: string): void {
  ed.change('危険箇所の削除', () => {
    ed.p.map.hazards = ed.p.map.hazards.filter((x) => x.id !== id);
    ed.p.editorState.selection = { kind: null, id: null };
  }, true);
}

function hazardInspector(ed: Ed, h: HazardDef): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f, true);
  return el('div', {}, [
    el('h3', {}, `危険箇所 ${h.id}`),
    text('名前', h.name ?? '', (v) => set('名前', () => (h.name = v))),
    'radius' in h ? num('半径', h.radius, (v) => set('半径', () => (h.radius = v)), { min: 5, step: 5, unit: 'm' }) : null,
    'sRange' in h ? el('p', {}, `${h.onEdge} の ${h.sRange[0]}〜${h.sRange[1]} m`) : null,
    button('削除', () => deleteHazard(ed, h.id), 'danger'),
    el('p', { class: 'note' }, 'Delete キーでも消せます。'),
  ]);
}

/** Delete キー: 選んだ危険箇所・施設を消す（地点は登山道と地点のタブ側で消す） */
export function deletePointSelection(ed: Ed): boolean {
  const sel = ed.p.editorState.selection;
  if (sel.kind === 'hazard' && sel.id) deleteHazard(ed, sel.id);
  else if (sel.kind === 'landmark' && sel.id) deleteLandmark(ed, sel.id);
  else return false;
  return true;
}

/** 道具ごとの欄（地点を足すときの種類・施設の種類と地図記号の取り込み）と、崖の重ね表示 */
export function pointOptions(ed: Ed, mode: string): (HTMLElement | null)[] {
  return [
    mode === 'split' ? select('足す地点の種類', newType, TYPES, (t) => (newType = t)) : null,
    check('傾斜 50° 超（崖）を赤で重ねる', false, (v) => ed.setOverlay(v ? 'slope' : 'none')),
    landmarkSection(ed, newLandmark, (k) => (newLandmark = k), mode === 'landmark'),
  ];
}

/** 選んだ危険箇所・施設のインスペクタ（なければ null） */
export function pointSelectionInspector(ed: Ed): HTMLElement | null {
  const sel = ed.p.editorState.selection;
  const h = sel.kind === 'hazard' ? ed.p.map.hazards.find((x) => x.id === sel.id) : undefined;
  const lm = sel.kind === 'landmark' ? ed.p.map.landmarks?.find((x) => x.id === sel.id) : undefined;
  return h ? hazardInspector(ed, h) : lm ? landmarkInspector(ed, lm) : null;
}

/** 地点の一覧（クリックで選ぶ） */
export function nodeListSection(ed: Ed): HTMLElement {
  const sel = ed.p.editorState.selection;
  return section(`地点の一覧（${ed.p.map.nodes.length}）`, [
    el('table', { class: 'ed-table' }, ed.p.map.nodes.map((x) => el('tr', { class: sel.kind === 'node' && sel.id === x.id ? 'sel' : '', onclick: () => ed.select('node', x.id) }, [el('td', {}, x.id), el('td', {}, x.name), el('td', {}, TYPES.find((t) => t[0] === x.type)?.[1] ?? x.type)]))),
  ], false);
}

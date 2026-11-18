/**
 * タブ 3 地点（docs/16 §4.5、§5）: ノード（名前・種類・小屋・ID の一括書き換え・紛らわしい分岐の表）、危険箇所（鎖場・滝・落石帯・保護範囲）。
 */
import type { HazardDef, NodeDef, NodeType } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, check, fill, num, section, select, text } from '../forms/fields';
import { hitEdge, hitHazard, hitNode, renameNode } from '../map/tools';
import type { MapTool } from '../map/TileMapView';
import { nextId } from '../store/project';
import type { Panel } from './types';

type Mode = 'select' | 'node' | 'waterfall' | 'protectionZone' | 'chain' | 'rockfallZone';
let mode: Mode = 'select';
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

function tool(ed: Ed): MapTool {
  return {
    cursor: mode === 'select' ? 'pointer' : 'crosshair',
    click(p) {
      const map = ed.p.map;
      if (mode === 'select') {
        const n = hitNode(ed.view, map, p.px, p.py);
        if (n) return ed.select('node', n.id);
        const h = hitHazard(ed.view, map, p.px, p.py);
        return ed.select(h ? 'hazard' : null, h?.id ?? null);
      }
      if (mode === 'node') {
        const id = nextId(map.nodes.map((n) => n.id), 'N');
        const shelter = newType === 'hut' ? { kind: 'staffed' as const, open: true } : newType === 'shelter' ? { kind: 'emergency' as const, open: true } : undefined;
        ed.change('地点を置く', () => {
          map.nodes.push({ id, name: id, type: newType, x: p.x, z: p.z, shelter, snap: false, source: 'manual' });
          ed.p.editorState.selection = { kind: 'node', id };
        }, true);
        return;
      }
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
    },
  };
}

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

function nodeInspector(ed: Ed, n: NodeDef): HTMLElement {
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
    button('この地点を削除', () => {
      if (ed.p.map.edges.some((e) => e.from === n.id || e.to === n.id)) return ed.toast('道につながっている地点は削除できません（先に道を消すか結合してください）');
      set('地点の削除', () => {
        ed.p.map.nodes = ed.p.map.nodes.filter((x) => x !== n);
        ed.p.editorState.selection = { kind: null, id: null };
      });
    }),
  ]);
}

function hazardInspector(ed: Ed, h: HazardDef): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f, true);
  return el('div', {}, [
    el('h3', {}, `危険箇所 ${h.id}`),
    text('名前', h.name ?? '', (v) => set('名前', () => (h.name = v))),
    'radius' in h ? num('半径', h.radius, (v) => set('半径', () => (h.radius = v)), { min: 5, step: 5, unit: 'm' }) : null,
    'sRange' in h ? el('p', {}, `${h.onEdge} の ${h.sRange[0]}〜${h.sRange[1]} m`) : null,
    button('削除', () => set('危険箇所の削除', () => {
      ed.p.map.hazards = ed.p.map.hazards.filter((x) => x !== h);
      ed.p.editorState.selection = { kind: null, id: null };
    })),
  ]);
}

export const pointsPanel: Panel = {
  id: 'points',
  label: '地点',
  tool,
  render(ed) {
    const sel = ed.p.editorState.selection;
    const n = sel.kind === 'node' ? ed.p.map.nodes.find((x) => x.id === sel.id) : undefined;
    const h = sel.kind === 'hazard' ? ed.p.map.hazards.find((x) => x.id === sel.id) : undefined;
    fill(
      ed.inspector,
      el('h2', {}, '地点と危険箇所'),
      select<Mode>('道具', mode, [['select', '選択'], ['node', '地点を置く'], ['waterfall', '滝を置く'], ['protectionZone', '保護範囲を置く'], ['chain', '鎖場（道の上を 2 回クリック）'], ['rockfallZone', '落石帯（道の上を 2 回クリック）']], (m) => {
        mode = m;
        sectionStart = null;
        ed.refresh();
      }),
      mode === 'node' ? select('置く種類', newType, TYPES, (t) => (newType = t)) : null,
      check('傾斜 50° 超（崖）を赤で重ねる', false, (v) => ed.setOverlay(v ? 'slope' : 'none')),
      n ? nodeInspector(ed, n) : h ? hazardInspector(ed, h) : el('p', { class: 'note' }, '地点か危険箇所をクリックすると編集できます。ID は自動で N001 のように付きます。読みやすい ID（HUT_ENZAN など）に変えると、ルートや条件の参照も書き換えます。'),
      section(`地点の一覧（${ed.p.map.nodes.length}）`, [
        el('table', { class: 'ed-table' }, ed.p.map.nodes.map((x) => el('tr', { class: x === n ? 'sel' : '', onclick: () => ed.select('node', x.id) }, [el('td', {}, x.id), el('td', {}, x.name), el('td', {}, TYPES.find((t) => t[0] === x.type)?.[1] ?? x.type)]))),
      ], false),
    );
    ed.bottom.replaceChildren();
  },
};

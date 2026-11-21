/**
 * 地点タブの「地図記号の施設と鉄塔」: 選ぶ・動かす（鉄塔は送電線の上を動く）・置く・消す、インスペクタと一覧、取り込みのボタン。
 * 2D の地図の表示は map/landmarkLayer.ts。
 */
import type { LandmarkDef, LandmarkKind } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, num, section, select, text } from '../forms/fields';
import { LANDMARK_LABELS, nearestOnLine } from '../geo/landmarks';
import { importGsi } from '../gsiImport';
import { nextId } from '../store/project';

export const LANDMARK_KINDS = Object.entries(LANDMARK_LABELS) as [LandmarkKind, string][];

/** 画面の点の近く（px）の施設・鉄塔 */
export function hitLandmark(ed: Ed, px: number, py: number, radiusPx = 10): LandmarkDef | null {
  let best: LandmarkDef | null = null;
  let bd = radiusPx;
  for (const l of ed.p.map.landmarks ?? []) {
    const p = ed.view.xzToPx(l.x, l.z);
    const d = Math.hypot(p.px - px, p.py - py);
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best;
}

/** 鉄塔を送電線の上に載せる（近い線がなければそのまま）。線の ID を返す */
function snapTower(ed: Ed, x: number, z: number, line?: string): { x: number; z: number; line?: string } {
  const lines = ed.p.map.powerLines ?? [];
  const cands = line ? lines.filter((l) => l.id === line) : lines;
  let best: { x: number; z: number; d: number; id: string } | null = null;
  for (const l of cands) {
    const q = nearestOnLine(l.pts, x, z);
    if (!best || q.d < best.d) best = { ...q, id: l.id };
  }
  // 線を決めずに置くときは、画面で 30 px 以内の線に載せる
  if (best && (line || best.d * ed.view.pxPerM() < 30)) return { x: Math.round(best.x * 10) / 10, z: Math.round(best.z * 10) / 10, line: best.id };
  return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
}

export function placeLandmark(ed: Ed, kind: LandmarkKind, x: number, z: number): void {
  const list = ed.p.map.landmarks ?? [];
  const id = nextId(list.map((l) => l.id), kind === 'tower' ? 'T' : 'MK');
  const pos = kind === 'tower' ? snapTower(ed, x, z) : { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  ed.change(`${LANDMARK_LABELS[kind]}を置く`, () => {
    ed.p.map.landmarks = [...(ed.p.map.landmarks ?? []), { id, kind, ...pos }];
    ed.p.editorState.selection = { kind: 'landmark', id };
  }, true);
  if (kind === 'tower' && !('line' in pos && pos.line)) ed.toast('近くに送電線がないので、線に載らない鉄塔として置きました（電線は張りません）', 5000);
}

/** ドラッグで動かす（鉄塔は載っている送電線の上だけを動く） */
export function moveLandmark(ed: Ed, l: LandmarkDef, x: number, z: number): void {
  const pos = l.kind === 'tower' && l.line ? snapTower(ed, x, z, l.line) : { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  l.x = pos.x;
  l.z = pos.z;
}

export function deleteLandmark(ed: Ed, id: string): void {
  ed.change('施設・鉄塔の削除', () => {
    ed.p.map.landmarks = (ed.p.map.landmarks ?? []).filter((l) => l.id !== id);
    ed.p.editorState.selection = { kind: null, id: null };
  }, true);
}

export function landmarkInspector(ed: Ed, l: LandmarkDef): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f, true);
  return el('div', {}, [
    el('h3', {}, `${LANDMARK_LABELS[l.kind]} ${l.id}`),
    select<LandmarkKind>('種類', l.kind, LANDMARK_KINDS, (v) => set('種類', () => (l.kind = v))),
    text('名前', l.name ?? '', (v) => set('名前', () => (l.name = v || undefined))),
    l.kind === 'tower'
      ? el('p', { class: 'note' }, l.line ? `送電線 ${l.line} の上（動かすと線の上を動きます）。電線は同じ線の隣の鉄塔とつなぎます。` : '送電線に載っていない鉄塔です（電線は張りません）。')
      : num('向き', l.rotDeg ?? 0, (v) => set('向き', () => (l.rotDeg = v)), { step: 15, unit: '°' }),
    button('削除', () => deleteLandmark(ed, l.id), 'danger'),
    el('p', { class: 'note' }, 'Delete キーでも消せます。「地点を動かす」の道具でドラッグすると動かせます。'),
  ]);
}

let importMsg = '';

/** 地点タブの欄: 取り込み・数・一覧 */
export function landmarkSection(ed: Ed, newKind: LandmarkKind, setKind: (k: LandmarkKind) => void, placing: boolean): HTMLElement {
  const list = ed.p.map.landmarks ?? [];
  const towers = list.filter((l) => l.kind === 'tower').length;
  return section(`地図記号の施設と鉄塔（施設 ${list.length - towers}・鉄塔 ${towers}・送電線 ${ed.p.map.powerLines?.length ?? 0}）`, [
    el('p', { class: 'note' }, '寺・神社・駅・交番・学校・郵便局などと送電線を、地理院地図の地図記号から取り込みます。鉄塔は送電線の上の尾根に自動で置きます。3D の見た目だけで、シミュレーションには使いません。'),
    ed.p.map.geo
      ? button(list.length ? '地図記号から取り込み直す' : '地図記号から取り込む', async () => {
          const r = await importGsi(ed, { forest: false, urban: false, landmarks: true });
          if (r) importMsg = r;
          ed.refresh();
        }, list.length ? '' : 'primary')
      : null,
    importMsg ? el('p', { class: 'note' }, importMsg) : null,
    placing ? select<LandmarkKind>('置く種類', newKind, LANDMARK_KINDS, setKind) : null,
    placing ? el('p', { class: 'note' }, newKind === 'tower' ? '送電線の近くをクリックすると、線の上に載せます。' : '地図をクリックした所に置きます。') : null,
    list.length
      ? el('details', {}, [
          el('summary', {}, '一覧'),
          el('table', { class: 'ed-table' }, list.map((l) => el('tr', { onclick: () => ed.select('landmark', l.id) }, [el('td', {}, l.id), el('td', {}, LANDMARK_LABELS[l.kind]), el('td', {}, l.name ?? '')]))),
        ])
      : null,
  ], list.length === 0 || placing);
}

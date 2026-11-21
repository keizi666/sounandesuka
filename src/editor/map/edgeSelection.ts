/**
 * 道の複数選択（ユーザーの指定: OSM から取り込んだ道を、矩形で囲んで・クリックで選んで、Delete キーか削除ボタンで消す）。
 * 選択は保存しない（編集中だけ）。1 本だけ選んだときは、これまでどおり editorState.selection も使う。
 */
import type { Ed } from '../context';
import { pruneConfusers } from './tools';

export const edgeSel = {
  /** 選んでいる道の ID */
  ids: new Set<string>(),
  /** 範囲選択で選んだ地点の ID（道につながらない地点も選んで消せるように） */
  nodeIds: new Set<string>(),
  /** ドラッグ中の矩形（ワールド座標 m） */
  box: null as { x0: number; z0: number; x1: number; z1: number } | null,
};

export function clearEdgeSel(): void {
  edgeSel.ids.clear();
  edgeSel.nodeIds.clear();
  edgeSel.box = null;
}

/**
 * 道と地点をまとめて消す。地点を消すときは、その地点につながる道も消す。
 * 計画ルート・下山口に使っている地点を消すときは確かめ、ルートと下山口からも外す
 */
export function removeSelection(ed: Ed, edgeIds: string[], nodeIds: string[]): boolean {
  const nodeSet = new Set(nodeIds);
  const ids = new Set([...edgeIds, ...ed.p.map.edges.filter((e) => nodeSet.has(e.from) || (e.to !== undefined && nodeSet.has(e.to))).map((e) => e.id)]);
  if (ids.size === 0 && nodeSet.size === 0) return false;
  const plan = ed.p.scenario.plan;
  const inPlan = [...nodeSet].filter((id) => plan.route.includes(id) || plan.goalNodes.includes(id));
  if (inPlan.length > 0) {
    const names = inPlan.map((id) => ed.p.map.nodes.find((n) => n.id === id)?.name || id).join('、');
    if (!confirm(`計画ルート・下山口に使っている地点（${names}）も消します。ルートと下山口からも外れます。よろしいですか？（Ctrl＋Z で戻せます）`)) return false;
  }
  clearEdgeSel();
  const sel = ed.p.editorState.selection;
  if ((sel.kind === 'edge' && ids.has(sel.id ?? '')) || (sel.kind === 'node' && nodeSet.has(sel.id ?? ''))) ed.p.editorState.selection = { kind: null, id: null };
  ed.change(nodeSet.size > 0 ? '道と地点を削除' : '道を除外', () => {
    const map = ed.p.map;
    map.edges = map.edges.filter((e) => !ids.has(e.id));
    // 消した道を指す紛らわしさも消す
    pruneConfusers(map);
    ed.p.editorState.draftEdgeIds = ed.p.editorState.draftEdgeIds.filter((x) => !ids.has(x));
    // どの道にもつながらない分岐点（junction）と境界点（boundary。範囲の外へ続く道の端）は消す
    const used = new Set(map.edges.flatMap((e) => [e.from, e.to ?? '']));
    map.nodes = map.nodes.filter((n) => !nodeSet.has(n.id) && (used.has(n.id) || (n.type === 'junction' ? n.source === 'manual' : n.type !== 'boundary')));
    if (inPlan.length > 0) {
      const alive = new Set(map.nodes.map((n) => n.id));
      ed.p.scenario.plan = { ...plan, route: plan.route.filter((id) => alive.has(id)), goalNodes: plan.goalNodes.filter((id) => alive.has(id)) };
    }
  }, true);
  return true;
}

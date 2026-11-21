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
/**
 * 道と地点を消す。地点を消すのは nodeIds に入れたもの（選んだ地点）だけ。道を消して、どこにもつながらなくなった地点は残す
 * （ユーザーの指摘: 両端に地点のある道を消すと地点まで消えた）。pruneOrphans は下書きの一括除外用で、つながらなくなった分岐点・境界点も消す
 */
export function removeSelection(ed: Ed, edgeIds: string[], nodeIds: string[], opts: { pruneOrphans?: boolean } = {}): boolean {
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
    // 通りかかる人の通る道からも外す（ユーザーの指定: ない道を指す設定は自動で消してよい）
    const sc = ed.p.scenario;
    if (sc.passersby) sc.passersby = sc.passersby.map((ps) => ({ ...ps, edges: ps.edges.filter((x) => !ids.has(x)) })).filter((ps) => ps.edges.length > 0);
    ed.p.editorState.draftEdgeIds = ed.p.editorState.draftEdgeIds.filter((x) => !ids.has(x));
    // 下書きの一括除外では、どの道にもつながらなくなった分岐点（手で置いたものを除く）と境界点も消す
    const used = new Set(map.edges.flatMap((e) => [e.from, e.to ?? '']));
    map.nodes = map.nodes.filter((n) => !nodeSet.has(n.id) && (!opts.pruneOrphans || used.has(n.id) || (n.type === 'junction' ? n.source === 'manual' : n.type !== 'boundary')));
    if (inPlan.length > 0) {
      const alive = new Set(map.nodes.map((n) => n.id));
      ed.p.scenario.plan = { ...plan, route: plan.route.filter((id) => alive.has(id)), goalNodes: plan.goalNodes.filter((id) => alive.has(id)) };
    }
  }, true);
  return true;
}

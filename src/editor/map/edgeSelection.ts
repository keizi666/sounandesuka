/**
 * 道の複数選択（ユーザーの指定: OSM から取り込んだ道を、矩形で囲んで・クリックで選んで、Delete キーか削除ボタンで消す）。
 * 選択は保存しない（編集中だけ）。1 本だけ選んだときは、これまでどおり editorState.selection も使う。
 */
export const edgeSel = {
  /** 選んでいる道の ID */
  ids: new Set<string>(),
  /** ドラッグ中の矩形（ワールド座標 m） */
  box: null as { x0: number; z0: number; x1: number; z1: number } | null,
};

export function clearEdgeSel(): void {
  edgeSel.ids.clear();
  edgeSel.box = null;
}

/**
 * 天候のタイムラインの上の帯（ボタン・操作のしかた・行の選択）と、下の左右のつまみ。
 * 見た目の状態（たたむ・出す行・操作のしかたを開くか）は、この端末に覚えておく（失っても既定に戻るだけ）。
 */
import { el } from '../../ui/dom';
import type { RowDef } from './timelineRows';

const KEY = 'hks.ed.timeline';

export interface TimelinePrefs {
  collapsed: boolean;
  rows: string[];
  help: boolean;
}

/** 最初に出す行（主なもの）。ほかは「行を選ぶ」から */
export const DEFAULT_ROWS = ['tempC', 'windMs', 'precipMmH', 'cloudCover', 'cloudBaseM', 'visibilityM'];

export function loadPrefs(): TimelinePrefs {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TimelinePrefs> | null;
    if (j) return { collapsed: Boolean(j.collapsed), rows: Array.isArray(j.rows) && j.rows.length > 0 ? j.rows : DEFAULT_ROWS, help: j.help !== false };
  } catch {
    // 読めなければ既定
  }
  return { collapsed: false, rows: DEFAULT_ROWS, help: true };
}

export function savePrefs(p: TimelinePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 保存できなくても動く
  }
}

export interface BarActions {
  add(): void;
  remove(): void;
  zoom(f: number): void;
  fit(): void;
  toggleCollapse(): void;
  toggleHelp(): void;
  setRows(keys: string[]): void;
}

export interface BarState {
  collapsed: boolean;
  help: boolean;
  rows: string[];
  selectedCount: number;
  zoomed: boolean;
  cursorLabel: string;
}

const HELP: [string, string][] = [
  ['値を変える', '線の上の点をつかんで上下にドラッグ（動かした量だけ変わる。Shift を押すと細かく）。点をクリックすると右の欄で数値を打ち込めます'],
  ['時刻を動かす', 'いちばん上の四角をつかんで左右にドラッグ（5 分刻み）'],
  ['追加', '空いた所をダブルクリック、または「＋ 追加」（緑の線の時刻に、その時刻の値で足します）'],
  ['削除', '点か四角をクリックして選び、Delete キーか「削除」'],
  ['時刻を合わせる', '空いた所をクリック（緑の線。右の「確認地点の局地値」がその時刻になります）'],
  ['拡大・移動', 'Ctrl＋ホイールで拡大・縮小、Shift＋ホイールか下のつまみで左右に動かす'],
  ['まとめて選ぶ', 'いちばん上の帯を Shift を押しながらドラッグ'],
];

export function buildBar(rows: readonly RowDef[], st: BarState, a: BarActions): HTMLElement {
  const btn = (label: string, title: string, onclick: () => void, opts: { disabled?: boolean; cls?: string } = {}): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: `wtl-btn ${opts.cls ?? ''}`, title, onclick }, label);
    b.disabled = Boolean(opts.disabled);
    return b;
  };
  const menu = el('details', { class: 'wtl-rows' }, [
    el('summary', { class: 'wtl-btn', title: '出す行（変数）を選ぶ' }, `行を選ぶ（${st.rows.length}/${rows.length}）`),
    el(
      'div',
      { class: 'wtl-rows-list' },
      rows.map((r) => {
        const c = el('input', { type: 'checkbox', checked: st.rows.includes(r.key as string) });
        c.addEventListener('change', () => {
          const next = rows.map((x) => x.key as string).filter((k) => (k === r.key ? c.checked : st.rows.includes(k)));
          if (next.length > 0) a.setRows(next);
        });
        return el('label', {}, [c, r.label]);
      }),
    ),
  ]);
  const bar = el('div', { class: 'wtl-bar' }, [
    el('strong', { class: 'wtl-title', title: 'クリックでたたむ・開く', onclick: () => a.toggleCollapse() }, `${st.collapsed ? '▸' : '▾'} 天候のタイムライン`),
    btn(st.collapsed ? '開く ▴' : 'たたむ ▾', st.collapsed ? 'タイムラインを開く' : 'タイムラインをたたむ（地図を広く見る）', a.toggleCollapse, { cls: 'wtl-collapse' }),
    st.collapsed
      ? el('span', { class: 'wtl-note' }, 'たたんでいます（開くと時刻ごとの気温・風・雨などを編集できます）')
      : el('span', { class: 'wtl-tools' }, [
          btn('＋ 追加', `緑の線の時刻（${st.cursorLabel}）にキーフレームを足す`, a.add),
          btn(st.selectedCount > 1 ? `削除（${st.selectedCount}）` : '削除', '選んだキーフレームを消す（Delete キーでも）', a.remove, { disabled: st.selectedCount === 0 }),
          el('span', { class: 'wtl-sep' }),
          btn('−', '縮小（Ctrl＋ホイールでも）', () => a.zoom(1.6)),
          btn('＋', '拡大（Ctrl＋ホイールでも）', () => a.zoom(1 / 1.6)),
          btn('全体', '全体を表示', a.fit, { disabled: !st.zoomed }),
          el('span', { class: 'wtl-sep' }),
          menu,
          btn(st.help ? '操作のしかたを隠す' : '？ 操作のしかた', '操作のしかたを出す・隠す', a.toggleHelp),
        ]),
  ]);
  if (st.collapsed || !st.help) return bar;
  return el('div', {}, [bar, el('div', { class: 'wtl-help' }, HELP.map(([k, v]) => el('span', {}, [el('b', {}, k), v])))]);
}

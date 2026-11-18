/**
 * 吹き出しの形と配置（docs/11 §8.1、§8.4）。DOM に依存しない純粋関数（tests/bubbleLayout.test.ts）。
 * 尻尾の先端は常に話し手の頭の投影位置を指す。吹き出し本体を動かしても先端は動かない。
 */

export const TAIL_LEN = 10;
export const TAIL_W = 14;
export const HEAD_GAP = 8;
export const MAX_SHIFT_STEPS = 3;
export const MAX_TAIL = 40;
export const EDGE_MARGIN = 8;
export const OVERLAP_PX = 4;

/** 角丸の吹き出しと尻尾を 1 本の輪郭で描く SVG path（左上が原点、尻尾は下辺から tailX の位置で下へ） */
export function bubblePath(w: number, h: number, r: number, tailX: number, tailLen: number, tailW = TAIL_W): string {
  const rr = Math.min(r, h / 2, w / 2);
  const half = tailW / 2;
  // 根元は角丸から 12px 以上内側（幅が狭ければ中央）
  const lo = rr + half + 2;
  const hi = w - rr - half - 2;
  const base = lo <= hi ? Math.min(hi, Math.max(lo, tailX)) : w / 2;
  // 先端は根元から横にずれてよい（tailX がそのまま先端の x）
  const tip = tailX;
  return [
    `M${rr},0`,
    `H${w - rr}`,
    `A${rr},${rr} 0 0 1 ${w},${rr}`,
    `V${h - rr}`,
    `A${rr},${rr} 0 0 1 ${w - rr},${h}`,
    `H${base + half}`,
    `L${tip},${h + tailLen}`,
    `L${base - half},${h}`,
    `H${rr}`,
    `A${rr},${rr} 0 0 1 0,${h - rr}`,
    `V${rr}`,
    `A${rr},${rr} 0 0 1 ${rr},0`,
    'Z',
  ].join(' ');
}

export interface BubbleIn {
  id: string;
  /** 頭の投影位置（画面 px） */
  headX: number;
  headY: number;
  w: number;
  h: number;
  priority: number;
}

export interface BubbleOut {
  id: string;
  /** 本体の左上 */
  x: number;
  y: number;
  /** 本体内での尻尾の先端の x（本体の左端から） */
  tailX: number;
  tailLen: number;
  /** 置けなかった（待ち行列に戻す） */
  hidden: boolean;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w - OVERLAP_PX && b.x < a.x + a.w - OVERLAP_PX && a.y < b.y + b.h - OVERLAP_PX && b.y < a.y + a.h - OVERLAP_PX;
}

/**
 * 重なりを避けて並べる。手前（headY が大きい）順に置き、重なれば上へずらす（最大 3 段、尻尾は最大 40px）。
 * 左右は画面端から 8px 内側に収め、尻尾の先端は頭を指したままにする。
 */
export function layoutBubbles(items: readonly BubbleIn[], viewW: number): BubbleOut[] {
  const order = [...items].sort((a, b) => b.headY - a.headY || b.priority - a.priority);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: BubbleOut[] = [];
  const clampX = (x: number, w: number): number => Math.max(EDGE_MARGIN, Math.min(viewW - EDGE_MARGIN - w, x));
  for (const it of order) {
    const x0 = clampX(it.headX - it.w / 2, it.w);
    // 横へのずらし候補（尻尾の根元は本体の中で動き、先端は頭のまま）
    const dxs = [0, -(it.w / 2 + 4), it.w / 2 + 4, -(it.w + 4), it.w + 4];
    let best: { x: number; y: number; tailLen: number } | null = null;
    let tailLen = TAIL_LEN;
    let y = it.headY - HEAD_GAP - tailLen - it.h;
    for (let step = 0; step <= MAX_SHIFT_STEPS && !best && tailLen <= MAX_TAIL; step += 1) {
      for (const dx of dxs) {
        const x = clampX(x0 + dx, it.w);
        const box = { x, y, w: it.w, h: it.h };
        if (!placed.some((p) => overlaps(box, p))) {
          best = { x, y, tailLen };
          break;
        }
      }
      if (best) break;
      // 上へずらす（重なった相手の上端の上へ）
      const box = { x: x0, y, w: it.w, h: it.h };
      const hit = placed.filter((p) => overlaps(box, p));
      const top = hit.length > 0 ? Math.min(...hit.map((p) => p.y)) : y;
      const dy = Math.max(OVERLAP_PX, box.y + box.h - top + OVERLAP_PX);
      tailLen += dy;
      y -= dy;
    }
    if (!best) {
      out.push({ id: it.id, x: x0, y, tailX: it.headX - x0, tailLen, hidden: true });
      continue;
    }
    placed.push({ x: best.x, y: best.y, w: it.w, h: it.h });
    out.push({ id: it.id, x: best.x, y: best.y, tailX: it.headX - best.x, tailLen: best.tailLen, hidden: false });
  }
  return out;
}

/** 表示時間（実秒）: 2.0 + 0.09 × 文字数、2.5〜7 秒 */
export function bubbleDurationSec(text: string): number {
  return Math.min(7, Math.max(2.5, 2 + 0.09 * [...text].length));
}

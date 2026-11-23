/**
 * QR コードを作る（共有のパネルで、その場にいる人がスマホで読んで同じ場面から始められるように。ユーザーの指定）。
 * 依存を足さずに自作する: バイトモード、誤り訂正レベル M、型番 1〜10（M で 213 バイトまで。短い URL なら十分）。
 * 作り方は JIS X 0510 / ISO/IEC 18004 のとおり（データ符号化 → リード・ソロモン → 配置 → マスクの評価 → 形式情報・型番情報）。
 */

/** 型番ごとの、誤り訂正レベル M のブロック構成: [誤り訂正の語数, [ブロック数, データの語数][]] */
const BLOCKS_M: [number, [number, number][]][] = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];
/** 位置合わせパターンの中心（型番 2〜10） */
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- GF(256) と リード・ソロモン ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** 次数 n の生成多項式（係数は高次から。先頭の 1 は省く） */
function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) {
      next[j] = next[j]! ^ g[j]!;
      next[j + 1] = next[j + 1]! ^ mul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g.slice(1);
}

function rsRemainder(data: number[], n: number): number[] {
  const g = generator(n);
  const rem = new Array<number>(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < n; i += 1) rem[i] = rem[i]! ^ mul(g[i]!, factor);
  }
  return rem;
}

// ---- データの符号化 ----
function encodeData(bytes: Uint8Array, version: number): number[] {
  const [, groups] = BLOCKS_M[version - 1]!;
  const capacity = groups.reduce((s, [n, d]) => s + n * d, 0);
  const bits: number[] = [];
  const push = (v: number, len: number): void => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((v >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; words.length < capacity; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** ブロックに分けて誤り訂正を付け、交互に並べる */
function interleave(words: number[], version: number): number[] {
  const [ec, groups] = BLOCKS_M[version - 1]!;
  const blocks: number[][] = [];
  let k = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i += 1) {
    blocks.push(words.slice(k, k + d));
    k += d;
  }
  const ecs = blocks.map((b) => rsRemainder(b, ec));
  const out: number[] = [];
  const maxD = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxD; i += 1) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i += 1) for (const e of ecs) out.push(e[i]!);
  return out;
}

// ---- 配置 ----
interface Grid {
  size: number;
  dark: boolean[][];
  fixed: boolean[][];
}

function newGrid(version: number): Grid {
  const size = 17 + 4 * version;
  return { size, dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) };
}

function set(g: Grid, x: number, y: number, dark: boolean): void {
  g.dark[y]![x] = dark;
  g.fixed[y]![x] = true;
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  // タイミングパターン
  for (let i = 0; i < n; i += 1) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }
  // 位置検出パターン（と分離帯）
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]] as const) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(g, x, y, d !== 2 && d !== 4);
    }
  }
  // 位置合わせパターン
  const pos = ALIGN[version - 1]!;
  for (const ay of pos) for (const ax of pos) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === pos[pos.length - 1]) || (ax === pos[pos.length - 1] && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(g, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // 形式情報・型番情報の場所を先に取っておく（あとで書く）
  drawFormat(g, 0);
  if (version >= 7) drawVersion(g, version);
}

/** 形式情報（誤り訂正レベル M = 00、マスク番号）を書く */
function drawFormat(g: Grid, mask: number): void {
  const n = g.size;
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) set(g, 8, i, bit(i));
  set(g, 8, 7, bit(6));
  set(g, 8, 8, bit(7));
  set(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) set(g, n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(g, 8, n - 15 + i, bit(i));
  set(g, 8, n - 8, true); // 常に暗いモジュール
}

function drawVersion(g: Grid, version: number): void {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i += 1) {
    const b = ((bits >>> i) & 1) === 1;
    const a = g.size - 11 + (i % 3);
    const c = Math.floor(i / 3);
    set(g, a, c, b);
    set(g, c, a, b);
  }
}

function drawCodewords(g: Grid, data: number[]): void {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert += 1) for (let j = 0; j < 2; j += 1) {
      const x = right - j;
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? n - 1 - vert : vert;
      if (g.fixed[y]![x]) continue;
      if (i < data.length * 8) g.dark[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
      i += 1;
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): void {
  const f = MASKS[mask]!;
  for (let y = 0; y < g.size; y += 1) for (let x = 0; x < g.size; x += 1) if (!g.fixed[y]![x] && f(x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/** マスクの評価（失点。小さいほど読みやすい） */
function penalty(g: Grid): number {
  const n = g.size;
  const d = g.dark;
  let p = 0;
  // 1: 同じ色が 5 つ以上続く
  for (let y = 0; y < n; y += 1) for (const horizontal of [true, false]) {
    let run = 1;
    for (let i = 1; i <= n; i += 1) {
      const same = i < n && (horizontal ? d[y]![i] === d[y]![i - 1] : d[i]?.[y] === d[i - 1]![y]);
      if (same) run += 1;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
  }
  // 2: 2×2 の同じ色
  for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) {
    const c = d[y]![x];
    if (c === d[y]![x + 1] && c === d[y + 1]![x] && c === d[y + 1]![x + 1]) p += 3;
  }
  // 3: 位置検出パターンに似た並び（1:1:3:1:1 と 4 つの明）
  const pat = [true, false, true, true, true, false, true];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) for (const horizontal of [true, false]) {
    const at = (k: number): boolean | undefined => (horizontal ? d[y]![x + k] : d[y + k]?.[x]);
    if (pat.every((v, k) => at(k) === v)) {
      const before = [-4, -3, -2, -1].every((k) => at(k) === false || at(k) === undefined);
      const after = [7, 8, 9, 10].every((k) => at(k) === false || at(k) === undefined);
      if (before || after) p += 40;
    }
  }
  // 4: 暗い割合が 50% から離れる
  let darkCount = 0;
  for (const row of d) for (const v of row) if (v) darkCount += 1;
  p += Math.floor(Math.abs((darkCount * 20) / (n * n) - 10)) * 10;
  return p;
}

/** text の QR コード（暗いモジュールが true の正方形の並び）。長すぎるときは null */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= BLOCKS_M.length; v += 1) {
    const cap = BLOCKS_M[v - 1]![1].reduce((s, [n, d]) => s + n * d, 0);
    const need = Math.ceil((4 + (v < 10 ? 8 : 16) + bytes.length * 8) / 8);
    if (need <= cap) {
      version = v;
      break;
    }
  }
  if (version === 0) return null;
  const data = interleave(encodeData(bytes, version), version);
  let best: Grid | null = null;
  let bestP = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const g = newGrid(version);
    drawFunctionPatterns(g, version);
    drawCodewords(g, data);
    applyMask(g, mask);
    drawFormat(g, mask);
    const p = penalty(g);
    if (p < bestP) {
      bestP = p;
      best = g;
    }
  }
  return best!.dark;
}

/** QR コードを canvas に描く（まわりに 4 モジュールの余白。px は 1 モジュールの大きさ） */
export function qrCanvas(text: string, px = 6): HTMLCanvasElement | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const quiet = 4;
  const size = (m.length + quiet * 2) * px;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000';
  for (let y = 0; y < m.length; y += 1) for (let x = 0; x < m.length; x += 1) if (m[y]![x]) g.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
  return c;
}

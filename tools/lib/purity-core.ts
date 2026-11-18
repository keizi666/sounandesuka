/**
 * src/sim の禁止 API 検査（CLAUDE.md 鉄則 1・3・8、docs/13 P0）。
 * コメントは無視し、識別子の規則は文字列の中身も無視する（import の規則だけは文字列を見る）。
 * 正規表現リテラルの中の引用符は考慮しない（sim では使わない前提の簡易スキャナ）。
 */

export interface PurityRule {
  id: string;
  /** true なら文字列を残したソースで検査する（import 先の判定用） */
  needsStrings?: boolean;
  /** このパスのファイルでは許す */
  allowIn?: RegExp;
  pattern: RegExp;
  message: string;
}

export interface PurityViolation {
  file: string;
  line: number;
  col: number;
  rule: string;
  message: string;
  text: string;
}

const THREE_SPEC = String.raw`['"]three(?:\/[^'"]*)?['"]`;

export const PURITY_RULES: readonly PurityRule[] = [
  { id: 'math-random', pattern: /\bMath\s*\.\s*random\b/g, message: 'Math.random は禁止。World.rng のストリームを使う' },
  { id: 'date-now', pattern: /\bDate\s*\.\s*now\b/g, message: 'Date.now は禁止（時刻依存）' },
  { id: 'new-date-now', pattern: /\bnew\s+Date\s*\(\s*\)/g, message: '引数なしの new Date() は禁止（時刻依存）' },
  { id: 'performance-now', pattern: /\bperformance\b/g, message: 'performance は禁止（時刻依存）' },
  {
    id: 'three-import',
    needsStrings: true,
    pattern: new RegExp(String.raw`\bfrom\s*${THREE_SPEC}|\bimport\s*\(\s*${THREE_SPEC}|\bimport\s+${THREE_SPEC}|\brequire\s*\(\s*${THREE_SPEC}`, 'g'),
    message: 'three の import は禁止（sim は描画に依存しない）',
  },
  { id: 'document', pattern: /\bdocument\b/g, message: 'document は禁止（DOM 非依存）' },
  { id: 'window', pattern: /\bwindow\b/g, message: 'window は禁止（DOM 非依存）' },
  { id: 'navigator', pattern: /\bnavigator\b/g, message: 'navigator は禁止（DOM 非依存）' },
  { id: 'storage', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/g, message: 'ブラウザの保存領域は禁止（保存は app 層）' },
  { id: 'fetch', pattern: /\bfetch\b/g, message: 'fetch は禁止（sim は通信しない）' },
  { id: 'xhr', pattern: /\b(?:XMLHttpRequest|WebSocket|EventSource)\b/g, message: '通信 API は禁止（sim は通信しない）' },
  {
    id: 'transcendental',
    allowIn: /(?:^|\/)core\/dmath\.ts$/,
    pattern: /\bMath\s*\.\s*(?:sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/g,
    message: '超越関数は core/dmath.ts の関数を使う（NFR-04 決定論）',
  },
  { id: 'exponent-op', pattern: /\*\*/g, message: '** 演算子は使わず dpow を使う（NFR-04 決定論）' },
];

export interface MaskedSource {
  /** コメントを空白に置き換えたもの（文字列は残す） */
  noComments: string;
  /** コメントと文字列の中身を空白に置き換えたもの */
  codeOnly: string;
}

/** コメントと文字列を、改行と桁位置を保ったまま空白に置き換える */
export function maskSource(src: string): MaskedSource {
  const a = src.split('');
  const b = src.split('');
  const blank = (arr: string[], i: number): void => {
    if (arr[i] !== '\n' && arr[i] !== '\r') arr[i] = ' ';
  };
  // 文脈スタック: 'code'（波括弧の深さつき）と 'template'
  const stack: { kind: 'code' | 'template'; depth: number }[] = [{ kind: 'code', depth: 0 }];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const top = stack[stack.length - 1]!;
    const ch = src[i]!;
    const next = src[i + 1];
    if (top.kind === 'template') {
      if (ch === '\\') {
        blank(b, i);
        if (i + 1 < n) blank(b, i + 1);
        i += 2;
      } else if (ch === '`') {
        stack.pop();
        i += 1;
      } else if (ch === '$' && next === '{') {
        stack.push({ kind: 'code', depth: 0 });
        i += 2;
      } else {
        blank(b, i);
        i += 1;
      }
      continue;
    }
    // code
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        blank(a, i);
        blank(b, i);
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i += 1) {
        blank(a, i);
        blank(b, i);
      }
    } else if (ch === '"' || ch === "'") {
      i += 1;
      while (i < n && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') {
          blank(b, i);
          i += 1;
        }
        if (i < n) blank(b, i);
        i += 1;
      }
      i += 1;
    } else if (ch === '`') {
      stack.push({ kind: 'template', depth: 0 });
      i += 1;
    } else if (ch === '{') {
      top.depth += 1;
      i += 1;
    } else if (ch === '}') {
      if (top.depth === 0 && stack.length > 1) stack.pop();
      else top.depth -= 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return { noComments: a.join(''), codeOnly: b.join('') };
}

function lineCol(src: string, index: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let k = 0; k < index; k += 1) {
    if (src.charCodeAt(k) === 10) {
      line += 1;
      last = k;
    }
  }
  return { line, col: index - last };
}

export function findViolations(source: string, file: string): PurityViolation[] {
  const masked = maskSource(source);
  const lines = source.split('\n');
  const out: PurityViolation[] = [];
  for (const rule of PURITY_RULES) {
    if (rule.allowIn?.test(file.replaceAll('\\', '/'))) continue;
    const text = rule.needsStrings ? masked.noComments : masked.codeOnly;
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      const { line, col } = lineCol(text, m.index);
      out.push({ file, line, col, rule: rule.id, message: rule.message, text: (lines[line - 1] ?? '').trim() });
    }
  }
  return out.sort((x, y) => x.line - y.line || x.col - y.col);
}

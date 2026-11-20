/**
 * 「みんなの遭難記録」の投稿の決まり（docs/20_community.md §4）。
 * 画面での事前の確かめと、開発用の模擬 API（tools/devApi.ts）で使う。サーバー（server/api/lib.php）にも同じ値を書いている。
 * 値を変えたら lib.php も直すこと。
 */

/** ニックネームの最大文字数 */
export const NICK_MAX = 12;
/** 感想の最大文字数 */
export const COMMENT_MAX = 200;
/** 感想の最大行数 */
export const COMMENT_MAX_LINES = 6;
/** 記録（gzip + base64）の最大バイト数 */
export const RECORD_MAX_BYTES = 600_000;
/** 通報がこの件数に達したら自動で隠す */
export const REPORT_HIDE = 3;

/** 性別（x = 答えない） */
export const SEXES = ['m', 'f', 'x'] as const;
export type Sex = (typeof SEXES)[number];
/** 年代（x = 答えない） */
export const AGE_BANDS = ['10', '20', '30', '40', '50', '60', '70', 'x'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** アイコンの枠の色 */
export const PROFILE_COLORS = ['#38bdf8', '#f97316', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#14b8a6', '#64748b'] as const;

/** 既定の NG ワード（サーバーではこれに data/ngwords.txt を足す）。比べる前に正規化（normalizeText）する */
export const NG_WORDS: readonly string[] = [
  // 「少しねむい」のように普通の文に出る並び（しね・がいじ など）は入れない
  '死ね', '氏ね', '殺すぞ', 'ころすぞ', '殺してやる', 'ころしてやる', 'キモい', 'ガイジ',
  'ちんこ', 'ちんぽ', 'まんこ', 'セックス', 'せっくす', 'fuck', 'shit', 'bitch', 'nigger',
];

/** URL・ドメインらしきもの（宣伝の書き込みを断る） */
export const URL_RE = /(https?:|www\.|[a-z0-9-]+\.(com|net|org|jp|io|co|xyz|info|biz|me|ly|ru|cn|top|site|app|dev)\b)/i;

/** 比べるための正規化（全角英数を半角に、小文字に、空白を詰める） */
export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** NG ワードを含むか */
export function hasNgWord(s: string, extra: readonly string[] = []): boolean {
  const n = normalizeText(s);
  return [...NG_WORDS, ...extra].some((w) => w !== '' && n.includes(normalizeText(w)));
}

/** 制御文字（改行・タブ以外） */
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/;

export type RuleError = 'nickEmpty' | 'nickLong' | 'commentLong' | 'commentLines' | 'ngWord' | 'url' | 'badChar';

/** ニックネームを確かめる（null = よい） */
export function checkNickname(raw: string): RuleError | null {
  const s = raw.trim();
  if (s === '') return 'nickEmpty';
  if ([...s].length > NICK_MAX) return 'nickLong';
  if (CTRL_RE.test(s) || /[\r\n\t]/.test(s)) return 'badChar';
  if (URL_RE.test(s.normalize('NFKC'))) return 'url';
  if (hasNgWord(s)) return 'ngWord';
  return null;
}

/** 感想を確かめる（空はよい） */
export function checkComment(raw: string): RuleError | null {
  const s = raw.trim();
  if (s === '') return null;
  if ([...s].length > COMMENT_MAX) return 'commentLong';
  if (s.split('\n').length > COMMENT_MAX_LINES) return 'commentLines';
  if (CTRL_RE.test(s)) return 'badChar';
  if (URL_RE.test(s.normalize('NFKC'))) return 'url';
  if (hasNgWord(s)) return 'ngWord';
  return null;
}

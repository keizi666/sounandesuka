/**
 * AI に渡すプロンプトの付録: シナリオ形式の説明（docs/09_scenario_format.md）、地点と道の説明（docs/04 §5）、型の定義（src/sim/types.ts の JSON の部分）。
 * どちらもビルド時に文字列として埋め込み（Vite の ?raw）、手で書き写さない（仕様を変えればプロンプトも変わる）。
 * 型は、JSON に書く部分（マップ定義・シナリオ定義・条件・アクション・分岐点・イベント・結末など）だけを抜き出し、
 * シミュレーションの実行時の状態（World など）は入れない。純粋な関数（テストできる）。
 */
import mapTerrainMd from '../../docs/04_map_terrain.md?raw';
import scenarioFormatMd from '../../docs/09_scenario_format.md?raw';
import typesSrc from '../sim/types.ts?raw';

/** 区切りの行（`// ---------- 名前 ----------`）から次の区切りの行の前まで */
export function typesSection(src: string, name: string): string {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('// ----------') && l.includes(name));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && l.startsWith('// ----------'));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trimEnd();
}

/** `export type 名前` / `export interface 名前` の宣言を 1 つ（直前のコメントを含む）。次の空行・宣言・区切りの前まで */
export function typeDecl(src: string, name: string): string {
  const lines = src.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^export (type|interface) ${name}\\b`).test(l));
  if (at < 0) return '';
  let from = at;
  while (from > 0 && /^(\/\*\*| \*|\s*\/\/)/.test(lines[from - 1]!) && !lines[from - 1]!.startsWith('// ----------')) from -= 1;
  let to = at + 1;
  while (to < lines.length && lines[to]!.trim() !== '' && !/^(export |\/\*\*|\/\/ ----------)/.test(lines[to]!)) to += 1;
  return lines.slice(from, to).join('\n');
}

/** 宣言を 1 つ取り除く（実行時だけの型を付録から外す） */
function dropDecl(section: string, name: string): string {
  const d = typeDecl(section, name);
  return d ? section.replace(`${d}\n`, '') : section;
}

/** JSON に書く部分の型定義（TypeScript） */
export function jsonTypes(src: string = typesSrc): string {
  const parts = [
    typesSection(src, '基本'),
    typesSection(src, 'マップ定義（JSON）'),
    typesSection(src, 'シナリオ定義（JSON）'),
    typesSection(src, '条件 DSL'),
    typesSection(src, 'アクション'),
    typesSection(src, '分岐点'),
    typesSection(src, 'イベント'),
    dropDecl(typesSection(src, '野生動物'), 'AnimalState'),
    // 条件・アクションが参照する実行時の列挙
    ['// ---------- 条件・アクションが参照する列挙（実行時の型から） ----------', ...['BehaviorState', 'InjuryKind', 'IllnessKind', 'SimEventType'].map((n) => typeDecl(src, n))].join('\n'),
    ['// ---------- バンドル（マップとシナリオを 1 つのファイルに） ----------', typeDecl(src, 'SounanBundle')].join('\n'),
  ];
  return parts.filter((p) => p.trim() !== '').join('\n\n');
}

/** 設計書の Markdown を付録に入れる形に: 最初の大見出し（# …）を除き、ほかの見出しを 1 段下げる */
export function formatDoc(md: string = scenarioFormatMd): string {
  return md
    .split(/\r?\n/)
    .filter((l) => !/^# /.test(l))
    .map((l) => (/^#{1,5} /.test(l) ? `#${l}` : l))
    .join('\n')
    .trim();
}

/** Markdown の見出し（`### 5.1` など、前方一致）から、until の見出しの前まで */
export function mdRange(md: string, from: string, until: string): string {
  const lines = md.split(/\r?\n/);
  const a = lines.findIndex((l) => l.startsWith(from));
  if (a < 0) return '';
  const b = lines.findIndex((l, i) => i > a && l.startsWith(until));
  return lines.slice(a, b < 0 ? lines.length : b).join('\n').trim();
}

/** 地点・道・分岐の紛らわしさの説明（設計書 docs/04 §5.1〜5.3） */
export function mapNodesEdgesDoc(md: string = mapTerrainMd): string {
  return formatDoc(mdRange(md, '### 5.1', '### 5.4'));
}

/** 付録（形式の説明と型の定義）の行 */
export function specAppendix(): string[] {
  return [
    '## 付録 A: シナリオ形式の説明（設計書 docs/09 の写し）',
    '',
    '設計書の中のファイル名（`scenario/conditions.ts` など）や `npm run …` は、このシミュレーターのソースの話です。あなたは読めなくてかまいません。形式の説明として読んでください。',
    '',
    formatDoc(),
    '',
    '## 付録 B: 地点と道（設計書 docs/04 §5 の写し）',
    '',
    mapNodesEdgesDoc(),
    '',
    '## 付録 C: 型の定義（TypeScript。JSON に書く部分だけ。付録 A と食い違うときはこちらが正）',
    '',
    '```ts',
    jsonTypes(),
    '```',
  ];
}

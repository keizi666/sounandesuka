/**
 * プレースホルダの展開（docs/09 §5）: `{path}` または `{path:小数桁}`。
 * 列挙値の日本語は i18n にあるので、呼び出し側が labels で渡す（sim は i18n に依存しない）。
 */
import type { VarValue } from './vars';

export const PLACEHOLDER_RE = /\{([A-Za-z_][\w.]*)(?::(\d))?\}/g;

export interface TextLabels {
  precipType?: Record<string, string>;
  state?: Record<string, string>;
  injury?: Record<string, string>;
  stage?: Record<string, string>;
  bool?: { true: string; false: string };
}

/** パスごとに値の種類を見て日本語にする */
function labelFor(path: string, v: VarValue, labels: TextLabels): string | undefined {
  if (typeof v === 'boolean') return labels.bool ? labels.bool[v ? 'true' : 'false'] : undefined;
  if (typeof v !== 'string') return undefined;
  if (path.endsWith('precipType')) return labels.precipType?.[v];
  if (path.endsWith('.state') || path === 'state') return labels.state?.[v];
  if (path.endsWith('injury')) return labels.injury?.[v];
  if (path.endsWith('stage')) return labels.stage?.[v];
  return undefined;
}

/** 展開できないパスはそのまま `{path}` を残す（validate でエラーにする） */
export function expandText(template: string, resolve: (path: string) => VarValue | undefined, labels: TextLabels = {}): string {
  return template.replace(PLACEHOLDER_RE, (whole, path: string, digits: string | undefined) => {
    const v = resolve(path);
    if (v === undefined) return whole;
    if (typeof v === 'number') {
      if (digits !== undefined) return v.toFixed(Number(digits));
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    }
    return labelFor(path, v, labels) ?? String(v);
  });
}

/** 文字列に含まれるプレースホルダのパス */
export function placeholderPaths(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

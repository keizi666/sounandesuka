/**
 * 不具合の記録。実行時のエラーや描画の異常を、コンソールにだけ出す（ユーザーの指定: 画面には帯を出さない）。
 * 同じ内容は 1 回だけ。版を添えるので、そのままコピーして報告できる。
 */
import { versionLabel } from './version';

const seen = new Set<string>();

export function reportProblem(title: string, detail = ''): void {
  const key = `${title}|${detail}`.slice(0, 300);
  if (seen.has(key) || seen.size >= 20) return;
  seen.add(key);
  console.error(`[sounan ${versionLabel()}] ${title}${detail ? `\n${detail}` : ''}`);
}

/** 捕まえられなかったエラーをコンソールに出す */
export function installProblemReporter(): void {
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    reportProblem(`エラー: ${e.message}`, (err?.stack ?? `${e.filename}:${e.lineno}`).split('\n').slice(0, 6).join('\n'));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    reportProblem(`エラー（非同期）: ${String(r?.message ?? e.reason)}`, (r?.stack ?? '').split('\n').slice(0, 6).join('\n'));
  });
}

/**
 * 不具合の表示。実行時のエラーや描画の異常を、画面の上に帯で出す（コンソールを開かなくても原因が分かるように）。
 * 文面はそのままコピーして報告できる。
 */
import { versionLabel } from './version';

let box: HTMLDivElement | null = null;
const seen = new Set<string>();

export function reportProblem(title: string, detail = ''): void {
  const key = `${title}|${detail}`.slice(0, 300);
  if (seen.has(key) || seen.size >= 6) return;
  seen.add(key);
  console.error(`[hakoniwa] ${title}\n${detail}`);
  if (!box) {
    box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:8px;right:8px;top:48px;z-index:9999;max-height:45vh;overflow:auto;padding:10px 12px;border-radius:8px;' +
      'background:rgba(60,16,16,0.95);color:#ffe9e0;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;user-select:text;border:1px solid #c0503a';
    const close = document.createElement('button');
    close.textContent = '×';
    close.style.cssText = 'float:right;background:none;border:none;color:inherit;font-size:16px;cursor:pointer';
    close.onclick = () => {
      box?.remove();
      box = null;
    };
    box.append(close);
    const ver = document.createElement('div');
    ver.textContent = versionLabel();
    ver.style.cssText = 'opacity:0.7;margin-bottom:6px';
    box.append(ver);
    document.body.append(box);
  }
  const p = document.createElement('div');
  p.textContent = `■ ${title}${detail ? `\n${detail}` : ''}`;
  p.style.marginBottom = '8px';
  box.append(p);
}

/** 捕まえられなかったエラーを画面に出す */
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

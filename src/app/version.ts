/**
 * アプリのバージョンと、調査用の詳細ログ。
 * バージョンは「package.json の版 + コミットの短いハッシュ（未コミットの変更があれば *）」。ビルド時（開発サーバーでは起動時）に vite.config.ts が埋め込む。
 */
declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILT__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_BUILT: string = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';

/** 画面に出す短い表記 */
export function versionLabel(): string {
  return `v${APP_VERSION}`;
}

const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

/** 詳細ログ（コンソールに出る）。先頭に起動からの秒数と区分を付ける */
export function dlog(tag: string, ...args: unknown[]): void {
  const sec = ((typeof performance !== 'undefined' ? performance.now() : 0) - t0) / 1000;
  // そのままコピーして貼れるよう、オブジェクトは 1 行の JSON にする
  const text = args.map((a) => {
    if (typeof a !== 'object' || a === null) return String(a);
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  console.log(`[hk ${sec.toFixed(2)}s] ${tag}`, ...text);
}

/** 起動時の環境を記録する */
export function logStartup(page: string): void {
  dlog('起動', {
    page,
    version: APP_VERSION,
    built: APP_BUILT,
    url: location.href,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    window: `${window.innerWidth}x${window.innerHeight}`,
    cores: navigator.hardwareConcurrency,
    language: navigator.language,
  });
}

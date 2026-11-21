import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { devCommunityApi } from './tools/devApi.ts';

const root = import.meta.dirname;

/** バージョン: package.json の版 + コミットの短いハッシュ（未コミットの変更があれば *） */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== '';
    return `${pkg.version}+${hash}${dirty ? '*' : ''}`;
  } catch {
    return pkg.version;
  }
}

/**
 * 開発サーバーの起動のしかた。npm run dev:quiet（--mode quiet）は、ファイルが変わっても画面を自動で読み込み直さない
 * （ユーザーの指定: ほかのセッションがファイルを書き換えるたびに、遊んでいる画面が読み込み直されていた）。別のポート 5282 で動く
 */
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  // 開発サーバーだけ: 「みんなの遭難記録」の API の模擬（本番は server/api の PHP）
  plugins: [devCommunityApi(root)],
  // サブディレクトリに置く場合は VITE_BASE=/sounan/ のように指定する（docs/03 §10）
  base: process.env['VITE_BASE'] ?? '/',
  // 開発サーバーの番号。よく使われる 5173 / 4173 は他のサービスと重なるので避ける（使用中なら起動を止める）
  server: mode === 'quiet' ? { port: 5282, strictPort: true, hmr: false } : { port: 5281, strictPort: true },
  preview: { port: 4281, strictPort: true },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(root, 'index.html'),
        editor: resolve(root, 'editor.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));

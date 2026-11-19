import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  // サブディレクトリに置く場合は VITE_BASE=/sounan/ のように指定する（docs/03 §10）
  base: process.env['VITE_BASE'] ?? '/',
  // 開発サーバーの番号。よく使われる 5173 / 4173 は他のサービスと重なるので避ける（使用中なら起動を止める）
  server: { port: 5281, strictPort: true },
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
});

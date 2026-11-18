import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  // サブディレクトリに置く場合は VITE_BASE=/hakoniwa/ のように指定する（docs/03 §10）
  base: process.env['VITE_BASE'] ?? '/',
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

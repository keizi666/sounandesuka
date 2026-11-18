// npm run check:sim-purity — src/sim 内の禁止 API を検査する（docs/13 P0）
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { findViolations, type PurityViolation } from './lib/purity-core';

const ROOT = resolve(import.meta.dirname, '..');
const SIM_DIR = join(ROOT, 'src', 'sim');
const EXT = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

export function checkSimPurity(dir: string = SIM_DIR): { files: number; violations: PurityViolation[] } {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && EXT.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
  const violations = files.flatMap((f) =>
    findViolations(readFileSync(f, 'utf8'), relative(ROOT, f).replaceAll('\\', '/')),
  );
  return { files: files.length, violations };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const { files, violations } = checkSimPurity();
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.file}:${v.line}:${v.col}  [${v.rule}] ${v.message}\n    ${v.text}`);
    }
    console.error(`\nsim-purity: ${violations.length} 件の違反（${files} ファイル）`);
    process.exit(1);
  }
  console.log(`sim-purity: OK（${files} ファイル）`);
}

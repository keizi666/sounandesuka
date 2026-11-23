// 公開しているシナリオの選択肢には、結果の画面の「選択の振り返り」に出す意味（explain）がある（ユーザーの指定）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScenarioDef } from '../src/sim/types';

const dir = resolve(__dirname, '../public/scenarios');
const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as { id: string; file?: string; bundle?: string }[];

describe('選択肢の意味（explain）', () => {
  for (const e of index) {
    it(`${e.id}: すべての選択肢に意味がある`, () => {
      const s = JSON.parse(readFileSync(resolve(dir, e.file ?? e.bundle!.replace(/\.sounan\.json$/, '.json')), 'utf8')) as ScenarioDef;
      const missing: string[] = [];
      for (const cp of s.choices) for (const o of cp.options) if (!o.explain?.trim()) missing.push(`${cp.id}/${o.id}`);
      for (const [k, g] of Object.entries(s.genericOverrides ?? {})) for (const o of g?.options ?? []) if (!o.explain?.trim()) missing.push(`generic:${k}/${o.id}`);
      expect(missing).toEqual([]);
    });
  }
});

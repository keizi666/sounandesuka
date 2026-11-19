/** エディターの AI プロンプトと、localhost だけで動かす判定 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLocalHost } from '../src/app/local';
import { buildAiPrompt } from '../src/editor/aiPrompt';
import { createFictionalProject } from '../src/editor/store/project';
import type { MapDef } from '../src/sim/types';

const map = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/maps/sounan.json'), 'utf8')) as MapDef;

describe('AI プロンプト', () => {
  const p = createFictionalProject('テスト', map);
  it('ストーリー・使える仕組み・マップの地点と道・検証の手順が入る', () => {
    const t = buildAiPrompt(p, { story: '霧の中で道に迷う', mode: 'agent', real: false });
    expect(t).toContain('霧の中で道に迷う');
    expect(t).toContain('reportMissing');
    expect(t).toContain('illness');
    expect(t).toContain(map.nodes[0]!.id);
    expect(t).toContain('npm run mc');
    expect(t).toContain('人間らしさ');
  });
  it('会話の AI 向けは JSON を返させ、作業の手順（npm）は入れない', () => {
    const t = buildAiPrompt(p, { story: 'x', mode: 'chat', real: false });
    expect(t).toContain('JSON を 1 つだけ返す');
    expect(t).not.toContain('npm run mc');
  });
});

describe('localhost だけ', () => {
  it('手元の名前だけを許す', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '::1', 'app.localhost']) expect(isLocalHost(h)).toBe(true);
    for (const h of ['example.com', 'kzi.jp', 'localhost.example.com', '192.168.1.2']) expect(isLocalHost(h)).toBe(false);
  });
});

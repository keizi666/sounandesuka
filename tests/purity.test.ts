import { describe, expect, it } from 'vitest';
import { findViolations, maskSource } from '../tools/lib/purity-core';
import { checkSimPurity } from '../tools/purity';

const rules = (src: string): string[] => findViolations(src, 'x.ts').map((v) => v.rule);

describe('sim-purity の検出', () => {
  it.each([
    ['const r = Math.random();', 'math-random'],
    ['const t = Date.now();', 'date-now'],
    ['const d = new Date();', 'new-date-now'],
    ['const t = performance.now();', 'performance-now'],
    ["import * as THREE from 'three';", 'three-import'],
    ['import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";', 'three-import'],
    ["const m = await import('three');", 'three-import'],
    ["import 'three';", 'three-import'],
    ['document.body.append(x);', 'document'],
    ['window.addEventListener("x", f);', 'window'],
    ['const r = await fetch(url);', 'fetch'],
    ['localStorage.setItem("a", "b");', 'storage'],
    ['const x = new XMLHttpRequest();', 'xhr'],
    ['const ua = navigator.userAgent;', 'navigator'],
    ['const s = Math.sin(a);', 'transcendental'],
    ['const p = Math.pow(a, 0.6);', 'transcendental'],
    ['const h = Math.hypot(a, b);', 'transcendental'],
    ['const q = a ** 2;', 'exponent-op'],
  ])('%s → %s', (src, rule) => {
    expect(rules(src)).toContain(rule);
  });

  it('超越関数は core/dmath.ts の中でだけ許す', () => {
    const src = 'export const s = Math.sin(1);';
    expect(findViolations(src, 'src/sim/core/dmath.ts')).toEqual([]);
    expect(findViolations(src, 'src/sim/climber/physiology.ts').map((v) => v.rule)).toEqual(['transcendental']);
  });

  it('sqrt・floor・abs などの正確な演算は許す', () => {
    expect(rules('const a = Math.sqrt(x) + Math.floor(y) + Math.abs(z) + Math.min(1, 2);')).toEqual([]);
  });

  it('テンプレート文字列の式の中も検査する', () => {
    expect(rules('const s = `a ${Math.random()} b`;')).toEqual(['math-random']);
    expect(rules('const s = `x ${ {a: 1}.a } ${window.x}`;')).toEqual(['window']);
  });

  it('行と桁を正しく返す', () => {
    const v = findViolations('const a = 1;\n  const b = Date.now();\n', 'f.ts');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ file: 'f.ts', line: 2, col: 13, rule: 'date-now' });
  });
});

describe('sim-purity の誤検出をしない', () => {
  it('コメントは無視する', () => {
    expect(rules('// Math.random() は使わない\n/* document と window */\nconst a = 1;')).toEqual([]);
  });

  it('文字列の中の識別子は無視する', () => {
    expect(rules('const s = "window の外は document";')).toEqual([]);
    expect(rules('const s = `Date.now() と書かない`;')).toEqual([]);
  });

  it('似た名前の識別子は無視する', () => {
    expect(rules('const documented = true; const windowMs = 3; const prefetch = 0;')).toEqual([]);
  });

  it('引数つきの new Date と three 以外の import は許す', () => {
    expect(rules('const d = new Date(0);')).toEqual([]);
    expect(rules("import { x } from './threeish';")).toEqual([]);
  });

  it('maskSource は改行の位置を保つ', () => {
    const src = 'a /* x\ny */ b // c\n"d\\"e" `f${g}h`';
    const m = maskSource(src);
    expect(m.codeOnly.length).toBe(src.length);
    expect(m.codeOnly.split('\n').length).toBe(src.split('\n').length);
    expect(m.codeOnly).toContain('g');
    expect(m.codeOnly).not.toContain('d');
  });
});

describe('src/sim の実ファイル', () => {
  it('違反がない', () => {
    const { files, violations } = checkSimPurity();
    expect(files).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

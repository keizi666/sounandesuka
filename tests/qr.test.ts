// QR コード（共有のパネル）: 長さに合う型番を選び、位置検出パターンと形式情報が正しい（読めることは OpenCV で確かめた。DECISIONS）
import { describe, expect, it } from 'vitest';
import { qrMatrix } from '../src/ui/qr';

describe('qrMatrix', () => {
  it('長さに合わせて型番（大きさ）を選ぶ', () => {
    expect(qrMatrix('A')!.length).toBe(21);
    expect(qrMatrix('https://kzi.jp/sounandesuyo/api/s.php?k=P9A4NXii')!.length).toBe(33);
    expect(qrMatrix('y'.repeat(200))!.length).toBe(57);
    expect(qrMatrix('y'.repeat(300))).toBeNull();
  });
  it('位置検出パターンと、常に暗いモジュールがある', () => {
    const m = qrMatrix('hello')!;
    const n = m.length;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      for (let i = 0; i < 7; i += 1) {
        expect(m[oy]![ox + i]).toBe(true);
        expect(m[oy + 6]![ox + i]).toBe(true);
      }
      expect(m[oy + 3]![ox + 3]).toBe(true);
      expect(m[oy + 1]![ox + 1]).toBe(false);
    }
    expect(m[n - 8]![8]).toBe(true);
  });
  it('左上と右上・左下の形式情報が同じ', () => {
    const m = qrMatrix('https://example.com/')!;
    const n = m.length;
    const a = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => m[y]![8]);
    const b = Array.from({ length: 8 }, (_, i) => m[8]![n - 1 - i]);
    expect(a).toEqual(b);
  });
});

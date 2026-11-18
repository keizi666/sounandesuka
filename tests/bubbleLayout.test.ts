import { describe, expect, it } from 'vitest';
import { bubbleDurationSec, bubblePath, layoutBubbles, HEAD_GAP, MAX_TAIL } from '../src/ui/bubbleLayout';
import { classify, distort } from '../src/sim/climber/speech';

describe('吹き出しの配置', () => {
  it('尻尾の先端は頭を指す（本体が画面端で押し戻されても）', () => {
    const [b] = layoutBubbles([{ id: 'a', headX: 5, headY: 300, w: 120, h: 30, priority: 10 }], 400);
    expect(b!.x).toBe(8);
    expect(b!.x + b!.tailX).toBe(5);
    expect(b!.y + 30 + b!.tailLen + HEAD_GAP).toBe(300);
  });

  it('3 人が同時に話しても重ならない', () => {
    const items = [0, 1, 2].map((i) => ({ id: `c${i}`, headX: 200 + i * 6, headY: 300 + i * 3, w: 140, h: 32, priority: 10 }));
    const out = layoutBubbles(items, 800);
    const vis = out.filter((o) => !o.hidden);
    expect(vis.length).toBe(3);
    for (let i = 0; i < vis.length; i += 1)
      for (let j = i + 1; j < vis.length; j += 1) {
        const a = vis[i]!;
        const b = vis[j]!;
        const sep = a.y + 32 <= b.y + 4 || b.y + 32 <= a.y + 4 || a.x + 140 <= b.x + 4 || b.x + 140 <= a.x + 4;
        expect(sep).toBe(true);
      }
    for (const o of vis) expect(o.tailLen).toBeLessThanOrEqual(MAX_TAIL + 32);
  });

  it('path は閉じていて尻尾の先端を通る', () => {
    const p = bubblePath(120, 30, 12, 40, 10);
    expect(p.endsWith('Z')).toBe(true);
    expect(p).toContain('L40,40');
  });

  it('表示時間は 2.5〜7 秒', () => {
    expect(bubbleDurationSec('あ')).toBe(2.5);
    expect(bubbleDurationSec('あ'.repeat(100))).toBe(7);
  });
});

describe('発話の変形と区分', () => {
  it('構音障害で文が短くなり「…」が入る', () => {
    const s = distort('少し休もうか、寒いね', 1);
    expect(s.startsWith('少')).toBe(true);
    expect(s).not.toContain('寒いね');
    expect(s).toMatch(/…/);
  });

  it('史実シナリオでは記録以外は架空', () => {
    const hist = { historical: {} } as never;
    expect(classify({ documented: true, source: '報告書' }, hist)).toBe('documented');
    expect(classify({ documented: true }, hist)).toBe('fictional');
    expect(classify({ documented: true, source: 'x', distortLevel: 1 }, hist)).toBe('fictional');
    expect(classify({}, {} as never)).toBe('plain');
  });
});

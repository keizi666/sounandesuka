// 「みんなの遭難記録」: 投稿の決まりと、記録の圧縮・復元
import { describe, expect, it } from 'vitest';
import { packRecord, slimRecord, unpackRecord } from '../src/net/recordPack';
import { formatCode, parseCode } from '../src/net/profile';
import { checkComment, checkNickname, COMMENT_MAX, EMOJIS, NICK_MAX, parseIcon } from '../src/net/rules';
import type { RunRecord } from '../src/sim/types';

describe('投稿の決まり', () => {
  it('ニックネーム', () => {
    expect(checkNickname('やまのぼり')).toBeNull();
    expect(checkNickname('  ')).toBe('nickEmpty');
    expect(checkNickname('あ'.repeat(NICK_MAX + 1))).toBe('nickLong');
    expect(checkNickname('a\nb')).toBe('badChar');
    expect(checkNickname('ｗｗｗ．ｅｘａｍｐｌｅ')).toBe('url');
  });
  it('感想', () => {
    expect(checkComment('')).toBeNull();
    expect(checkComment('少しねむい。早めに引き返すべきだった')).toBeNull();
    expect(checkComment('あ'.repeat(COMMENT_MAX + 1))).toBe('commentLong');
    expect(checkComment('1\n2\n3\n4\n5\n6\n7')).toBe('commentLines');
    expect(checkComment('詳しくは https://x.test で')).toBe('url');
    expect(checkComment('see example.com')).toBe('url');
    expect(checkComment('ＦＵＣＫ')).toBe('ngWord');
    expect(checkComment('a‮b')).toBe('badChar');
  });
  it('アイコンの値', () => {
    expect(parseIcon('mid_m:3')).toEqual({ kind: 'portrait', value: 'mid_m:3' });
    expect(parseIcon('emoji:' + EMOJIS[0])).toEqual({ kind: 'emoji', emoji: EMOJIS[0] });
    expect(parseIcon('emoji:💩')).toBeNull();
    expect(parseIcon('img:0123456789')).toEqual({ kind: 'img', version: '0123456789' });
    expect(parseIcon('img:../../x')).toBeNull();
    expect(new Set(EMOJIS).size).toBe(EMOJIS.length);
  });
  it('絵文字の一覧はサーバーと同じ', async () => {
    const { readFileSync } = await import('node:fs');
    const php = readFileSync(new URL('../server/api/lib.php', import.meta.url), 'utf8');
    const m = /const EMOJIS = \[(.*?)\];/.exec(php);
    expect(m?.[1]?.split(', ').map((x) => x.slice(1, -1))).toEqual([...EMOJIS]);
  });
  it('引き継ぎコード', () => {
    const t = 'ABCDEF0123456789GHJKMNPQ';
    expect(formatCode(t)).toBe('ABCDEF-012345-6789GH-JKMNPQ');
    expect(parseCode(' abcdef-012345-6789gh-jkmnpq ')).toBe(t);
    expect(parseCode('ABC')).toBeNull();
  });
});

describe('記録の圧縮', () => {
  const rec: RunRecord = {
    scenarioId: 's01_cold_front',
    seed: 1,
    samples: [
      {
        t: 300.123,
        climbers: [{ id: 'a', x: 10.4, z: -3.6, elevM: 1500.2, coreC: 36.987, glycogenKcal: 1200.4, waterDeficitL: 0.123, fatigue: 12.34, wetness: 0.456, anxiety: 3.21, J: 0.876, M: 0.9, state: 'WALKING' }],
        local: { tempC: 8.26, windMs: 5.55, precipMmH: 1.04, precipType: 'rain', visibilityM: 800.4, thunder: 0, windChillC: 4.44 },
      },
    ],
    decisions: [{ cpId: 'cp1', title: '分岐', tMin: 310.04, optionId: 'go', label: '進む', by: 'user', tags: [] }],
    events: [
      { tMin: 320, type: 'FALL', climberId: 'a', text: '転んだ', data: { big: 1 } },
      { tMin: 321, type: 'SPEECH', text: '寒い' },
    ],
    track: [[10.4, -3.6], [30.6, 5.5]],
    stats: { minCoreC: 36.9, maxAnxiety: 3, fallCount: 1, rainwearDelayMin: 0, wasLost: false, lostMinutes: 0, darkMinutesMoving: 0, rescueCalledAt: null, distanceM: 1234 },
    ending: null,
  };
  it('要らない出来事を落とし、数値を丸める', () => {
    const s = slimRecord(rec);
    expect(s.events.map((e) => e.type)).toEqual(['FALL']);
    expect(s.events[0]).not.toHaveProperty('data');
    expect(s.track).toEqual([[10, -4], [31, 6]]);
    expect(s.samples[0]!.climbers[0]!.coreC).toBe(36.99);
  });
  it('gzip + base64 で往復できる', async () => {
    const b64 = await packRecord(rec);
    expect(b64.startsWith('H4sI')).toBe(true);
    const back = await unpackRecord(b64);
    expect(back).toEqual(slimRecord(rec));
  });
});

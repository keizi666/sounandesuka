// 分岐点の「選ぶ人」の検査（s06 のスマホの分岐が由美さんの分岐として出た不具合の再発防止）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkChoosers } from '../src/sim/scenario/validateChooser';
import type { ScenarioDef } from '../src/sim/types';

const load = (): ScenarioDef => JSON.parse(readFileSync(resolve(__dirname, '../public/scenarios/real/s06_sekirou.json'), 'utf8')) as ScenarioDef;

describe('checkChoosers', () => {
  it('今の s06 には警告がない', () => {
    expect(checkChoosers(load())).toEqual([]);
  });

  it('一人に向いた分岐点の group を外すと、そのグループをすすめる警告が出る', () => {
    const s = load();
    const cp = s.choices.find((c) => c.id === 'cp_phone_notice')!;
    delete cp.group;
    const got = checkChoosers(s);
    expect(got).toHaveLength(1);
    expect(got[0]!.message).toContain('"dad"');
    expect(got[0]!.message).toContain('由美');
  });

  it('グループ全体に効く行動がある分岐点は警告しない', () => {
    const s = load();
    const cp = s.choices.find((c) => c.id === 'cp_phone_notice')!;
    delete cp.group;
    cp.options[0]!.actions.push({ type: 'rest', minutes: 5 });
    expect(checkChoosers(s)).toEqual([]);
  });
});

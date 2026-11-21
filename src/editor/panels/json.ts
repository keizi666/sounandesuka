/**
 * { } JSON タブ（docs/18 §7）: マップとシナリオの JSON をテキストで編集する。「適用」で解析・検証し、成功すれば反映（Undo 可）。
 * 高さデータ（base64）は表示せず、保存時に元のデータを保つ。
 */
import { validateScenario } from '../../sim/scenario/validate';
import type { MapDef, ScenarioDef } from '../../sim/types';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, fill, select } from '../forms/fields';
import type { Panel } from './types';

let which: 'scenario' | 'map' = 'scenario';
let draft: string | null = null;
let message = '';

function omitted(n: number): string {
  return `<省略: ${n}×${n}>`;
}

function textOf(ed: Ed): string {
  if (which === 'scenario') return JSON.stringify(ed.p.scenario, null, 2);
  const m = structuredClone(ed.p.map);
  if (m.terrain.type === 'heightmap') m.terrain.data = omitted(m.resolution);
  return JSON.stringify(m, null, 2);
}

/** エラー位置（行）を取り出す */
function errorLine(text: string, e: unknown): string {
  const pos = /position (\d+)/.exec(String(e))?.[1];
  if (!pos) return String(e);
  const line = text.slice(0, Number(pos)).split('\n').length;
  return `${line} 行目: ${String(e)}`;
}

function apply(ed: Ed, text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    message = `JSON の誤り（反映していません）— ${errorLine(text, e)}`;
    return ed.refresh();
  }
  try {
    if (which === 'scenario') {
      const s = parsed as ScenarioDef;
      const errs = validateScenario(s, ed.p.map).filter((i) => i.level === 'error');
      if (errs.length > 0) {
        message = `検証エラー（反映していません）: ${errs.slice(0, 5).map((i) => `${i.path} ${i.message}`).join(' / ')}`;
        return ed.refresh();
      }
      draft = null;
      message = '反映しました';
      ed.change('JSON（シナリオ）', () => (ed.p.scenario = s));
    } else {
      const m = parsed as MapDef;
      if (!Array.isArray(m.nodes) || !Array.isArray(m.edges) || !m.terrain) throw new Error('nodes・edges・terrain が必要です');
      // 高さは元のデータを保つ
      if (m.terrain.type === 'heightmap' && ed.p.map.terrain.type === 'heightmap') m.terrain.data = ed.p.map.terrain.data;
      if (m.resolution !== ed.p.map.resolution || m.size !== ed.p.map.size) throw new Error('size・resolution はエリアのタブで変えてください');
      draft = null;
      message = '反映しました';
      ed.change('JSON（マップ）', () => (ed.p.map = m), true);
    }
  } catch (e) {
    message = `反映できませんでした: ${String(e instanceof Error ? e.message : e)}`;
    ed.refresh();
  }
}

export const jsonPanel: Panel = {
  id: 'json',
  group: '上級',
  label: 'JSON',
  render(ed) {
    const text = draft ?? textOf(ed);
    // スクロールバーは文字の欄の 1 本だけ（ユーザーの指摘: 3 本出ていた）。折り返さないので、行番号と行がずれない
    const ta = el('textarea', { class: 'mono json-ta', spellcheck: 'false', wrap: 'off' });
    ta.value = text;
    const nums = el('pre', { class: 'mono json-nums' }, Array.from({ length: text.split('\n').length }, (_, i) => String(i + 1)).join('\n'));
    ta.addEventListener('input', () => {
      draft = ta.value;
      nums.textContent = Array.from({ length: ta.value.split('\n').length }, (_, i) => String(i + 1)).join('\n');
    });
    ta.addEventListener('scroll', () => (nums.scrollTop = ta.scrollTop));
    fill(
      ed.inspector,
      el('h2', {}, 'JSON'),
      select('対象', which, [['scenario', 'シナリオ'], ['map', 'マップ']], (v) => {
        which = v;
        draft = null;
        message = '';
        ed.refresh();
      }),
      el('p', { class: 'note' }, '形式は docs/09（シナリオ）・docs/04（マップ）のとおり。高さデータは省略して表示します。'),
      el('div', {}, [button('適用', () => apply(ed, ta.value), 'primary'), button('元に戻す（編集を捨てる）', () => {
        draft = null;
        message = '';
        ed.refresh();
      })]),
      message ? el('p', { class: message.startsWith('反映しました') ? 'note' : 'error' }, message) : null,
    );
    ed.bottom.replaceChildren(el('div', { class: 'json-edit' }, [nums, ta]));
  },
};

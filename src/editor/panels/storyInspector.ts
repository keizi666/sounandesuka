/**
 * 物語のタブの右の欄: 選んだカードを、やさしい言葉の欄で直す（題・いつ・文・選択肢とその行動）。
 * ID・条件の組み合わせ・選ばれやすさなどは「くわしい設定」に畳む（choiceDetail.ts・storyDetail.ts）。
 */
import type { ChoiceOptionDef, ChoicePointDef, Condition, ScenarioDef } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { actionEditor } from '../forms/ActionEditor';
import { area, button, check, keptDetails, lines, select, text } from '../forms/fields';
import { RECORD_PRESETS, whenPicker } from '../forms/whenPicker';
import { nextId } from '../store/project';
import type { StorySel } from '../templates/story';
import { cpEditor, genericSection, varInserter } from './choiceDetail';
import { effectEditor, ENDING_KINDS, eventDetail, speechDetail, thoughtDetail, whenDetail, whoSelect } from './storyDetail';

type Kid = HTMLElement | null;
const h = (t: string, note?: string): HTMLElement => el('h4', { class: 'si-h' }, note ? [t, el('small', { class: 'note' }, ` ${note}`)] : t);
const detail = (kids: Kid[]): HTMLElement => keptDetails('story:detail', 'くわしい設定', kids, false);

function optionBox(ed: Ed, cp: ChoicePointDef, o: ChoiceOptionDef, i: number): HTMLElement {
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const tag = (t: 'recommended' | 'risky', label: string): HTMLElement => {
    const on = o.tags?.includes(t) ?? false;
    return el('button', { class: `small si-tag ${t}${on ? ' on' : ''}`, title: t === 'recommended' ? '安全な判断。「推奨方針」の試走はこれを選びます' : '危ない判断', onclick: () => set('印', () => (o.tags = on ? (o.tags ?? []).filter((x) => x !== t) : [...(o.tags ?? []).filter((x) => x !== (t === 'recommended' ? 'risky' : 'recommended')), t])) }, label);
  };
  const move = (d: number): void => set('並べ替え', () => cp.options.splice(i + d, 0, cp.options.splice(i, 1)[0]!));
  return el('div', { class: 'si-opt' }, [
    el('div', { class: 'cond-row' }, [
      el('b', {}, `${i + 1}`),
      (() => {
        const inp = el('input', { type: 'text', value: o.label, placeholder: '選択肢の文（例: 引き返す）', class: 'si-opt-label' });
        inp.addEventListener('change', () => set('選択肢の文', () => (o.label = inp.value)));
        return inp;
      })(),
    ]),
    el('div', { class: 'cond-row' }, [tag('recommended', '★ おすすめ'), tag('risky', '⚠ 危険'), el('span', { class: 'spacer' }), el('button', { class: 'small', disabled: i === 0, onclick: () => move(-1) }, '↑'), el('button', { class: 'small', disabled: i === cp.options.length - 1, onclick: () => move(1) }, '↓'), el('button', { class: 'small', title: 'この選択肢を消す', onclick: () => set('選択肢の削除', () => cp.options.splice(i, 1)) }, '✕')]),
    el('small', { class: 'note' }, '選ぶと、登山者はこうする（上から順に）:'),
    actionEditor(o.actions, ed.p.scenario, ed.p.map, (a) => set('行動', () => (o.actions = a))),
  ]);
}

function choiceFields(ed: Ed, cp: ChoicePointDef, done: (s: StorySel | null) => void): Kid[] {
  const s = ed.p.scenario;
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const situ = area('状況の文（プレイヤーに見せる）', cp.situation, (v) => set('状況', () => (cp.situation = v)), 4);
  return [
    el('h2', {}, '🔀 分かれ道'),
    text('題', cp.title, (v) => set('題', () => (cp.title = v)), { wide: true }),
    h('いつ出す'),
    whenPicker(cp.trigger, { scenario: s, map: ed.p.map }, (c) => c && set('いつ出す', () => (cp.trigger = c))),
    situ,
    varInserter(() => situ.querySelector('textarea'), cp, ed),
    h(`選択肢（${cp.options.length}）`, '★ は安全な判断、⚠ は危ない判断'),
    ...cp.options.map((o, i) => optionBox(ed, cp, o, i)),
    button('＋ 選択肢を足す', () => set('選択肢の追加', () => cp.options.push({ id: nextId(cp.options.map((o) => o.id), 'o'), label: '', actions: [{ type: 'continueRoute' }], bias: { base: 1 } }))),
    detail([el('p', { class: 'note' }, 'ID・条件の組み合わせ・選択肢を選べる条件・観察だけのときの選ばれやすさ・制限時間など。'), cpEditor(ed, cp)]),
    el('div', { class: 'si-foot' }, [
      button('複製', () => set('分かれ道の複製', () => {
        const c = structuredClone(cp);
        c.id = nextId(s.choices.map((x) => x.id), 'cp');
        done({ kind: 'choice', idx: s.choices.push(c) - 1 });
      })),
      button('この分かれ道を消す', () => set('分かれ道の削除', () => {
        s.choices = s.choices.filter((x) => x !== cp);
        done(null);
      })),
    ]),
  ];
}

const delBtn = (ed: Ed, label: string, list: unknown[], i: number, done: (s: StorySel | null) => void): HTMLElement =>
  el('div', { class: 'si-foot' }, [button(`この${label}を消す`, () => ed.change(`${label}の削除`, () => {
    list.splice(i, 1);
    done(null);
  }))]);

/** 「相手」の欄（なし・リーダー・だれか・名前） */
function toSelect(ed: Ed, value: string | undefined, set: (v: string | undefined) => void): HTMLElement {
  const opts: [string, string][] = [['', '（ひとりごと・みんなに）'], ['leader', 'リーダー'], ['any', 'だれか（近くの人）'], ...ed.p.scenario.party.map((c) => [c.id, c.name] as [string, string])];
  if (value && !opts.some((o) => o[0] === value)) opts.push([value, value]);
  return select('話しかける相手', value ?? '', opts, (v) => set(v || undefined));
}

export function storyInspector(ed: Ed, sel: StorySel | null, done: (s: StorySel | null) => void, openGallery: () => void): Kid[] {
  const s: ScenarioDef = ed.p.scenario;
  const ctx = { scenario: s, map: ed.p.map };
  const set = (label: string, f: () => void): void => ed.change(label, f);
  const i = sel?.idx ?? 0;
  switch (sel?.kind) {
    case 'choice': {
      const cp = s.choices[i];
      if (cp) return choiceFields(ed, cp, done);
      break;
    }
    case 'event': {
      const ev = s.events[i];
      if (!ev) break;
      return [
        el('h2', {}, '⚡ できごと'),
        h('いつ起きる'),
        whenPicker(ev.trigger, ctx, (c) => c && set('いつ起きる', () => (ev.trigger = c)), { chance: true }),
        h('なにが起きる', '上から順に'),
        effectEditor(ed, ev.effects, (l) => set('起きること', () => (ev.effects = l))),
        detail(eventDetail(ed, ev)),
        delBtn(ed, 'できごと', s.events, i, done),
      ];
    }
    case 'speech': {
      const sp = s.speech?.[i];
      if (!sp) break;
      return [
        el('h2', {}, '💬 セリフ'),
        el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, 'だれが'), whoSelect(ed, sp.who, (v) => set('話し手', () => (sp.who = v as typeof sp.who)), 'any')]),
        h('いつ言う'),
        whenPicker(sp.when, ctx, (c) => c && set('いつ言う', () => (sp.when = c))),
        lines('セリフ（どれか 1 つを言う）', sp.lines, (v) => set('セリフ', () => (sp.lines = v))),
        toSelect(ed, sp.to, (v) => set('相手', () => {
          sp.to = v as typeof sp.to;
          if (!v) delete sp.replies;
        })),
        sp.to ? lines('返事', sp.replies?.lines, (v) => set('返事', () => (sp.replies = v.length ? { who: (sp.to ?? 'any') as typeof sp.who, lines: v } : undefined))) : null,
        check('一度だけ言う', sp.once ?? false, (v) => set('一度だけ', () => (sp.once = v))),
        detail(speechDetail(ed, i)),
        delBtn(ed, 'セリフ', s.speech!, i, done),
      ];
    }
    case 'thought': {
      const th = s.thoughts?.[i];
      if (!th) break;
      return [
        el('h2', {}, '💭 心の声'),
        h('いつ考える'),
        whenPicker(th.when, ctx, (c) => c && set('いつ考える', () => (th.when = c))),
        lines('考えること（どれか 1 つ）', th.lines, (v) => set('心の声', () => (th.lines = v))),
        detail(thoughtDetail(ed, i)),
        delBtn(ed, '心の声', s.thoughts!, i, done),
      ];
    }
    case 'ending': {
      const e = s.endings[i];
      if (!e) break;
      return [
        el('h2', {}, '🏁 結末'),
        select('終わり方', e.kind, ENDING_KINDS.map((k) => [k, JA.endings[k]?.title ?? k]), (v) => set('結末の種類', () => (e.kind = v))),
        text('題', e.title, (v) => set('結末の題', () => (e.title = v)), { wide: true }),
        area('文', e.text, (v) => set('結末の文', () => (e.text = v)), 4),
        h('どんなときに、この文を出す'),
        whenPicker(e.when, ctx, (c: Condition | undefined) => set('結末の条件', () => (c ? (e.when = c) : delete e.when)), { presets: RECORD_PRESETS, optional: 'この終わり方なら、いつも' }),
        el('p', { class: 'note' }, '同じ終わり方の文がいくつかあるときは、上にあるものから確かめ、合った最初の文を出します。'),
        i > 0 ? button('↑ 上へ', () => set('並べ替え', () => {
          s.endings.splice(i - 1, 0, s.endings.splice(i, 1)[0]!);
          done({ kind: 'ending', idx: i - 1 });
        })) : null,
        detail(whenDetail(ed, e, '結末の条件')),
        delBtn(ed, '結末', s.endings, i, done),
      ];
    }
    case 'lesson': {
      const l = s.lessons[i];
      if (!l) break;
      return [
        el('h2', {}, '💡 教訓'),
        text('題', l.title, (v) => set('教訓の題', () => (l.title = v)), { wide: true }),
        area('文', l.text, (v) => set('教訓の文', () => (l.text = v)), 4),
        el('p', { class: 'note' }, '文には {rec.rainwearDelayMin:0}（雨具の遅れ）・{rec.minCoreC:1}（最低体温）・{rec.lostMinutes:0}（迷った時間）のように、記録の数字を入れられます。'),
        h('どんなときに出す'),
        whenPicker(l.when, ctx, (c: Condition | undefined) => set('教訓の条件', () => (c ? (l.when = c) : delete l.when)), { presets: RECORD_PRESETS, optional: 'いつも出す' }),
        detail(whenDetail(ed, l, '教訓の条件')),
        delBtn(ed, '教訓', s.lessons, i, done),
      ];
    }
    case 'generic':
      return [el('h2', {}, '🔀 自動で出る分かれ道'), el('p', { class: 'note' }, '状況に応じて自動で出ます。チェックを外すと出なくなり、文を書くと既定の文の代わりに出ます（選択肢は既定のもの）。'), genericSection(ed)];
    default:
      break;
  }
  return [
    el('h2', {}, '物語'),
    el('p', {}, '左のカードを押すと、ここで直せます。'),
    el('ul', { class: 'si-help' }, [
      el('li', {}, [el('b', {}, '🔀 分かれ道'), ' … 登山者が判断する場面。選んだ行動で、その先が変わります']),
      el('li', {}, [el('b', {}, '⚡ できごと'), ' … 時刻や場所で自動で起きること（予報・落石・動物など）']),
      el('li', {}, [el('b', {}, '💬 会話・💭 心の声'), ' … 話すこと・考えること（行動は変えません）']),
      el('li', {}, [el('b', {}, '🏁 結末・💡 教訓'), ' … 終わったときに出す文と、振り返りの学び']),
    ]),
    el('p', { class: 'note' }, '結果は選択肢が直接決めるのではなく、選んだ行動と、天気・地形・体力のシミュレーションで決まります。作ったら「試走」で確かめましょう。'),
    button('＋ テンプレートから足す', openGallery, 'primary'),
  ];
}

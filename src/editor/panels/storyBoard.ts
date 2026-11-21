/**
 * 物語のボード（物語のタブの中央）: 分かれ道・できごと・会話・結末・教訓をカードで並べ、流れを見せる。
 * 「いつ・どこで」→「なにが起きる・どう判断する」→「結末」の順。地点で起きるものは計画ルートの道のりにそって並べる。
 * カードを押すと右の欄で直せる。「＋」でテンプレートの一覧を開く。
 */
import { tryParseTimeRef } from '../../sim/core/clock';
import type { ChoicePointDef, Condition, EndingKind, GenericChoiceKey, ScriptEventDef } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { plainActions } from '../forms/ActionEditor';
import { keptDetails } from '../forms/fields';
import { varLabel } from '../forms/varPaths';
import { clockLabel, plainWhen, RECORD_PRESETS } from '../forms/whenPicker';
import type { StoryCat, StorySel } from '../templates/story';
import { KIT_TEMPLATES } from '../templates/storyParts2';
import { choiceBranch, eventBranch, inlineBranch } from './storyBranch';
import { ENDING_KINDS, plainEffects } from './storyDetail';

export interface BoardApi {
  sel: StorySel | null;
  select(s: StorySel): void;
  /** テンプレートの一覧を開く（node を渡すと、その地点で起こすもの） */
  add(cat?: StoryCat, node?: string): void;
  /** テンプレートを 1 つそのまま足す */
  addTemplate(id: string): void;
  blank(kind: StorySel['kind'], endingKind?: EndingKind): void;
  showMap(): void;
  /** 開いている枝分かれの編集をたたむ */
  close(): void;
  /** 編集の中で選ぶものが変わった（並べ替え・削除）。描き直しは呼び出し側の変更が行う */
  done(s: StorySel | null): void;
}

const GENERICS: GenericChoiceKey[] = ['lostAware', 'darkness', 'hypothermia', 'injured', 'lightning', 'waterfall', 'straggler', 'rescueFailed'];
const GOOD: EndingKind[] = ['SAFE_RETURN', 'SAFE_SHELTER', 'ABORTED', 'SELF_RESCUE'];

/** 条件から「どこで」「いつ」を取り出す（直接か、「すべて満たす」の中） */
function anchor(c: Condition): { node?: string; time?: number } {
  const list = 'all' in c ? c.all : [c];
  const at = list.find((x) => 'atNode' in x) as { atNode: string } | undefined;
  if (at) return { node: at.atNode };
  const af = list.find((x) => 'after' in x) as { after: string } | undefined;
  const t = af ? tryParseTimeRef(af.after) : null;
  return t === null ? {} : { time: t };
}

/** 「この分かれ道でこれを選んだ」を条件にしているもの（選択肢の先のつながり） */
function choseLinks(ed: Ed): Map<string, string[]> {
  const s = ed.p.scenario;
  const out = new Map<string, string[]>();
  const walk = (c: unknown, label: string): void => {
    if (Array.isArray(c)) return c.forEach((x) => walk(x, label));
    if (!c || typeof c !== 'object') return;
    const o = c as Record<string, unknown>;
    const ch = o['chose'] as { cp: string; option: string } | undefined;
    if (ch) out.set(`${ch.cp}:${ch.option}`, [...(out.get(`${ch.cp}:${ch.option}`) ?? []), label]);
    for (const k of ['all', 'any', 'not']) walk(o[k], label);
  };
  s.events.forEach((e) => walk(e.trigger, `できごと ${plainEffects(e.effects, ed)[0] ?? e.id}`));
  s.choices.forEach((c) => walk(c.trigger, `分かれ道「${c.title}」`));
  s.endings.forEach((e) => walk(e.when, `結末「${e.title}」`));
  s.lessons.forEach((l) => walk(l.when, `教訓「${l.title}」`));
  return out;
}

const cut = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}…` : t);
/** 文の中の {leader.local.tempC:0} のような変数を、〔気温〕のような言葉にして見せる */
const plainText = (ed: Ed, t: string): string => t.replace(/\{([^}:]+)(?::[^}]*)?\}/g, (_m, p: string) => (p === 'leader.def.name' || p === 'leader.name' ? 'リーダー' : `〔${varLabel(ed.p.scenario, p).replace(/^(リーダーの|局地の|記録: )/, '')}〕`));
function card(api: BoardApi, me: StorySel, cls: string, kids: (HTMLElement | string | null)[], ed?: Ed): HTMLElement {
  // 選んだ会話・結末・教訓は、その場で開いて直す
  if (ed && api.sel?.kind === me.kind && api.sel.idx === me.idx) {
    const open = inlineBranch(ed, api, me);
    if (open) return open;
  }
  const d = el('div', { class: `sb-card k-${cls}${api.sel?.kind === me.kind && api.sel.idx === me.idx ? ' sel' : ''}`, role: 'button', tabindex: 0, onclick: () => api.select(me) }, kids.filter((k): k is HTMLElement | string => k !== null));
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      api.select(me);
    }
  });
  return d;
}

function choiceCard(ed: Ed, api: BoardApi, cp: ChoicePointDef, idx: number, links: Map<string, string[]>, showWhen: boolean): HTMLElement {
  if (api.sel?.kind === 'choice' && api.sel.idx === idx) return choiceBranch(ed, api, cp);
  const ctx = { scenario: ed.p.scenario, map: ed.p.map };
  const dec = ed.lastRun?.record?.decisions.find((d) => d.cpId === cp.id);
  return card(api, { kind: 'choice', idx }, 'choice', [
    el('div', { class: 'sb-kind' }, ['🔀 分かれ道', showWhen ? el('span', { class: 'sb-when' }, plainWhen(cp.trigger, ctx)) : null].filter((x): x is HTMLElement | string => x !== null)),
    el('div', { class: 'sb-title' }, cp.title || '（題なし）'),
    cp.situation ? el('div', { class: 'sb-text' }, cut(plainText(ed, cp.situation), 70)) : null,
    el('ul', { class: 'sb-opts' }, cp.options.map((o) =>
      el('li', { class: `${o.tags?.includes('recommended') ? 'rec' : ''}${o.tags?.includes('risky') ? ' risky' : ''}${dec?.optionId === o.id ? ' chosen' : ''}` }, [
        el('span', { class: 'sb-opt-label' }, `${o.tags?.includes('recommended') ? '★ ' : o.tags?.includes('risky') ? '⚠ ' : ''}${o.label || '（無題）'}`),
        el('span', { class: 'sb-arrow' }, '→'),
        el('span', { class: 'sb-opt-do' }, plainActions(o.actions, ed.p.map)),
        ...(links.get(`${cp.id}:${o.id}`) ?? []).map((l) => el('span', { class: 'chip' }, `⤷ ${cut(l, 24)}`)),
      ]),
    )),
    ed.lastRun ? el('div', { class: `sb-run${dec ? '' : ' miss'}` }, dec ? `試走: ${clockLabel(`D${Math.floor(dec.tMin / 1440)} ${String(Math.floor((dec.tMin % 1440) / 60)).padStart(2, '0')}:${String(Math.floor(dec.tMin % 60)).padStart(2, '0')}`)} に出て「${cp.options.find((o) => o.id === dec.optionId)?.label ?? dec.optionId}」を選んだ` : '試走では出なかった') : null,
  ]);
}

function eventCard(ed: Ed, api: BoardApi, ev: ScriptEventDef, idx: number, showWhen: boolean): HTMLElement {
  if (api.sel?.kind === 'event' && api.sel.idx === idx) return eventBranch(ed, api, ev);
  const ctx = { scenario: ed.p.scenario, map: ed.p.map };
  const fx = plainEffects(ev.effects, ed);
  return card(api, { kind: 'event', idx }, 'event', [
    el('div', { class: 'sb-kind' }, ['⚡ できごと', showWhen ? el('span', { class: 'sb-when' }, plainWhen(ev.trigger, ctx)) : null].filter((x): x is HTMLElement | string => x !== null)),
    ...fx.slice(0, 3).map((t) => el('div', { class: 'sb-text' }, cut(t, 60))),
    fx.length > 3 ? el('div', { class: 'sb-text muted' }, `ほか ${fx.length - 3} つ`) : null,
    !showWhen && 'all' in ev.trigger ? el('div', { class: 'sb-text muted' }, plainWhen(ev.trigger, ctx)) : null,
  ]);
}

const sectionHead = (title: string, note: string, btn?: HTMLElement): HTMLElement => el('div', { class: 'sb-head' }, [el('h3', {}, title), el('span', { class: 'note' }, note), btn ?? '']);
const addBtn = (label: string, f: () => void): HTMLElement => el('button', { class: 'small sb-add', onclick: f }, label);

export function storyBoard(ed: Ed, api: BoardApi): HTMLElement {
  const s = ed.p.scenario;
  const map = ed.p.map;
  const ctx = { scenario: s, map };
  const links = choseLinks(ed);
  // 名前が ID のままの地点（J002 など）は、名前のない地点として扱う
  const nodeName = (id: string): string => {
    const n = map.nodes.find((x) => x.id === id)?.name ?? '';
    return n === id ? '' : n;
  };
  // 置き場所ごとに分ける
  type Item = { el: (showWhen: boolean) => HTMLElement; node?: string; time?: number };
  const items: Item[] = [
    ...s.choices.map((c, i) => ({ ...anchor(c.trigger), el: (w: boolean) => choiceCard(ed, api, c, i, links, w) })),
    ...s.events.map((e, i) => ({ ...anchor(e.trigger), el: (w: boolean) => eventCard(ed, api, e, i, w) })),
  ];
  const empty = s.choices.length + s.events.length + s.endings.length + s.lessons.length === 0;

  // ---- 道のり ----
  const route = [...new Set(s.plan.route)];
  const offRoute = [...new Set(items.map((x) => x.node).filter((id): id is string => !!id && !route.includes(id)))];
  const stops = [...route.filter((id) => nodeName(id) || items.some((x) => x.node === id)), ...offRoute];
  const goal = new Set(s.plan.goalNodes);
  const trail = el('div', { class: 'sb-trail' }, stops.map((id, k) => {
    const here = items.filter((x) => x.node === id);
    return el('div', { class: `sb-stop${here.length ? ' has' : ''}` }, [
      el('div', { class: 'sb-stop-head' }, [
        el('span', { class: 'sb-dot' }),
        el('strong', {}, nodeName(id) || id),
        k === 0 && route[0] === id ? el('span', { class: 'chip' }, `出発 ${clockLabel(s.startAt)}`) : null,
        goal.has(id) && k > 0 ? el('span', { class: 'chip' }, '下山口') : null,
        !route.includes(id) ? el('span', { class: 'chip' }, 'ルートの外') : null,
        addBtn('＋ ここで起こす', () => api.add('choice', id)),
      ].filter((x): x is HTMLElement => x !== null)),
      here.length ? el('div', { class: 'sb-cards' }, here.map((x) => x.el(false))) : null,
    ].filter((x) => x !== null));
  }));

  const timed = items.filter((x) => x.node === undefined && x.time !== undefined).sort((a, b) => a.time! - b.time!);
  const cond = items.filter((x) => x.node === undefined && x.time === undefined);
  const genOn = GENERICS.filter((k) => s.genericOverrides?.[k]?.enabled !== false);
  const generic = card(api, { kind: 'generic', idx: 0 }, 'generic', [
    el('div', { class: 'sb-kind' }, '🔀 自動で出る分かれ道'),
    el('div', { class: 'sb-text' }, genOn.map((k) => JA.generic[k]?.title ?? k).join('・') || '（すべて止めている）'),
    el('div', { class: 'sb-text muted' }, '道迷い・日暮れ・雷などは、作らなくても状況に応じて出ます。止めたり、文を変えたりできます'),
  ]);

  // ---- 会話 ----
  const who = (w: string | undefined): string => (!w || w === 'any' ? 'だれか' : w === 'leader' ? 'リーダー' : s.party.find((c) => c.id === w)?.name ?? w);
  const talk = [
    ...(s.speech ?? []).map((sp, i) => card(api, { kind: 'speech', idx: i }, 'talk', [el('span', {}, `💬 ${who(sp.who)}「${cut(sp.lines[0] ?? '', 26)}」`), el('span', { class: 'sb-when' }, cut(plainWhen(sp.when, ctx), 30))], ed)),
    ...(s.thoughts ?? []).map((th, i) => card(api, { kind: 'thought', idx: i }, 'talk', [el('span', {}, `💭 ${who(th.who)}（${cut(th.lines[0] ?? '', 26)}）`), el('span', { class: 'sb-when' }, cut(plainWhen(th.when, ctx), 30))], ed)),
  ];

  // ---- 結末 ----
  const endings = el('div', { class: 'sb-endings' }, ENDING_KINDS.map((k) => {
    const mine = s.endings.map((e, i) => ({ e, i })).filter((x) => x.e.kind === k);
    return el('div', { class: `sb-ending ${GOOD.includes(k) ? 'good' : 'bad'}` }, [
      el('div', { class: 'sb-ending-kind' }, JA.endings[k]?.title ?? k),
      ...mine.map(({ e, i }) => card(api, { kind: 'ending', idx: i }, 'ending', [el('div', { class: 'sb-title' }, e.title || '（題なし）'), el('div', { class: 'sb-text' }, cut(e.text, 50)), e.when ? el('div', { class: 'sb-when' }, cut(plainWhen(e.when, ctx, RECORD_PRESETS), 40)) : null], ed)),
      mine.length === 0 ? el('div', { class: 'sb-text muted' }, `（既定の文）${cut(JA.endings[k]?.text ?? '', 36)}`) : null,
      addBtn('＋ 文を書く', () => api.blank('ending', k)),
    ].filter((x): x is HTMLElement => x !== null));
  }));

  const lessons = s.lessons.map((l, i) => card(api, { kind: 'lesson', idx: i }, 'lesson', [el('div', { class: 'sb-title' }, `💡 ${l.title || '（題なし）'}`), el('div', { class: 'sb-when' }, l.when ? cut(plainWhen(l.when, ctx, RECORD_PRESETS), 40) : 'いつも出す')], ed));

  return el('div', { class: 'story-board' }, [
    el('div', { class: 'sb-top' }, [
      el('div', {}, [el('h2', {}, `物語: ${s.title}`), el('p', { class: 'note' }, 'カードを押すと、その場で開いて直せます。「＋」でテンプレートから足せます。')]),
      el('span', { class: 'spacer' }),
      el('button', { onclick: () => api.showMap() }, '🗺 地図を見る'),
      el('button', { class: 'primary', onclick: () => api.add() }, '＋ テンプレートから足す'),
    ]),
    el('div', { class: 'sb-flow' }, [el('span', {}, '① いつ・どこで'), '→', el('span', {}, '② なにが起きる・どう判断する'), '→', el('span', {}, '③ どう終わる・何を学ぶ')]),
    empty
      ? el('div', { class: 'sb-hero' }, [
          el('h3', {}, 'まずは「物語の型」を 1 つ選びましょう'),
          el('p', { class: 'note' }, '分かれ道・できごと・結末・教訓がまとめて入ります。入れたあとで、文や場所を自由に直せます（Ctrl＋Z で戻せます）。'),
          el('div', { class: 'tg-grid' }, KIT_TEMPLATES.map((t) => el('button', { class: 'tg-card', onclick: () => api.addTemplate(t.id) }, [el('span', { class: 'tg-icon' }, t.icon), el('strong', {}, t.name), el('small', {}, t.desc)]))),
        ])
      : null,
    sectionHead('道のりにそって起きること', '計画ルートの地点。着いたときに起きることを置きます'),
    stops.length ? trail : el('p', { class: 'note' }, '計画ルートがまだありません。「人と計画」のタブでルートを引くと、ここに地点が並びます。'),
    sectionHead('時刻で起きること', '場所に関係なく、時刻になったら', addBtn('＋ 足す', () => api.add('event'))),
    timed.length ? el('div', { class: 'sb-cards' }, timed.map((x) => x.el(true))) : null,
    sectionHead('条件がそろったら起きること', '雨・疲れ・遅れなど、状況しだいで', addBtn('＋ 足す', () => api.add('choice'))),
    el('div', { class: 'sb-cards' }, [...cond.map((x) => x.el(true)), generic]),
    sectionHead(`会話・心の声（${talk.length}）`, '登山者が話すこと・考えること', addBtn('＋ 足す', () => api.add('talk'))),
    talk.length > 12 ? keptDetails('story:talk', `${talk.length} 個を見る`, [el('div', { class: 'sb-talks' }, talk)], false, 'sb-fold') : el('div', { class: 'sb-talks' }, talk),
    sectionHead('結末', '終わり方ごとの文。書かなければ既定の文が出ます', addBtn('＋ 基本セット', () => api.addTemplate('endings'))),
    endings,
    sectionHead(`教訓（${lessons.length}）`, '振り返りで出す学び', addBtn('＋ 足す', () => api.add('ending'))),
    el('div', { class: 'sb-cards' }, lessons),
  ].filter((x): x is HTMLElement => x !== null));
}

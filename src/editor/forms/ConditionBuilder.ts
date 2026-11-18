/**
 * 条件ビルダー（docs/18 §3.3）: 条件 DSL をツリーで組み立てる。種類は docs/09 §4 の表と 1 対 1。
 * 「JSON を見る」でその場の JSON を直接編集でき、ビルダーと JSON は往復で一致する（同じオブジェクトを読み書きする）。
 */
import type { BehaviorState, CmpOp, Condition, MapDef, ScenarioDef, SimEventType } from '../../sim/types';
import { el } from '../../ui/dom';
import { JA as TEXT } from '../../i18n/ja';
import { varGroups, varLabel } from './varPaths';

export type CondKind = 'all' | 'any' | 'not' | 'var' | 'after' | 'before' | 'atNode' | 'beenAt' | 'onEdge' | 'near' | 'state' | 'flag' | 'chose' | 'event' | 'chance' | 'elapsedSince';

export const COND_LABELS: Record<CondKind, string> = {
  all: 'すべて満たす',
  any: 'いずれか',
  not: '〜ではない',
  var: '値を比べる',
  after: '時刻以降',
  before: '時刻より前',
  atNode: 'ノードに着いた',
  beenAt: 'ノードを通った',
  onEdge: '道の上にいる',
  near: '地点の近く',
  state: '状態',
  flag: 'フラグが立っている',
  chose: '分岐点で選んだ',
  event: '出来事が起きた',
  chance: '確率',
  elapsedSince: 'フラグから経過',
};

export function kindOf(c: Condition): CondKind {
  return Object.keys(c)[0] === 'var' ? 'var' : (Object.keys(c)[0] as CondKind);
}

const STATES = Object.keys(TEXT.labels.state) as BehaviorState[];
const EVENTS: SimEventType[] = ['RAIN_START', 'RAIN_STOP', 'PRECIP_TYPE', 'SUNSET', 'SUNRISE', 'DARK', 'NODE_ARRIVE', 'OFFROUTE', 'LOST_AWARE', 'BACK_ON_ROUTE', 'FALL', 'INJURY', 'STAGE_CHANGE', 'LIGHTNING_STRIKE', 'RESCUE_CALLED', 'RESCUED', 'SHELTER_ENTER', 'BIVOUAC_START', 'FINISHED', 'GEAR', 'PHONE_DEAD', 'LAMP_DEAD'] as SimEventType[];

export function defaultCond(k: CondKind, s: ScenarioDef, map: MapDef): Condition {
  const node = s.plan.route[0] ?? map.nodes[0]?.id ?? '';
  switch (k) {
    case 'all':
      return { all: [] };
    case 'any':
      return { any: [] };
    case 'not':
      return { not: { flag: 'flag' } };
    case 'var':
      return { var: 'leader.coreC', op: '<', value: 35 };
    case 'after':
      return { after: s.startAt };
    case 'before':
      return { before: s.timeLimit };
    case 'atNode':
      return { atNode: node };
    case 'beenAt':
      return { beenAt: node };
    case 'onEdge':
      return { onEdge: map.edges[0]?.id ?? '' };
    case 'near':
      return { near: { x: 0, z: 0, r: 100 } };
    case 'state':
      return { state: 'WALKING' };
    case 'flag':
      return { flag: 'flag' };
    case 'chose':
      return { chose: { cp: s.choices[0]?.id ?? '', option: s.choices[0]?.options[0]?.id ?? '' } };
    case 'event':
      return { event: 'RAIN_START' };
    case 'chance':
      return { chance: 0.5 };
    case 'elapsedSince':
      return { elapsedSince: { flag: 'flag', min: 30 } };
  }
}

/** 一覧に出す短い要約 */
export function summarize(c: Condition | undefined, s: ScenarioDef, map: MapDef): string {
  if (!c) return '（なし）';
  const node = (id: string): string => map.nodes.find((n) => n.id === id)?.name ?? id;
  const k = kindOf(c);
  const x = c as Record<string, unknown>;
  switch (k) {
    case 'all':
      return (x['all'] as Condition[]).map((y) => summarize(y, s, map)).join(' かつ ') || '（常に真）';
    case 'any':
      return `（${(x['any'] as Condition[]).map((y) => summarize(y, s, map)).join(' または ')}）`;
    case 'not':
      return `「${summarize(x['not'] as Condition, s, map)}」ではない`;
    case 'var': {
      const v = c as { var: string; op: string; value: unknown };
      return `${varLabel(s, v.var)} ${v.op} ${String(v.value)}`;
    }
    case 'after':
      return `${String(x['after'])} 以降`;
    case 'before':
      return `${String(x['before'])} より前`;
    case 'atNode':
      return `${node(String(x['atNode']))} に着いた`;
    case 'beenAt':
      return `${node(String(x['beenAt']))} を通った`;
    case 'onEdge':
      return `道 ${String(x['onEdge'])} の上`;
    case 'near': {
      const n = x['near'] as { x: number; z: number; r: number };
      return `(${n.x}, ${n.z}) の ${n.r} m 以内`;
    }
    case 'state':
      return `状態が「${TEXT.labels.state[String(x['state'])] ?? String(x['state'])}」`;
    case 'flag':
      return `フラグ ${String(x['flag'])}`;
    case 'chose': {
      const ch = x['chose'] as { cp: string; option: string };
      return `${ch.cp} で ${ch.option} を選んだ`;
    }
    case 'event':
      return `出来事 ${String(x['event'])}`;
    case 'chance':
      return `確率 ${String(x['chance'])}`;
    case 'elapsedSince': {
      const e = x['elapsedSince'] as { flag: string; min: number };
      return `${e.flag} から ${e.min} 分`;
    }
  }
}

export interface CondCtx {
  scenario: ScenarioDef;
  map: MapDef;
  /** 試走でこの条件が初めて真になった時刻を調べる（任意） */
  probe?: (c: Condition) => string;
}

function sel<T extends string>(value: T, opts: [T, string][], set: (v: T) => void, cls = ''): HTMLSelectElement {
  const s = el('select', { class: cls }, opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  s.addEventListener('change', () => set(opts[s.selectedIndex]![0]));
  return s;
}

function inp(value: string | number, set: (v: string) => void, attrs: Record<string, string | number> = {}): HTMLInputElement {
  const i = el('input', { value, ...attrs });
  i.addEventListener('change', () => set(i.value));
  return i;
}

/**
 * 条件のツリーを描く。root を直接書き換え、変わるたびに commit(root) を呼ぶ（呼び出し側が Undo に記録して描き直す）。
 */
export function conditionBuilder(root: Condition, ctx: CondCtx, commit: (c: Condition) => void): HTMLElement {
  const box = el('div', { class: 'cond-builder' });
  const nodes = ctx.map.nodes.map((n) => [n.id, `${n.name}（${n.id}）`] as [string, string]);
  const edges = ctx.map.edges.map((e) => [e.id, `${e.name || e.id}`] as [string, string]);
  const allPaths = varGroups(ctx.scenario).flatMap((g) => g.paths.map((p) => [p.path, `${g.label}: ${p.label}`] as [string, string]));

  const render = (c: Condition, replace: (n: Condition | null) => void, depth: number): HTMLElement => {
    const k = kindOf(c);
    const x = c as Record<string, unknown>;
    const kindSel = sel<CondKind>(k, (Object.keys(COND_LABELS) as CondKind[]).map((kk) => [kk, COND_LABELS[kk]]), (nk) => {
      // グループ同士の切り替えは子を保つ
      if ((nk === 'all' || nk === 'any') && (k === 'all' || k === 'any')) replace({ [nk]: x[k] } as Condition);
      else if ((nk === 'all' || nk === 'any') && k !== 'not') replace({ [nk]: [c] } as Condition);
      else replace(defaultCond(nk, ctx.scenario, ctx.map));
    });
    const del = depth > 0 ? el('button', { class: 'small', title: '削除', onclick: () => replace(null) }, '✕') : null;
    const row = (...kids: (Node | string | null)[]): HTMLElement => el('div', { class: 'cond-row' }, [kindSel, ...kids.filter((n): n is Node | string => n !== null), del ?? '']);
    const up = (patch: Record<string, unknown>): void => replace({ ...x, ...patch } as Condition);
    switch (k) {
      case 'all':
      case 'any': {
        const list = x[k] as Condition[];
        const kids = list.map((child, i) =>
          render(child, (n) => {
            const next = [...list];
            if (n === null) next.splice(i, 1);
            else next[i] = n;
            replace({ [k]: next } as Condition);
          }, depth + 1),
        );
        return el('div', { class: 'cond' }, [
          row(),
          ...kids,
          el('div', { class: 'cond-row' }, [
            el('button', { class: 'small', onclick: () => replace({ [k]: [...list, defaultCond('var', ctx.scenario, ctx.map)] } as Condition) }, '+ 条件'),
            el('button', { class: 'small', onclick: () => replace({ [k]: [...list, { any: [] }] } as Condition) }, '+ グループ'),
          ]),
        ]);
      }
      case 'not':
        return el('div', { class: 'cond' }, [row(), render(x['not'] as Condition, (n) => replace(n === null ? defaultCond('flag', ctx.scenario, ctx.map) : { not: n }), depth + 1)]);
      case 'var': {
        const v = c as { var: string; op: CmpOp; value: number | string | boolean };
        const known = allPaths.some((p) => p[0] === v.var);
        const pathSel = sel(known ? v.var : '__custom', [...allPaths, ['__custom', '（直接入力）']], (p) => p !== '__custom' && up({ var: p }), 'cond-path');
        const custom = known ? null : inp(v.var, (p) => up({ var: p }), { style: 'width:12em' });
        const op = sel<CmpOp>(v.op, (['<', '<=', '>', '>=', '==', '!='] as CmpOp[]).map((o) => [o, o]), (o) => up({ op: o }));
        const val = inp(String(v.value), (s) => up({ value: s === 'true' ? true : s === 'false' ? false : Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : s }), { style: 'width:6em' });
        return row(pathSel, custom, op, val);
      }
      case 'after':
      case 'before':
        return row(inp(String(x[k]), (s) => up({ [k]: s.trim() }), { style: 'width:7em', placeholder: 'D0 14:00' }));
      case 'atNode':
      case 'beenAt':
        return row(sel(String(x[k]), nodes, (n) => up({ [k]: n })));
      case 'onEdge':
        return row(sel(String(x[k]), edges, (e) => up({ [k]: e })));
      case 'near': {
        const n = x['near'] as { x: number; z: number; r: number };
        return row(
          'x',
          inp(n.x, (s) => up({ near: { ...n, x: Number(s) } }), { type: 'number', style: 'width:5em' }),
          'z',
          inp(n.z, (s) => up({ near: { ...n, z: Number(s) } }), { type: 'number', style: 'width:5em' }),
          '半径',
          inp(n.r, (s) => up({ near: { ...n, r: Number(s) } }), { type: 'number', style: 'width:4em' }),
        );
      }
      case 'state':
        return row(sel(String(x['state']) as BehaviorState, STATES.map((st) => [st, TEXT.labels.state[st] ?? st]), (st) => up({ state: st })));
      case 'flag':
        return row(inp(String(x['flag']), (s) => up({ flag: s.trim() }), { style: 'width:10em' }));
      case 'chose': {
        const ch = x['chose'] as { cp: string; option: string };
        const cp = ctx.scenario.choices.find((p) => p.id === ch.cp);
        return row(
          sel(ch.cp, ctx.scenario.choices.map((p) => [p.id, p.title || p.id]), (id) => up({ chose: { cp: id, option: ctx.scenario.choices.find((p) => p.id === id)?.options[0]?.id ?? '' } })),
          sel(ch.option, (cp?.options ?? []).map((o) => [o.id, o.label || o.id]), (o) => up({ chose: { ...ch, option: o } })),
        );
      }
      case 'event':
        return row(sel(String(x['event']) as SimEventType, EVENTS.map((e) => [e, e]), (e) => up({ event: e })));
      case 'chance':
        return row(inp(Number(x['chance']), (s) => up({ chance: Math.max(0, Math.min(1, Number(s))) }), { type: 'number', step: 0.05, style: 'width:5em' }));
      case 'elapsedSince': {
        const e = x['elapsedSince'] as { flag: string; min: number };
        return row(inp(e.flag, (s) => up({ elapsedSince: { ...e, flag: s.trim() } }), { style: 'width:8em' }), inp(e.min, (s) => up({ elapsedSince: { ...e, min: Number(s) } }), { type: 'number', style: 'width:4em' }), '分');
      }
    }
  };

  const tree = render(root, (n) => commit(n ?? { all: [] }), 0);
  // JSON の直接編集（往復で一致）
  const json = el('textarea', { class: 'mono', rows: 6, style: 'min-height:0' });
  json.value = JSON.stringify(root, null, 1);
  const err = el('small', { class: 'error' });
  json.addEventListener('change', () => {
    try {
      commit(JSON.parse(json.value) as Condition);
    } catch (e) {
      err.textContent = `JSON の誤り: ${String(e)}`;
    }
  });
  const probeOut = el('small', { class: 'note' });
  box.append(
    tree,
    el('details', {}, [el('summary', {}, 'JSON を見る'), json, err]),
    ctx.probe ? el('div', {}, [el('button', { class: 'small', onclick: () => (probeOut.textContent = ctx.probe!(root)) }, '試走で初めて真になる時刻'), ' ', probeOut]) : '',
  );
  return box;
}

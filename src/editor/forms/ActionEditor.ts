/**
 * アクション列の編集（docs/18 §3.2、docs/09 §6）。種類をドロップダウンで選び、種類に応じた入力欄を出す。
 */
import type { Action, MapDef, ScenarioDef } from '../../sim/types';
import { el } from '../../ui/dom';
import { BGM_CATALOG, SE_CATALOG } from '../../sim/scenario/soundCatalog';

type ActionType = Action['type'];

export const ACTION_LABELS: Partial<Record<ActionType, string>> = {
  continueRoute: '計画どおり進む',
  turnBack: '引き返す',
  setRoute: 'ルートを変える',
  goToNode: '地点へ向かう',
  stayInShelter: '小屋にとどまる',
  rest: '休む',
  eat: '食べる',
  drink: '飲む',
  drinkAlcohol: '酒を飲む',
  reportMissing: '家族・仲間が警察に届け出る',
  leaveMap: '地図の外へ移る（下山した人が駅などへ）',
  sound: '効果音を鳴らす',
  music: '音楽を切り替える',
  setPhone: 'スマホをなくす／見つける',
  addAnxiety: '動揺する（不安を足す）',
  illness: '急病の発症',
  medicate: '持病の薬を飲む',
  sting: 'ハチに襲われる',
  epipen: 'エピペンを打つ',
  wearRainwear: '雨具を着る',
  addLayer: '防寒着を足す',
  changeDry: '乾いた服に着替える',
  stopAndCheck: '立ち止まって確かめる',
  checkPosition: '現在地を確かめる',
  bivouac: 'ビバーク',
  stayPut: 'その場で待つ',
  backtrack: '来た道を戻る',
  navigateToTrail: '登山道へ向かう',
  descendDrainage: '沢を下る',
  seekSignal: '電波を探す',
  callRescue: '救助を呼ぶ',
  waitRescue: '救助を待つ',
  setPace: 'ペースを変える',
  lightningPosture: '雷の姿勢をとる',
  moveOffRidge: '稜線から下りる',
  removeMetal: '金属を外す',
  setFlag: 'フラグを立てる',
  clearFlag: 'フラグを消す',
  narrate: 'ログに文を出す',
  abortTrip: '山行を中止する',
  setCohesion: '隊のまとまり',
  soak: '濡れる（渡渉など）',
  goToMember: '仲間のところへ',
  joinGroup: '別のグループと合流',
  say: 'セリフ',
};

export function defaultAction(t: ActionType, s: ScenarioDef, map: MapDef): Action {
  const node = s.plan.route[s.plan.route.length - 1] ?? map.nodes[0]?.id ?? '';
  switch (t) {
    case 'setRoute':
      return { type: t, route: [...s.plan.route] };
    case 'goToNode':
      return { type: t, node, then: 'stay' };
    case 'stayInShelter':
      return { type: t, until: 'dawn' };
    case 'rest':
      return { type: t, minutes: 15 };
    case 'eat':
      return { type: t, kcal: 300 };
    case 'drink':
      return { type: t, liters: 0.3 };
    case 'drinkAlcohol':
      return { type: t, grams: 14 };
    case 'setPhone':
      return { type: t, has: false };
    case 'addAnxiety':
      return { type: t, amount: 20 };
    case 'illness':
      return { type: t, kind: 'random' };
    case 'addLayer':
      return { type: t, clo: 0.3 };
    case 'bivouac':
      return { type: t, until: 'dawn', findLee: true };
    case 'seekSignal':
      return { type: t };
    case 'callRescue':
      return { type: t, via: 'auto' };
    case 'setPace':
      return { type: t, factor: 1.2 };
    case 'lightningPosture':
      return { type: t, minutes: 20 };
    case 'moveOffRidge':
      return { type: t, minDropM: 50 };
    case 'setFlag':
    case 'clearFlag':
      return { type: t, flag: 'flag' };
    case 'narrate':
      return { type: t, text: '' };
    case 'setCohesion':
      return { type: t, cohesion: 'loose' };
    case 'soak':
      return { type: t, level: 'knees' };
    case 'goToMember':
      return { type: t, member: s.party[0]?.id ?? '' };
    case 'joinGroup':
      return { type: t, group: s.groups?.[0]?.id ?? 'main' };
    case 'say':
      return { type: t, text: '' };
    case 'sound':
      return { type: t, id: SE_CATALOG[0]!.id };
    case 'music':
      return { type: t, id: 'drama-dive' };
    case 'leaveMap':
      return { type: t, place: '駅' };
    default:
      return { type: t } as Action;
  }
}

function field(label: string, ctrl: HTMLElement): HTMLElement {
  return el('label', { class: 'cond-row' }, [el('small', {}, label), ctrl]);
}

export function actionEditor(list: Action[], s: ScenarioDef, map: MapDef, commit: (a: Action[]) => void): HTMLElement {
  const nodes = map.nodes.map((n) => [n.id, n.name] as [string, string]);
  const types = Object.keys(ACTION_LABELS) as ActionType[];
  const rows = list.map((a, i) => {
    const set = (patch: Partial<Action> | Action): void => {
      const next = [...list];
      next[i] = { ...a, ...patch } as Action;
      commit(next);
    };
    const x = a as Record<string, unknown>;
    const tsel = el('select', {}, types.map((t) => el('option', { value: t, selected: t === a.type }, ACTION_LABELS[t]!)));
    tsel.addEventListener('change', () => set(defaultAction(tsel.value as ActionType, s, map)));
    const input = (key: string, type = 'text', w = '6em'): HTMLElement => {
      const v = x[key];
      const i2 = el('input', { type, value: v === undefined ? '' : String(v), style: `width:${w}` });
      i2.addEventListener('change', () => set({ [key]: type === 'number' ? Number(i2.value) : i2.value } as Partial<Action>));
      return i2;
    };
    const choose = (key: string, opts: [string, string][]): HTMLElement => {
      const s2 = el('select', {}, opts.map(([v, l]) => el('option', { value: v, selected: x[key] === v }, l)));
      s2.addEventListener('change', () => set({ [key]: s2.value } as Partial<Action>));
      return s2;
    };
    const until = (): HTMLElement => {
      const v = String(x['until'] ?? 'dawn');
      const i2 = el('input', { value: v, style: 'width:7em', list: 'until-list', title: 'dawn（夜明け）/ rescue（救助まで）/ weatherClears（天気の回復）/ D1 06:00' });
      i2.addEventListener('change', () => set({ until: i2.value } as Partial<Action>));
      return i2;
    };
    const extra: (HTMLElement | null)[] = [];
    switch (a.type) {
      case 'setRoute':
        extra.push(field('ルート（ID を空白区切り）', (() => {
          const i2 = el('input', { value: (a.route ?? []).join(' '), style: 'width:16em' });
          i2.addEventListener('change', () => set({ route: i2.value.split(/\s+/).filter(Boolean) } as Partial<Action>));
          return i2;
        })()));
        break;
      case 'goToNode':
        extra.push(field('地点', choose('node', nodes)), field('着いたら', choose('then', [['stay', 'とどまる'], ['continue', 'ルートへ戻る'], ['call', '着いたら通報する']])));
        break;
      case 'stayInShelter':
        extra.push(field('いつまで', until()));
        break;
      case 'bivouac':
        extra.push(field('いつまで', until()), field('風下を探す', (() => {
          const c = el('input', { type: 'checkbox', checked: a.findLee });
          c.addEventListener('change', () => set({ findLee: c.checked } as Partial<Action>));
          return c;
        })()));
        break;
      case 'rest':
        extra.push(field('分', input('minutes', 'number', '4em')));
        break;
      case 'eat':
        extra.push(field('kcal', input('kcal', 'number', '5em')));
        break;
      case 'drink':
        extra.push(field('L', input('liters', 'number', '4em')));
        break;
      case 'drinkAlcohol':
        extra.push(field('アルコール g（缶ビール 350 mL で約 14 g）', input('grams', 'number', '4em')));
        break;
      case 'addLayer':
        extra.push(field('clo', input('clo', 'number', '4em')));
        break;
      case 'seekSignal':
        break;
      case 'callRescue':
        extra.push(field('手段', choose('via', [['auto', '自動'], ['phone', '電話'], ['satellite', '衛星']])));
        break;
      case 'setPace':
        extra.push(field('倍率', input('factor', 'number', '4em')));
        break;
      case 'lightningPosture':
        extra.push(field('分', input('minutes', 'number', '4em')));
        break;
      case 'moveOffRidge':
        extra.push(field('下りる高さ m', input('minDropM', 'number', '4em')));
        break;
      case 'setFlag':
      case 'clearFlag':
        extra.push(field('フラグ', input('flag', 'text', '8em')));
        break;
      case 'narrate':
      case 'say':
        extra.push(field('文', input('text', 'text', '16em')));
        break;
      case 'setCohesion':
        extra.push(field('まとまり', choose('cohesion', [['tight', '一緒に'], ['loose', 'ばらける']])));
        break;
      case 'soak':
        extra.push(field('深さ', choose('level', [['feet', '足首'], ['knees', '膝'], ['waist', '腰'], ['full', '全身']])));
        break;
      case 'goToMember':
        extra.push(field('仲間', choose('member', s.party.map((p) => [p.id, p.name]))));
        break;
      case 'joinGroup':
        extra.push(field('グループ ID', input('group', 'text', '8em')));
        break;
      case 'sound':
        extra.push(field('音', choose('id', SE_CATALOG.map((x) => [x.id, `${x.name}（${x.note}）`]))), field('音量', input('volume', 'number', '4em')));
        break;
      case 'music': {
        const s2 = el('select', {}, [el('option', { value: '', selected: x['id'] === null }, '（自動の曲に戻す）'), ...BGM_CATALOG.map((b) => el('option', { value: b.id, selected: x['id'] === b.id }, `${b.name}（${b.note}）`))]);
        s2.addEventListener('change', () => set({ id: s2.value || null } as Partial<Action>));
        extra.push(field('曲', s2));
        break;
      }
      case 'leaveMap':
        extra.push(field('行き先', input('place', 'text', '10em')));
        break;
      default:
        break;
    }
    const who = el('select', { title: '誰が' }, [el('option', { value: '', selected: !a.who }, '（既定）'), el('option', { value: 'leader', selected: a.who === 'leader' }, 'リーダー'), el('option', { value: 'all', selected: a.who === 'all' }, '全員'), ...s.party.map((p) => el('option', { value: p.id, selected: a.who === p.id }, p.name))]);
    who.addEventListener('change', () => {
      const next = [...list];
      const n = { ...a } as Record<string, unknown>;
      if (who.value) n['who'] = who.value;
      else delete n['who'];
      next[i] = n as Action;
      commit(next);
    });
    return el('div', { class: 'cond-row' }, [
      el('small', {}, `${i + 1}.`),
      tsel,
      ...extra.filter((e): e is HTMLElement => e !== null),
      who,
      el('button', { class: 'small', disabled: i === 0, onclick: () => commit(list.map((_, j) => list[j === i - 1 ? i : j === i ? i - 1 : j]!)) }, '↑'),
      el('button', { class: 'small', onclick: () => commit(list.filter((_, j) => j !== i)) }, '✕'),
    ]);
  });
  return el('div', { class: 'actions-editor' }, [
    ...rows,
    el('datalist', { id: 'until-list' }, ['dawn', 'rescue', 'weatherClears'].map((v) => el('option', { value: v }))),
    el('button', { class: 'small', onclick: () => commit([...list, { type: 'continueRoute' }]) }, '+ アクション'),
  ]);
}

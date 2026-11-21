/**
 * 物語のテンプレートの部品: 分かれ道とできごと（story.ts）。文は事実に沿って、煽らず、淡々と。
 */
import type { Action, ChoiceOptionDef, Condition, ScriptEffect } from '../../sim/types';
import type { StoryTemplate } from './story';

type Tag = 'recommended' | 'risky';
const opt = (id: string, label: string, actions: Action[], tag: Tag | null, base: number, detail?: string): ChoiceOptionDef => ({
  id,
  label,
  ...(detail ? { detail } : {}),
  actions,
  ...(tag ? { tags: [tag] } : {}),
  bias: { base },
});
const withChance = (c: Condition, p: number): Condition => ({ all: [c, { chance: p }] });
const log = (text: string): ScriptEffect => ({ type: 'log', text, important: true });

export const CHOICE_TEMPLATES: StoryTemplate[] = [
  {
    id: 'turnaround', cat: 'choice', icon: '↩', name: '進むか、引き返すか', atNode: true,
    desc: '地点に着いたとき、風や時刻を見て判断します。いちばん基本の分かれ道',
    make: (c) => ({ choices: [{
      id: 'cp_turn', title: '進むか、引き返すか', trigger: { atNode: c.node },
      situation: `{leader.def.name}さんは${c.nodeName}に着いた。風 {leader.local.windMs:0} m/s、体感 {leader.local.windChillC:0}℃。予定より {leader.timeBehindMin:0} 分遅れている。`,
      options: [
        opt('go', '予定どおり進む', [{ type: 'continueRoute' }], 'risky', 1),
        opt('back', '引き返す', [{ type: 'turnBack' }], 'recommended', 0.5),
        ...(c.hut !== c.node ? [opt('hut', `${c.hutName}へ向かう`, [{ type: 'goToNode', node: c.hut, then: 'stay' }], null, 0.4)] : []),
      ],
    }] }),
  },
  {
    id: 'rainwear', cat: 'choice', icon: '☔', name: '雨が降り始めた',
    desc: '雨具をすぐ着るか、あとで着るか。濡れは体温を奪います',
    make: () => ({ choices: [{
      id: 'cp_rain', title: '雨が降り始めた', trigger: { all: [{ event: 'RAIN_START' }, { var: 'leader.rainwearOn', op: '==', value: false }] },
      situation: '雨が降り始めた。気温 {leader.local.tempC:0}℃。',
      options: [
        opt('now', 'すぐに立ち止まって雨具を着る', [{ type: 'wearRainwear' }], 'recommended', 0.5),
        opt('later', 'きりのいい所まで歩いてから着る', [{ type: 'continueRoute' }], 'risky', 1),
      ],
    }] }),
  },
  {
    id: 'hut', cat: 'choice', icon: '🏠', name: '小屋で泊まるか', atNode: true,
    desc: '小屋に着いたとき、泊まる・進む・引き返すを決めます',
    make: (c) => ({ choices: [{
      id: 'cp_hut', title: '小屋で泊まるか', trigger: { atNode: c.hut },
      situation: `${c.hutName}に着いた。予定より {leader.timeBehindMin:0} 分遅れている。`,
      options: [
        opt('stay', '今日はここに泊まる', [{ type: 'stayInShelter', until: 'dawn' }], 'recommended', 0.5),
        opt('go', '先へ進む', [{ type: 'continueRoute' }], 'risky', 1),
        opt('back', '引き返す', [{ type: 'turnBack' }], null, 0.3),
      ],
    }] }),
  },
  {
    id: 'behind', cat: 'choice', icon: '⏰', name: '予定より遅れている',
    desc: '遅れが大きくなったとき。急ぐのは転倒のもとです',
    make: () => ({ choices: [{
      id: 'cp_behind', title: '予定より遅れている', trigger: { var: 'leader.timeBehindMin', op: '>', value: 60 },
      situation: '予定より {leader.timeBehindMin:0} 分遅れている。このままだと、下山は日が暮れてからになりそうだ。',
      options: [
        opt('back', '引き返す', [{ type: 'turnBack' }], 'recommended', 0.4),
        opt('same', 'このままのペースで進む', [{ type: 'continueRoute' }], null, 1),
        opt('hurry', '急ぐ', [{ type: 'setPace', factor: 1.2 }, { type: 'continueRoute' }], 'risky', 0.8, '足元がおろそかになる'),
      ],
    }] }),
  },
  {
    id: 'deadline', cat: 'choice', icon: '⛰', name: '引き返す時刻を過ぎた',
    desc: '決めておいた時刻になっても山頂に着かないとき',
    make: (c) => ({ choices: [{
      id: 'cp_deadline', title: '引き返す時刻を過ぎた', trigger: { after: c.timeAt(6) },
      situation: '決めておいた引き返す時刻になった。山頂はまだ先だ。',
      options: [
        opt('back', '決めたとおり引き返す', [{ type: 'turnBack' }], 'recommended', 0.4),
        opt('go', 'せっかくなので山頂まで行く', [{ type: 'continueRoute' }], 'risky', 1),
      ],
    }] }),
  },
  {
    id: 'tired', cat: 'choice', icon: '😮‍💨', name: '仲間が疲れている',
    desc: 'だれかの疲れが大きくなったとき。休む・食べる・ペースを落とす',
    make: () => ({ choices: [{
      id: 'cp_tired', title: '仲間が疲れている', trigger: { var: 'party.max.fatigue', op: '>', value: 70 },
      situation: '足どりが重くなってきた人がいる。口数も減っている。',
      options: [
        opt('rest', '休んで、食べて、飲む', [{ type: 'rest', minutes: 20 }, { type: 'eat', kcal: 300 }, { type: 'drink', liters: 0.3 }], 'recommended', 0.6),
        opt('slow', 'ペースを落として進む', [{ type: 'setPace', factor: 0.8 }, { type: 'continueRoute' }], null, 0.8),
        opt('push', 'そのまま進む', [{ type: 'continueRoute' }], 'risky', 1),
      ],
    }] }),
  },
  {
    id: 'crossing', cat: 'choice', icon: '🌊', name: '沢を渡るか', atNode: true,
    desc: '増水した沢の前で。濡れると体が冷えます',
    make: (c) => ({ choices: [{
      id: 'cp_cross', title: '沢を渡るか', trigger: { atNode: c.node },
      situation: `${c.nodeName}の沢は、いつもより水が多い。膝まで浸かれば渡れそうだ。`,
      options: [
        opt('back', '渡らずに引き返す', [{ type: 'turnBack' }], 'recommended', 0.4),
        opt('wait', '水が引くのを 1 時間待つ', [{ type: 'rest', minutes: 60 }], null, 0.4),
        opt('cross', '渡る', [{ type: 'soak', level: 'knees' }, { type: 'continueRoute' }], 'risky', 1),
      ],
    }] }),
  },
  {
    id: 'wind', cat: 'choice', icon: '💨', name: '稜線の風が強い',
    desc: '風が強まったとき。体感温度が下がり、ふらつきます',
    make: (c) => ({ choices: [{
      id: 'cp_wind', title: '風が強い', trigger: { var: 'leader.local.windMs', op: '>', value: 15 },
      situation: '風 {leader.local.windMs:0} m/s。体が押される。体感 {leader.local.windChillC:0}℃。',
      options: [
        opt('back', '引き返す', [{ type: 'turnBack' }], 'recommended', 0.5),
        opt('layer', '防寒着を足して進む', [{ type: 'addLayer', clo: 0.3 }, { type: 'continueRoute' }], null, 0.8),
        ...(c.hut !== c.node ? [opt('hut', `${c.hutName}へ向かう`, [{ type: 'goToNode', node: c.hut, then: 'stay' } as Action], null, 0.5)] : []),
        opt('go', 'そのまま進む', [{ type: 'continueRoute' }], 'risky', 1),
      ],
    }] }),
  },
  {
    id: 'injuryCall', cat: 'choice', icon: '🚑', name: 'けが人が出た',
    desc: 'だれかがけがをしたとき。救助を呼ぶか、様子を見るか',
    make: () => ({ choices: [{
      id: 'cp_injury', title: 'けが人が出た', trigger: { event: 'INJURY' },
      situation: 'けがをした人がいる。歩けるかどうか、まだ分からない。',
      options: [
        opt('call', '救助を要請して、その場で待つ', [{ type: 'callRescue', via: 'auto' }, { type: 'waitRescue' }], 'recommended', 0.5),
        opt('rest', '30 分休んで様子を見る', [{ type: 'rest', minutes: 30 }], null, 0.8),
        opt('walk', '自力で下りる', [{ type: 'continueRoute' }], 'risky', 0.8),
      ],
    }] }),
  },
  {
    id: 'gLost', cat: 'choice', icon: '🧭', name: '道に迷ったと気づいた（文を変える）',
    desc: '自動で出る「道に迷った」の分かれ道の、状況の文を書き換えます',
    make: () => ({ generic: { lostAware: { enabled: true, situation: '見覚えのない沢筋に出た。{leader.def.name}さんは、道を外れたことに気づいた。' } } }),
  },
  {
    id: 'gDark', cat: 'choice', icon: '🌙', name: '日が暮れた（文を変える）',
    desc: '自動で出る「日が暮れた」の分かれ道の、状況の文を書き換えます',
    make: () => ({ generic: { darkness: { enabled: true, situation: '日が沈み、足元が見えにくくなってきた。下山口はまだ先だ。' } } }),
  },
  {
    id: 'gThunder', cat: 'choice', icon: '⚡', name: '雷が近い（文を変える）',
    desc: '自動で出る「雷」の分かれ道の、状況の文を書き換えます',
    make: () => ({ generic: { lightning: { enabled: true, situation: '雷鳴が近い。稜線の上にいる。' } } }),
  },
];

export const EVENT_TEMPLATES: StoryTemplate[] = [
  {
    id: 'forecast', cat: 'event', icon: '📻', name: '天気予報の更新が届く',
    desc: '時刻になると、新しい予報が届きます（電波が要る）',
    make: (c) => ({ events: [{ id: 'ev_forecast', trigger: { after: c.timeAt(3) }, once: true, effects: [{ type: 'forecastUpdate', entries: [{ label: '午後', text: '雨。稜線は風が強まる' }], requiresSignal: true }] }] }),
  },
  {
    id: 'narration', cat: 'event', icon: '📝', name: 'ナレーション', atNode: true,
    desc: '地点に着いたとき、ログに文を出します',
    make: (c) => ({ events: [{ id: 'ev_note', trigger: { atNode: c.node }, once: true, effects: [log(`${c.nodeName}に着いた。ここから先は、道が細くなる。`)] }] }),
  },
  {
    id: 'sprain', cat: 'event', icon: '🩹', name: '足をひねる', atNode: true,
    desc: '地点で、ある確率でリーダーが足をひねります',
    make: (c) => ({ events: [{ id: 'ev_sprain', trigger: withChance({ atNode: c.node }, 0.3), once: true, effects: [{ type: 'injure', who: 'leader', injury: 'sprain' }, log('浮き石に乗って、足をひねった。')] }] }),
  },
  {
    id: 'rockfall', cat: 'event', icon: '🪨', name: '落石', atNode: true,
    desc: '地点で石が落ちてきます。当たるかどうかは確率',
    make: (c) => ({ events: [{ id: 'ev_rock', trigger: { atNode: c.node }, once: true, effects: [log('上のほうで、石の転がる音がした。'), { type: 'rockfall', who: 'leader', p: 0.3, injuryTable: 'T2' }] }] }),
  },
  {
    id: 'soak', cat: 'event', icon: '💧', name: '沢で濡れる', atNode: true,
    desc: '地点で、全員が膝まで濡れます',
    make: (c) => ({ events: [{ id: 'ev_soak', trigger: { atNode: c.node }, once: true, effects: [{ type: 'soak', who: 'all', level: 'knees' }, log('沢を渡った。膝まで濡れた。')] }] }),
  },
  {
    id: 'deer', cat: 'event', icon: '🦌', name: '鹿を見かける', atNode: true,
    desc: '地点の先に鹿の群れがいます。近づくと立ち去ります',
    make: (c) => ({ events: [{ id: 'ev_deer', trigger: { atNode: c.node }, once: true, effects: [{ type: 'animal', species: 'deer', count: 3, aheadM: 60, sideM: 20 }] }] }),
  },
  {
    id: 'bear', cat: 'event', icon: '🐻', name: '熊に出会う', atNode: true,
    desc: '地点の先に熊がいます。近づくと、低い確率で向かってきます',
    make: (c) => ({ events: [{ id: 'ev_bear', trigger: { atNode: c.node }, once: true, effects: [{ type: 'animal', species: 'bear', count: 1, aheadM: 80, sideM: 10 }] }] }),
  },
  {
    id: 'bees', cat: 'event', icon: '🐝', name: 'ハチに襲われる', atNode: true,
    desc: '地点で、ある確率でハチに刺されます',
    make: (c) => ({ events: [{ id: 'ev_bees', trigger: withChance({ atNode: c.node }, 0.4), once: true, effects: [log('羽音がする。ハチの巣が近い。'), { type: 'actions', actions: [{ type: 'sting', p: 0.5 }] }] }] }),
  },
  {
    id: 'phoneLost', cat: 'event', icon: '📵', name: 'スマホをなくす', atNode: true,
    desc: '地点で、リーダーがスマホを落とします（地図アプリ・通報が使えない）',
    make: (c) => ({ events: [{ id: 'ev_phone', trigger: { atNode: c.node }, once: true, effects: [{ type: 'actions', actions: [{ type: 'setPhone', has: false }] }, log('ポケットに入れていたスマホがない。どこかで落としたらしい。')] }] }),
  },
  {
    id: 'family', cat: 'event', icon: '☎', name: '家族が警察に届け出る',
    desc: '時刻になっても帰らないとき、家族が届け出ます',
    make: (c) => ({ events: [{ id: 'ev_family', trigger: { after: c.timeAt(15) }, once: true, effects: [{ type: 'actions', actions: [{ type: 'reportMissing' }] }] }] }),
  },
];

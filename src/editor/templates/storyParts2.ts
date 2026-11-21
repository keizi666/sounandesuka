/**
 * 物語のテンプレートの部品: 会話・心の声、結末・教訓、物語の型（story.ts）。
 */
import type { StoryTemplate, TplCtx } from './story';
import { mergeAdds } from './story';
import { CHOICE_TEMPLATES, EVENT_TEMPLATES } from './storyParts';

export const TALK_TEMPLATES: StoryTemplate[] = [
  {
    id: 'talkStart', cat: 'talk', icon: '👋', name: '出発のひとこと',
    desc: '歩き始めに、リーダーがひとこと言います',
    make: (c) => ({ speech: [{ key: 'sp_start', who: 'leader', when: { after: c.s.startAt }, once: true, lines: ['じゃあ、行きましょう', '天気は持ちそうですね。出発します'] }] }),
  },
  {
    id: 'talkArrive', cat: 'talk', icon: '🚩', name: '着いたときのひとこと', atNode: true,
    desc: '地点に着いたとき、だれかが話します（返事つき）',
    make: (c) => ({ speech: [{ key: 'sp_arrive', who: 'any', to: 'any', when: { atNode: c.node }, once: true, lines: [`${c.nodeName}だ。少し休もう`, `やっと${c.nodeName}まで来た`], replies: { who: 'any', lines: ['思ったより時間がかかったね', '水を飲んでおこう'] } }] }),
  },
  {
    id: 'talkRain', cat: 'talk', icon: '🌧', name: '雨のひとこと',
    desc: '雨が降り始めたとき',
    make: () => ({ speech: [{ key: 'sp_rain', who: 'any', when: { event: 'RAIN_START' }, cooldownMin: 120, lines: ['降ってきた', '予報より早いな'] }] }),
  },
  {
    id: 'talkTired', cat: 'talk', icon: '🥵', name: '疲れたときのひとこと',
    desc: '疲れが大きくなったとき（ときどき）',
    make: () => ({ speech: [{ key: 'sp_tired', who: 'any', to: 'leader', when: { var: 'party.max.fatigue', op: '>', value: 60 }, cooldownMin: 90, lines: ['ちょっと、ペースが速いです', '少し休みませんか'], replies: { who: 'leader', lines: ['次の平らな所で休もう', 'もう少しだけ頑張ろう'] } }] }),
  },
  {
    id: 'talkDark', cat: 'talk', icon: '🔦', name: '暗くなったときのひとこと',
    desc: '暗くなったとき',
    make: () => ({ speech: [{ key: 'sp_dark', who: 'any', when: { event: 'DARK' }, once: true, lines: ['もう足元が見えない', 'ヘッドランプを出そう'] }] }),
  },
  {
    id: 'thinkCold', cat: 'talk', icon: '🥶', name: '心の声: 寒い',
    desc: '体が冷えてきたときの考え',
    make: () => ({ thoughts: [{ key: 'th_cold', when: { var: 'leader.coreC', op: '<', value: 35.5 }, lines: ['寒い……手がうまく動かない', '震えが止まらない'] }] }),
  },
  {
    id: 'thinkAnxious', cat: 'talk', icon: '😟', name: '心の声: 不安',
    desc: '不安が大きくなったときの考え',
    make: () => ({ thoughts: [{ key: 'th_anx', when: { var: 'leader.anxiety', op: '>', value: 60 }, lines: ['この道で合っているのか', '引き返すなら、いましかない'] }] }),
  },
];

export const ENDING_TEMPLATES: StoryTemplate[] = [
  {
    id: 'endings', cat: 'ending', icon: '🏁', name: '結末の基本セット',
    desc: '無事下山・小屋で安全を確保・救助・未帰還・死亡の 5 つの文をまとめて入れます',
    make: () => ({ endings: [
      { kind: 'SAFE_RETURN', title: '無事に下山した', text: '日のあるうちに下山口へ戻った。判断の一つ一つが、この結果につながった。' },
      { kind: 'SAFE_SHELTER', title: '小屋で夜を明かした', text: '無理をせず小屋にとどまり、安全を確保した。' },
      { kind: 'RESCUED', title: '救助された', text: '救助隊に収容された。早めの要請が、命をつないだ。' },
      { kind: 'MISSING', title: '帰らなかった', text: '制限時刻を過ぎても下山せず、見つかっていない。' },
      { kind: 'FATAL', title: '帰らぬ人となった', text: '登山者は帰らなかった。どこで、別の判断ができただろうか。' },
    ] }),
  },
  {
    id: 'lesRain', cat: 'ending', icon: '☔', name: '教訓: 雨具は降り始めに',
    desc: '雨具を着るのが 20 分より遅れたときに出します',
    make: () => ({ lessons: [{ id: 'l_rain', when: { var: 'rec.rainwearDelayMin', op: '>', value: 20 }, title: '雨具は降り始めに着る', text: '雨具を着るまでに {rec.rainwearDelayMin:0} 分かかった。濡れた体は、風で一気に冷える。「降り始めたらすぐ着る」と決めておく。' }] }),
  },
  {
    id: 'lesLost', cat: 'ending', icon: '🧭', name: '教訓: 迷ったら戻る',
    desc: '道に迷ったときに出します',
    make: () => ({ lessons: [{ id: 'l_lost', when: { var: 'rec.wasLost', op: '==', value: true }, title: '迷ったら、分かる所まで戻る', text: '道を外れていた時間は {rec.lostMinutes:0} 分。おかしいと思ったら、沢へ下らず、最後に確かだった所まで戻る。' }] }),
  },
  {
    id: 'lesCold', cat: 'ending', icon: '🥶', name: '教訓: 低体温症',
    desc: '体温が 35℃ を下回ったときに出します',
    make: () => ({ lessons: [{ id: 'l_cold', when: { var: 'rec.minCoreC', op: '<', value: 35 }, title: '濡れ・風・疲れが体温を奪う', text: '体温は {rec.minCoreC:1}℃ まで下がった。濡れ・風・エネルギー切れが重なると、夏でも低体温症になる。' }] }),
  },
  {
    id: 'lesDark', cat: 'ending', icon: '🌙', name: '教訓: 早出早着',
    desc: '暗い中を 30 分より長く歩いたときに出します',
    make: () => ({ lessons: [{ id: 'l_dark', when: { var: 'rec.darkMinutesMoving', op: '>', value: 30 }, title: '日が暮れる前に下りる', text: '暗い中を {rec.darkMinutesMoving:0} 分歩いた。暗いと転びやすく、道も見失いやすい。引き返す時刻を、出発の前に決めておく。' }] }),
  },
  {
    id: 'lesAlways', cat: 'ending', icon: '📋', name: '教訓: いつも出す',
    desc: 'どの結末でも出す教訓（計画・登山届など）',
    make: () => ({ lessons: [{ id: 'l_plan', title: '計画と登山届', text: '行き先・ルート・下山の予定時刻を、家族や登山届で伝えておく。帰らないとき、捜す範囲がすぐに絞れる。' }] }),
  },
];

const PARTS: StoryTemplate[] = [...CHOICE_TEMPLATES, ...EVENT_TEMPLATES, ...TALK_TEMPLATES, ...ENDING_TEMPLATES];
const kit = (id: string, icon: string, name: string, desc: string, parts: string[]): StoryTemplate => ({
  id, cat: 'kit', icon, name, desc: `${desc}（${parts.length} 個の部品）`,
  make: (c: TplCtx) => mergeAdds(parts.map((p) => PARTS.find((x) => x.id === p)!.make(c))),
});

export const KIT_TEMPLATES: StoryTemplate[] = [
  kit('kitWeather', '🌦', '天気が崩れる日帰り', '予報の更新 → 雨 → 進むか引き返すか。雨具と体温の教訓つき', ['talkStart', 'forecast', 'rainwear', 'turnaround', 'talkRain', 'thinkCold', 'endings', 'lesRain', 'lesCold']),
  kit('kitLate', '🌇', '遅れと日暮れ', '遅れが積み重なり、暗くなる。引き返す時刻と道迷いの教訓つき', ['talkStart', 'behind', 'deadline', 'gDark', 'talkDark', 'thinkAnxious', 'endings', 'lesDark', 'lesLost']),
  kit('kitTired', '🥾', '疲れた仲間', '疲れた仲間をどうするか。休む・ペースを落とす・小屋に泊まる', ['talkStart', 'tired', 'talkTired', 'hut', 'endings', 'lesAlways']),
  kit('kitInjury', '🚑', 'けがと救助', '足をひねる → 救助を呼ぶか。家族の届け出つき', ['talkStart', 'sprain', 'injuryCall', 'family', 'endings', 'lesAlways']),
  kit('kitAnimal', '🐻', '動物との遭遇', '鹿を見かけ、その先で熊に出会う', ['talkStart', 'deer', 'bear', 'thinkAnxious', 'endings', 'lesAlways']),
];

export const STORY_TEMPLATES: StoryTemplate[] = [...KIT_TEMPLATES, ...PARTS];

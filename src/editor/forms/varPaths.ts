/**
 * 条件・文で使える変数パスの候補（docs/09 §4.1）。sim/scenario/vars.ts の一覧から作る。
 */
import { AGG_FIELDS, CLIMBER_FIELDS, DEF_FIELDS, GLOBAL_FIELDS, GROUP_COUNTS, LOCAL_FIELDS, REC_FIELDS } from '../../sim/scenario/vars';
import { ANIMAL_SPECIES } from '../../sim/hazards/animals';
import type { ScenarioDef } from '../../sim/types';
import { JA as TEXT } from '../../i18n/ja';

const JA: Record<string, string> = {
  coreC: '深部体温',
  wetness: '濡れ',
  glycogenKcal: 'エネルギー',
  waterDeficitL: '水分不足',
  fatigue: '疲労',
  anxiety: '不安',
  J: '判断力',
  M: '運動能力',
  state: '状態',
  elevM: '標高',
  injury: 'けが',
  rainwearOn: '雨具を着ている',
  awareLost: '迷ったと気づいている',
  knowsPosition: '現在地が分かる',
  conscious: '意識がある',
  alive: '生きている',
  stage: '低体温症の段階',
  radio: '電波',
  timeBehindMin: '予定からの遅れ（分）',
  'phone.batteryPct': 'スマホの電池',
  'phone.gpsApp': '地図アプリ',
  nearestShelterM: '最寄りの小屋まで（m）',
  tempC: '気温',
  windMs: '風速',
  windDirDeg: '風向',
  precipMmH: '降水',
  precipType: '降水の種類',
  visibilityM: '視程',
  windChillC: '体感温度',
  thunder: '雷',
  solarW: '日射',
  inCloud: '雲の中',
  cloudCover: '雲量',
  cloudBaseM: '雲底',
  inCloudVisibilityM: '雲の中の視程',
  pressureHpa: '気圧',
  gust: '突風',
  experience: '経験',
  fitness: '体力',
  navSkill: '読図力',
  riskTolerance: '危険を許す度合い',
  age: '年齢',
  weightKg: '体重',
  packKg: '荷物',
  deathCount: '死亡者数',
  minCoreC: '最低体温',
  maxAnxiety: '最大の不安',
  fallCount: '転倒回数',
  rainwearDelayMin: '雨具の遅れ（分）',
  wasLost: '道に迷った',
  lostMinutes: '迷っていた時間',
  darkMinutesMoving: '暗い中を歩いた時間',
  rescueCalledAt: '救助要請の時刻',
  finalState: '最後の状態',
  endingKind: '結末',
  count: '人数',
  incapacitatedCount: '動けない人数',
  below35Count: '35℃未満の人数',
};

export interface VarGroup {
  label: string;
  paths: { path: string; label: string }[];
}

export function varGroups(s: ScenarioDef): VarGroup[] {
  const groups: VarGroup[] = [
    { label: 'リーダー', paths: CLIMBER_FIELDS.filter((f) => f !== 'name' && f !== 'id').map((f) => ({ path: `leader.${f}`, label: `リーダーの${JA[f] ?? f}` })) },
    { label: 'リーダーの局地気象', paths: LOCAL_FIELDS.map((f) => ({ path: `leader.local.${f}`, label: `局地の${JA[f] ?? f}` })) },
    { label: 'リーダーの人物', paths: DEF_FIELDS.filter((f) => f !== 'name').map((f) => ({ path: `leader.def.${f}`, label: `リーダーの${JA[f] ?? f}` })) },
    { label: '全体の気象', paths: GLOBAL_FIELDS.map((f) => ({ path: `g.${f}`, label: `全体の${JA[f] ?? f}` })) },
    { label: '時刻', paths: [{ path: 't', label: '経過分（D0 0:00 から）' }, { path: 'clockMin', label: '時刻（0〜1439 分）' }, { path: 'sun.isDark', label: '暗い' }, { path: 'sun.elevDeg', label: '太陽高度' }] },
    {
      label: 'パーティ',
      paths: [
        ...GROUP_COUNTS.map((f) => ({ path: `party.${f}`, label: `パーティの${JA[f] ?? f}` })),
        ...AGG_FIELDS.flatMap((f) => [
          { path: `party.min.${f}`, label: `パーティの最低の${JA[f] ?? f}` },
          { path: `party.max.${f}`, label: `パーティの最高の${JA[f] ?? f}` },
        ]),
      ],
    },
    { label: '野生動物（リーダーからの距離 m。いなければ 99999）', paths: [{ path: 'animal.any', label: 'いちばん近い動物までの距離' }, ...ANIMAL_SPECIES.map((sp) => ({ path: `animal.${sp}`, label: `${TEXT.log.animal[sp] ?? sp}までの距離` }))] },
    { label: '記録（結末・教訓）', paths: REC_FIELDS.map((f) => ({ path: `rec.${f}`, label: `記録: ${JA[f] ?? f}` })) },
  ];
  for (const p of s.party) {
    groups.push({ label: `${p.name}（${p.id}）`, paths: CLIMBER_FIELDS.filter((f) => f !== 'name' && f !== 'id').map((f) => ({ path: `c.${p.id}.${f}`, label: `${p.name}の${JA[f] ?? f}` })) });
  }
  return groups;
}

export function varLabel(s: ScenarioDef, path: string): string {
  for (const g of varGroups(s)) for (const p of g.paths) if (p.path === path) return p.label;
  return path;
}

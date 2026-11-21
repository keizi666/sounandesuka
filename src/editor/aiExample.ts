/**
 * AI に渡すプロンプトの「例」（形式の見本）。tests/aiStandalone.test.ts で検証とヘッドレスの試走を通しているので、
 * 型や検証が変わって例が古くなればテストが落ちる（手で書いた見本が仕様と食い違わないように）。
 * - EXAMPLE_SCENARIO: 架空の箱庭岳（mapId "sounan"）の小さなシナリオ
 * - EXAMPLE_SKELETON: 実在の山のスケルトンマップ（座標なし。エディターで地理院の標高・OSM の登山道と結合する）
 */
import type { MapDef, ScenarioDef } from '../sim/types';

export const EXAMPLE_SCENARIO: ScenarioDef = {
  id: 'ai_example_ridge',
  version: 1,
  title: '稜線小屋の判断',
  subtitle: '10月・単独・天気の崩れ',
  theme: 'hypothermia',
  difficulty: 2,
  season: 'autumn',
  estMinutes: 10,
  mapId: 'sounan',
  seed: 1021,
  startDate: '2026-10-21',
  startAt: 'D0 06:00',
  timeLimit: 'D1 12:00',
  sun: { sunrise: '05:55', sunset: '17:00', maxElevDeg: 41 },
  moon: { illumination: 0.4 },
  briefing: {
    text: '会社員の木村さん（38）は、箱庭岳を沢入口から北登山口へ縦走する日帰りの計画。午後から天気が崩れる予報が出ている。',
    forecast: [
      { label: '朝', text: '晴れ', icon: 'sunny' },
      { label: '午後', text: '雨・稜線は強風', icon: 'rain' },
    ],
  },
  plan: {
    route: ['TH_SAWA', 'J_FOREST', 'EBOSHI', 'HUT_RIDGE', 'SUMMIT', 'SADDLE_N', 'MIKAERI', 'TH_KITA'],
    goalNodes: ['TH_KITA', 'TH_SAWA'],
    plannedFinish: 'D0 15:30',
    submittedPlan: true,
    reportIfNotBackBy: 'D0 21:00',
  },
  party: [
    {
      id: 'kimura',
      name: '木村',
      age: 38,
      sex: 'm',
      weightKg: 66,
      packKg: 8,
      experience: 0.4,
      fitness: 1,
      navSkill: 0.5,
      riskTolerance: 0.6,
      color: '#d9452b',
      leader: true,
      habits: { eatEveryMin: 120, drinkEveryMin: 60, delaysRainwear: 0.5, gpsCheckEveryMin: null },
      gear: {
        rainwear: 'basic',
        cloWorn: 0.9,
        cloPack: 0.5,
        gloves: 'thin',
        hat: true,
        bivy: 'none',
        headlamp: { has: true, batteryH: 6, inPack: true, spareBatteryH: 0 },
        phone: { has: true, batteryPct: 80, gpsApp: true, trackRecording: false, satelliteSos: false },
        map: true,
        compass: false,
        foodKcal: 1200,
        waterL: 1.5,
        stove: false,
        crampons: false,
        helmet: false,
        trekkingPoles: true,
        whistle: true,
      },
    },
  ],
  weather: {
    refElevM: 1000,
    lapseRateCPer100m: 0.65,
    cloudThicknessM: 1500,
    keyframes: [
      { at: 'D0 06:00', tempC: 10, windMs: 3, windDirDeg: 230, precipMmH: 0, cloudCover: 0.3, cloudBaseM: 3000, visibilityM: 25000, pressureHpa: 1012 },
      { at: 'D0 11:00', tempC: 11, windMs: 6, windDirDeg: 230, precipMmH: 0, cloudCover: 0.8, cloudBaseM: 1900, visibilityM: 8000, pressureHpa: 1006 },
      { at: 'D0 13:00', tempC: 8, windMs: 12, windDirDeg: 250, precipMmH: 4, cloudCover: 1, cloudBaseM: 1300, visibilityM: 400, inCloudVisibilityM: 60, pressureHpa: 1002 },
      { at: 'D0 20:00', tempC: 5, windMs: 9, windDirDeg: 300, precipMmH: 1, cloudCover: 0.9, cloudBaseM: 1500, visibilityM: 2000, pressureHpa: 1008 },
      { at: 'D1 06:00', tempC: 4, windMs: 4, windDirDeg: 300, precipMmH: 0, cloudCover: 0.3, cloudBaseM: 2500, visibilityM: 20000, pressureHpa: 1014 },
    ],
  },
  events: [
    {
      id: 'ev_clouds',
      trigger: { after: 'D0 11:00' },
      effects: [
        { type: 'log', text: '西の空から雲が広がってきた。' },
        { type: 'forecastUpdate', entries: [{ label: '午後', text: '13時ごろから雨。稜線は風速15 m/s前後', icon: 'rain' }], requiresSignal: true },
      ],
    },
  ],
  choices: [
    {
      id: 'cp_hut',
      title: '稜線小屋で',
      trigger: { atNode: 'HUT_RIDGE' },
      situation: '稜線小屋に着いた。雲が低くなり、風は秒速 {leader.local.windMs:0} m。この先の岩稜は風をさえぎるものがない。',
      knowledge: ['小屋は営業していて、泊まることもできる', 'ここから北登山口まで、コースタイムで約4時間'],
      options: [
        {
          id: 'go',
          label: '予定どおり縦走を続ける',
          detail: '雨が本降りになる前に岩稜を抜けたい。',
          actions: [{ type: 'continueRoute' }],
          tags: ['risky'],
          bias: { base: 1, mods: [{ when: { var: 'leader.def.riskTolerance', op: '>', value: 0.5 }, add: 0.5 }] },
        },
        {
          id: 'back',
          label: '来た道を引き返す',
          detail: '樹林帯の道なら風は弱い。',
          actions: [{ type: 'wearRainwear' }, { type: 'turnBack' }],
          tags: ['recommended'],
          bias: { base: 0.8 },
        },
        {
          id: 'stay',
          label: '小屋に泊まる',
          detail: '家族に電話して、明日の朝に下りる。',
          actions: [{ type: 'stayInShelter', until: 'D1 06:00' }],
          tags: ['recommended'],
          bias: { base: 0.6 },
        },
      ],
    },
  ],
  genericOverrides: {
    hypothermia: { situation: '手が思うように動かず、震えが止まらない。体が冷えきっている。' },
  },
  thoughts: [{ key: 'th_wind', who: 'leader', when: { var: 'leader.local.windMs', op: '>', value: 10 }, lines: ['風で体が持っていかれそうだ。'] }],
  endings: [
    { kind: 'SAFE_RETURN', title: '無事に下山', text: '木村さんは登山口へ下りた。いちばん下がった体温は {rec.minCoreC:1} ℃だった。' },
    { kind: 'SAFE_SHELTER', title: '小屋で一夜', text: '木村さんは稜線小屋で嵐をやり過ごし、翌朝に下山した。' },
    { kind: 'ABORTED', title: '山に入らなかった', text: '木村さんは山行をやめた。' },
    { kind: 'SELF_RESCUE', title: 'ビバークの末に', text: '一晩を外で過ごし、自力で下りた。' },
    { kind: 'RESCUED', title: '救助された', text: '木村さんは救助隊に保護された。' },
    { kind: 'RESCUED_CRITICAL', title: '重い低体温症で救助', text: '救助されたとき、木村さんの体は深く冷えていた。' },
    { kind: 'MISSING', title: '見つからない', text: '捜索は続いている。' },
    { kind: 'FATAL', title: '帰らなかった', text: '木村さんは低体温症で亡くなった。' },
  ],
  lessons: [
    { id: 'l_turn', when: { chose: { cp: 'cp_hut', option: 'go' } }, title: '引き返す基準を決めておく', text: '天気が崩れる予報の日は、どこで何を見たら引き返すかを出発前に決めておく。' },
    { id: 'l_rain', title: '雨具は濡れる前に着る', text: '風のある稜線で濡れると、夏でも体温は急に下がる。' },
  ],
  balanceTargets: { recommended: { goodMin: 0.9, fatalMax: 0.02 } },
  region: { name: '箱庭岳（架空の山）', real: false },
  sources: ['原案: （ここに参考文献のタイトルと URL）'],
};

/** 実在の山のスケルトンマップの例（座標は 0。名前と概略の標高・コースタイムで、エディターが地理院・OSM のデータと結び付ける） */
export const EXAMPLE_SKELETON: MapDef = {
  id: 'takao_inari',
  name: '高尾山（稲荷山コース〜城山）',
  skeleton: true,
  areaHint: { text: '東京都八王子市の高尾山。京王線の高尾山口駅から稲荷山コースで山頂、もみじ台・一丁平を経て小仏城山まで。一辺 5 km 程度。', sizeM: 5120 },
  geo: { centerLat: 35.6312, centerLon: 139.2492, projection: 'local-tangent' },
  size: 5120,
  resolution: 385,
  terrain: { type: 'heightmap', encoding: 'u16-base64', minElevM: 0, maxElevM: 1, baseElevation: 0, smoothingPasses: 1, source: { dem: 'DEM10B', zoom: 14, fetchedAt: '' }, data: '' },
  vegetation: { forestLine: 2500, forestLineNoise: 60, broadleafLine: 1600 },
  nodes: [
    { id: 'TH_STATION', name: '高尾山口駅', type: 'trailhead', x: 0, z: 0, osmName: '高尾山口', expectedElevM: 190 },
    { id: 'INARI', name: '稲荷山', type: 'landmark', x: 0, z: 0, osmName: '稲荷山', expectedElevM: 400 },
    { id: 'TAKAO', name: '高尾山', type: 'peak', x: 0, z: 0, osmName: '高尾山', expectedElevM: 599 },
    { id: 'MOMIJI', name: 'もみじ台', type: 'junction', x: 0, z: 0, osmName: 'もみじ台', expectedElevM: 580 },
    { id: 'ICHOUDAIRA', name: '一丁平', type: 'landmark', x: 0, z: 0, osmName: '一丁平', expectedElevM: 590 },
    { id: 'SHIROYAMA', name: '城山', type: 'peak', x: 0, z: 0, osmName: '小仏城山', expectedElevM: 670, shelter: { kind: 'staffed', open: true } },
  ],
  edges: [
    { id: 'E1', name: '稲荷山コース（下部）', kind: 'trail', from: 'TH_STATION', to: 'INARI', class: 'T1', markers: 0.9, drift: 0.05, sinuosity: 1.2, courseTimeMin: [40, 30], waypoints: [] },
    { id: 'E2', name: '稲荷山コース（上部）', kind: 'trail', from: 'INARI', to: 'TAKAO', class: 'T1', markers: 0.9, drift: 0.05, sinuosity: 1.2, courseTimeMin: [50, 40], waypoints: [] },
    { id: 'E3', name: '山頂〜もみじ台', kind: 'trail', from: 'TAKAO', to: 'MOMIJI', class: 'T1', markers: 0.9, drift: 0.05, sinuosity: 1.1, courseTimeMin: [10, 10], waypoints: [] },
    { id: 'E4', name: 'もみじ台〜一丁平', kind: 'trail', from: 'MOMIJI', to: 'ICHOUDAIRA', class: 'T1', markers: 0.9, drift: 0.05, sinuosity: 1.1, courseTimeMin: [20, 20], waypoints: [] },
    { id: 'E5', name: '一丁平〜城山', kind: 'trail', from: 'ICHOUDAIRA', to: 'SHIROYAMA', class: 'T1', markers: 0.9, drift: 0.05, sinuosity: 1.1, courseTimeMin: [20, 15], waypoints: [] },
  ],
  hazards: [],
  radio: { stations: [] },
};

/** 例 2 の地点のおおよその緯度経度（バンドルの nodeLatLon。名前で見つからない地点の位置と、名前の候補の絞り込みに使う） */
export const EXAMPLE_NODE_LATLON: Record<string, [number, number]> = {
  TH_STATION: [35.6324, 139.2697],
  INARI: [35.6297, 139.2589],
  TAKAO: [35.6251, 139.2436],
  MOMIJI: [35.6263, 139.2401],
  ICHOUDAIRA: [35.6305, 139.234],
  SHIROYAMA: [35.6373, 139.2286],
};

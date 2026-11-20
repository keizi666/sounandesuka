// =============================================================
// 遭難ですよ — 型定義（仕様の正）
// P0 で src/sim/types.ts にコピーして使う。変更したら docs も直す。
// =============================================================

import type { Tuning } from './tuning';

// ---------- 基本 ----------
export type TimeRef = string; // "D0 05:30"
export type NodeId = string;
export type EdgeId = string;
export type ClimberId = string;

export type RngStreamName =
  | 'weather' | 'nav' | 'hazard' | 'behavior' | 'rescue' | 'thoughts' | 'choice' | 'events';
export type RngState = [number, number, number, number]; // xoshiro128** uint32 x4

// ---------- マップ定義（JSON） ----------
export interface MapDef {
  id: string;
  name: string;
  size: number;        // 一辺の長さ m（箱庭岳は 4096。実在エリアは 2048〜12288）
  resolution: number;  // 頂点数 257 | 385 | 513。cellM = size / (resolution - 1)
  geo?: GeoRef;        // 実在エリアのみ
  terrain: TerrainDef;
  vegetation: VegetationDef;
  nodes: NodeDef[];
  edges: EdgeDef[];
  hazards: HazardDef[];
  radio: { stations: RadioStationDef[]; paint?: GridOverride };
  attribution?: Attribution[];
  skeleton?: boolean;        // 座標なしの骨組みマップ（docs/16 §8）
  areaHint?: { text: string; sizeM: number };
}

export interface GeoRef { centerLat: number; centerLon: number; projection: 'local-tangent' }

export interface VegetationDef {
  forestLine: number;
  forestLineNoise: number;
  broadleafLine: number;
  krummholzBandM?: number;   // ハイマツ帯の幅（既定 200）
  overrides?: GridOverride;  // 0 = 自動、1..7 = VegClass + 1
}

/** resolution×resolution の 8bit グリッドを RLE（[値, 個数(uint16 LE)] の繰り返し）+ base64 で保持 */
export interface GridOverride { encoding: 'rle-u8-base64'; data: string }

export interface Attribution { id: string; text: string; url: string; modified: boolean }

export type TerrainDef = ProceduralTerrainDef | HeightmapTerrainDef;

export interface HeightmapTerrainDef {
  type: 'heightmap';
  encoding: 'u16-base64';    // Uint16 LE。h = minElevM + v / 65535 * (maxElevM - minElevM)
  minElevM: number;
  maxElevM: number;
  baseElevation: number;     // 台座上面の標高
  smoothingPasses?: number;  // 取り込み時に適用済みの平滑化回数（記録用）
  source: { dem: 'DEM10B' | 'DEM5A' | 'mixed'; zoom: number; fetchedAt: string };
  data: string;
}

export interface ProceduralTerrainDef {
  type?: 'procedural';       // 省略時は procedural
  seed: number;
  baseElevation: number;
  baseTilt: { dx: number; dz: number };
  ridges: { id: string; width: number; power: number; points: [number, number, number][] }[];
  valleys: { id: string; width: number; points: [number, number, number][] }[]; // [x,z,depth]
  knickpoints: { id: string; name?: string; x: number; z: number; drop: number; valley: string; radius: number }[];
  noise: { fbmAmp: number; fbmScale: number; octaves: number; ridgedAmp: number; ridgedScale: number; ridgedAbove: number };
  erosion: { thermalIterations: number; talusDeg: number };
}

/** boundary: 境界点（範囲の外へ続く道が、地図の端で切れる所。登山口ではない） */
export type NodeType = 'trailhead' | 'junction' | 'peak' | 'saddle' | 'hut' | 'shelter' | 'landmark' | 'boundary';

export interface NodeDef {
  id: NodeId;
  name: string;
  type: NodeType;
  x: number;
  z: number;
  shelter?: { kind: 'staffed' | 'emergency'; open: boolean };
  confusers?: { edge: EdgeId; whenIntending: EdgeId[]; ambiguity: number }[];
  snap?: boolean;            // peak/saddle の自動スナップ（実在エリアは false）
  osmName?: string;          // スケルトン結合用の名前
  expectedElevM?: number;    // スケルトン結合用の概略標高
  source?: 'manual' | 'osm' | 'gpx';
  osmId?: string;
}

export type TrailClass = 'T1' | 'T2' | 'T3';

export interface EdgeDef {
  id: EdgeId;
  name: string;
  kind: 'trail' | 'false';
  from: NodeId;
  to?: NodeId;                 // false の場合なし
  class: TrailClass;
  markers: number;
  drift: number;
  sinuosity: number;
  courseTimeMin?: [number, number];
  fadeOutM?: number;           // false のみ
  attractiveness?: number;     // false のみ
  smooth?: boolean;            // Catmull-Rom 補間（既定 true。実在データは false）
  via?: string[];              // スケルトン結合で経由する OSM 地点名
  paceAdj?: number;            // コースタイム合わせの速度係数 0.6〜1.4（既定 1）
  streamBedM?: number;         // 沢登りの区間（道が沢床そのもの）の水面の幅（m）。見た目だけ（水として太く描く）
  noRest?: boolean;            // 休むのに向かない区間（ゴルジュ・鎖場など）。抜けるまで決まった休憩・疲れの休憩をしない
  source?: 'manual' | 'osm' | 'gpx';
  osmIds?: string[];
  waypoints: [number, number][];
}

export type HazardDef =
  | { id: string; type: 'chain'; name: string; onEdge: EdgeId; sRange: [number, number] }
  | { id: string; type: 'waterfall'; name: string; x: number; z: number; radius: number }
  | { id: string; type: 'rockfallZone'; name?: string; onEdge: EdgeId; sRange: [number, number] }
  | { id: string; type: 'protectionZone'; name?: string; x: number; z: number; radius: number };

export interface RadioStationDef { id: string; x: number; z: number; elevM: number; antennaM: number; rangeM: number }

// ---------- マップ実行時（World に入れない） ----------
export interface TrailSample { x: number; z: number; elevM: number; sH: number; s: number }
export interface TrailRuntime { def: EdgeDef; samples: TrailSample[]; lengthM: number }

export interface MapRuntime {
  def: MapDef;
  n: number;                 // resolution
  cell: number;              // cellM = size / (n - 1)
  half: number;              // size / 2
  heights: Float32Array;
  slopeDeg: Float32Array;
  aspect: Float32Array;
  tpi: Float32Array;
  exposure: Float32Array;
  flowAcc: Float32Array;
  stream: Uint8Array;
  veg: Uint8Array;           // VegClass
  cliff: Uint8Array;
  skyView: Float32Array;
  radio: Float32Array;
  nodes: Record<NodeId, NodeDef & { elevM: number }>;
  trails: Record<EdgeId, TrailRuntime>;
  adjacency: Record<NodeId, EdgeId[]>;
}

// Vite（esbuild, isolatedModules）では const enum をファイル間で使えないため as const オブジェクトにする
export const VegClass = { BROADLEAF: 0, CONIFER: 1, KRUMMHOLZ: 2, ALPINE: 3, ROCK: 4, STREAM: 5, CLIFF: 6 } as const;
export type VegClass = (typeof VegClass)[keyof typeof VegClass];

// ---------- シナリオ定義（JSON） ----------
export type Theme = 'hypothermia' | 'lost' | 'lightning' | 'fall' | 'heat' | 'mixed';

export interface ScenarioDef {
  id: string;
  version: 1;
  title: string;
  subtitle?: string;
  theme: Theme;
  difficulty: 1 | 2 | 3 | 4 | 5;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  estMinutes: number;
  mapId: string;
  seed: number;
  startDate: string;          // "2026-10-17"
  startAt: TimeRef;
  timeLimit: TimeRef;
  sun: { sunrise: string; sunset: string; maxElevDeg?: number };
  moon?: { illumination: number; rise?: string; set?: string };
  briefing: { text: string; forecast: ForecastEntry[] };
  plan: PlanDef;
  party: ClimberDef[];
  weather: WeatherDef;
  events: ScriptEventDef[];
  choices: ChoicePointDef[];
  genericOverrides?: Partial<Record<GenericChoiceKey, GenericOverride>>;
  thoughts?: ThoughtDef[];
  speech?: SpeechDef[];
  endings: EndingDef[];
  lessons: LessonDef[];
  balanceTargets?: Partial<Record<PolicyName, BalanceTarget>>;
  region?: { name: string; real: boolean };
  groups?: GroupDef[];
  historical?: HistoricalDef;
  nodeOverrides?: Record<NodeId, { open?: boolean }>;   // 小屋の営業状態などをシナリオごとに上書き
  /** 始まりの積雪（雪山・残雪期）。lineM より上に積もり、fullM（省略は lineM+400）で depthCm になる。歩く速さ・道の見つけやすさ・地面の冷たさと、雪の見た目に効く */
  snowpack?: { lineM: number; depthCm: number; fullM?: number; trailCm?: number };   // trailCm: 登山道の上の踏み固められた雪（トレース）。省くと道の上も depthCm
  sources?: string[];                                   // 例: "気象の下書き: Open-Meteo ERA5 2025-10-12 36.40,137.71"
  /** 通りかかる登山者（人の少ない道では少ない）。困っている人に気づけば下山して通報してくれる */
  passersby?: PasserbyDef[];
  /** 音楽（soundCatalog.ts の BGM の ID）。briefing: 出発前、play: ふだん、night: 夜、distress: 道迷い・けが・急病・救助待ちの間、good / bad: 結末。省くと既定の曲、null で無音 */
  music?: { briefing?: string; play?: string | null; night?: string | null; distress?: string | null; good?: string; bad?: string };
}

export interface PasserbyDef {
  /** 通る道 */
  edges: EdgeId[];
  /** 1 時間に通る人（組）の数 */
  perHour: number;
  /** 通る時間帯（毎日。"HH:MM"） */
  from?: string;
  to?: string;
  /** 何日目から（0 = 当日） */
  fromDay?: number;
  /** 気づく距離（m）: 見える・声が届く・笛が届く */
  seeM?: number;
  voiceM?: number;
  whistleM?: number;
}

export interface ForecastEntry { label: string; text: string; icon?: string }

export interface PlanDef {
  route: NodeId[];
  goalNodes: NodeId[];
  plannedFinish: TimeRef;
  submittedPlan: boolean;
  reportIfNotBackBy: TimeRef | null;
  /**
   * 捜索の手がかり。あると、未帰還の通報で始まる捜索は計画ルートではなく、そのとき分かっている手がかりのルートの周りだけを探す
   * （計画を出していない・家族が行き先を知らない場合）。後に並ぶ手がかりほど新しい。分かった時点でログに text を出す。
   */
  searchLeads?: SearchLeadDef[];
}

export interface SearchLeadDef {
  id: string;
  /** 捜索側に分かる時刻 */
  at: TimeRef;
  /** 分かる条件（例: 小屋のノートに書いた）。満たしていなければ使わない */
  when?: Condition;
  /** 探すルート（この道の周りを探す） */
  route: NodeId[];
  /** 道からどこまで広げて探すか（既定は制限なし） */
  maxRadiusM?: number;
  /** 見つけやすさの倍率（範囲が広く人手が分散するほど小さい。既定 1） */
  findF?: number;
  text: string;
}

export type RainwearType = 'none' | 'poncho' | 'basic' | 'goretex';

export interface ClimberDef {
  id: ClimberId;
  name: string;
  age: number;
  sex: 'm' | 'f';
  weightKg: number;
  packKg: number;
  experience: number;     // 0..1
  fitness: number;        // 0.5..1.3
  navSkill: number;       // 0..1
  riskTolerance: number;  // 0..1
  color: string;
  /** 顔アイコン。"区分:番号"（区分は child_m / child_f / young_m / young_f / mid_m / mid_f / senior_m / senior_f、番号は 1 から）。省略時は年齢・性別と ID から自動で選ぶ */
  portrait?: string;
  leader?: boolean;
  habits: { eatEveryMin: number | null; drinkEveryMin: number | null; delaysRainwear: number; gpsCheckEveryMin: number | null };
  gear: GearDef;
  role?: string;                 // 例: "ツアー客", "メインガイド"
  initial?: ClimberInitialDef;   // 前日までの影響
  /** 体調（始まりの条件を変えて試すとき。省くと万全）: sleepy 寝不足・tired 疲れが残る・cold 風邪ぎみ */
  health?: 'good' | 'sleepy' | 'tired' | 'cold';
  estimated?: string[];          // 推定値のフィールド名
  beeSensitized?: boolean;       // 以前ハチに刺されたことがある（アナフィラキシーを起こしやすい）
  notes?: string;
}

export interface ClimberInitialDef {
  wetness?: number; glycogenKcal?: number; fatigue?: number; coreC?: number;
  rainwearOn?: boolean; waterDeficitL?: number; cloWorn?: number;
}

export interface GroupDef {
  id: string;
  members: ClimberId[] | 'all' | 'rest' | 'incapacitated' | 'weak';
  leader: ClimberId;
  cohesion?: 'tight' | 'loose';
}

export interface HistoricalDef {
  event: string;
  sources: { title: string; publisher?: string; year?: number; url?: string }[];
  labelsNote: string;
  disclaimer: string;
  recordedChoices: Record<string, string>;
  /** 記録の死者数。記録どおりに選び続けたら、この人数になるよう乱数の種（seed）を選ぶ（npm run historical） */
  recordedDeaths?: number;
  /** 記録で助かった人。記録どおりに選び続けたら、この人たちも助かるよう種を選ぶ */
  recordedSurvivors?: ClimberId[];
  reference: { at: TimeRef; label: string; who?: ClimberId | null; node?: NodeId | null }[];
}

export interface GearDef {
  rainwear: RainwearType;
  cloWorn: number;
  cloPack: number;
  gloves: 'none' | 'thin' | 'waterproof';
  hat: boolean;
  bivy: 'none' | 'tarp' | 'sack';
  headlamp: { has: boolean; batteryH: number; inPack: boolean; spareBatteryH: number };
  phone: { has: boolean; batteryPct: number; gpsApp: boolean; trackRecording: boolean; satelliteSos: boolean; strap?: boolean };
  map: boolean;
  compass: boolean;
  foodKcal: number;
  waterL: number;
  stove: boolean;
  crampons: boolean;
  helmet: boolean;
  trekkingPoles: boolean;
  whistle: boolean;
  tent?: boolean;              // テント（ツェルトより風雨に強い）
  meds?: boolean;              // 持病の薬（ニトログリセリンなど）
  epipen?: boolean;            // アドレナリン自己注射薬（エピペン。処方された人だけ）
  rescueSheet?: boolean;       // エマージェンシーシート
  cocoheli?: boolean;          // ココヘリ（会員制の捜索用の発信機）。ヘリの受信機が電波をとらえ、短い時間で見つかる
}

export interface WeatherKeyframe {
  at: TimeRef;
  tempC: number;
  windMs: number;
  windDirDeg: number;
  precipMmH: number;
  cloudCover: number;
  cloudBaseM: number;
  visibilityM: number;
  inCloudVisibilityM?: number;
  thunder?: number;
  pressureHpa?: number;
  gustiness?: number;
}

export interface ThunderCellDef {
  id: string;
  from: TimeRef;
  peakAt: TimeRef;
  to: TimeRef;
  path: [number, number][];
  radiusM: number;
  peak: number;
  heavyRainMmH: number;
  hail?: boolean;
}

export interface WeatherDef {
  refElevM: number;
  lapseRateCPer100m: number;
  cloudThicknessM?: number;
  keyframes: WeatherKeyframe[];
  thunderCells?: ThunderCellDef[];
  presetLog?: { preset: WeatherPresetId; at: TimeRef; intensity: number; params?: Record<string, string | number> }[];
}

export type WeatherPresetId =
  | 'coldFront' | 'warmFront' | 'southCoastLow' | 'winterMonsoon' | 'summerThunderstorm'
  | 'fog' | 'baiuRain' | 'typhoon' | 'highPressure';

// ---------- 条件 DSL ----------
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { var: string; op: CmpOp; value: number | string | boolean }
  | { after: TimeRef }
  | { before: TimeRef }
  | { atNode: NodeId }
  | { beenAt: NodeId }
  | { onEdge: EdgeId }
  | { near: { x: number; z: number; r: number } }
  | { state: BehaviorState }
  | { flag: string }
  | { chose: { cp: string; option: string } }
  | { event: SimEventType }
  | { chance: number }
  | { elapsedSince: { flag: string; min: number } };

// ---------- アクション ----------
export type Who = 'leader' | 'all' | ClimberId;
export type UntilRef = TimeRef | 'dawn' | 'rescue' | 'weatherClears';

export type Action = { who?: Who } & (
  | { type: 'continueRoute' }
  | { type: 'setRoute'; route: NodeId[]; goalNodes?: NodeId[] }
  | { type: 'turnBack' }
  | { type: 'goToNode'; node: NodeId; then: 'stay' | 'continue' | 'call' }   // call: 着いたら通報する（電波の入る地点まで道を歩いて行く）
  | { type: 'stayInShelter'; until: UntilRef }
  | { type: 'rest'; minutes: number }
  | { type: 'eat'; kcal: number }
  | { type: 'drink'; liters: number }
  | { type: 'reportMissing'; by?: string }        // 家族・仲間が「帰らない」と警察に届け出る（未帰還の通報を今する）。by は届け出た人（「小屋番さん」など。省くと家族）
  | { type: 'sound'; id: string; volume?: number } // 効果音を鳴らす（src/sim/scenario/soundCatalog.ts の ID）。記録には残らない
  | { type: 'music'; id: string | null; volume?: number } // 音楽を切り替える（null で自動の曲に戻す）
  | { type: 'focus'; group: string }               // 見守る（注視する）パーティを変える。画面はそのリーダーを追い、プレイヤーの主体がそのパーティに移る
  | { type: 'leaveMap'; place: string }            // 下山した人が地図の外（バス停・駅・交番など）へ移る。3D から消え、居場所の名前を出す（下山・救助の後だけ）
  | { type: 'setPhone'; has: boolean }             // スマホをなくす（false）・見つける（true）
  | { type: 'addAnxiety'; amount: number }         // 動揺する（+）・落ち着く（−）。不安 0〜100
  | { type: 'illness'; kind: IllnessKind | 'random'; weights?: Partial<Record<IllnessKind, number>> }  // 急病の発症（原因は本人には分からない）
  | { type: 'medicate' }                            // 持病の薬を飲む（gear.meds があるとき）
  | { type: 'sting'; p?: number }                  // ハチに襲われる（一人ずつ確率 p で刺される。既定 1）
  | { type: 'epipen' }                             // エピペンを打つ（gear.epipen があり、アナフィラキシーが出ているとき）
  | { type: 'drinkAlcohol'; grams: number; liters?: number }   // 酒（純アルコールのグラム。缶ビール 350 mL で約 14 g）。liters は飲み物の量（水分になる）
  | { type: 'wearRainwear' }
  | { type: 'addLayer'; clo?: number }
  | { type: 'changeDry' }
  | { type: 'stopAndCheck' }
  | { type: 'missJunction' }                      // いまの（次の）分岐で、紛らわしい道（偽の道など）へそのまま入る
  | { type: 'checkPosition' }
  | { type: 'bivouac'; until: UntilRef; findLee: boolean }
  | { type: 'stayPut' }
  | { type: 'backtrack' }
  | { type: 'navigateToTrail' }
  | { type: 'descendDrainage' }
  | { type: 'seekSignal'; returnAfter?: boolean }   // returnAfter: 通報後に元のグループへ戻る
  | { type: 'callRescue'; via: 'auto' | 'phone' | 'satellite' }
  | { type: 'waitRescue' }
  | { type: 'setPace'; factor: number }
  | { type: 'lightningPosture'; minutes: number }
  | { type: 'moveOffRidge'; minDropM: number }
  | { type: 'removeMetal' }
  | { type: 'setFlag'; flag: string }
  | { type: 'clearFlag'; flag: string }
  | { type: 'narrate'; text: string }
  | { type: 'abortTrip' }
  | { type: 'splitParty'; groups: (GroupDef & { actions: Action[] })[] }
  | { type: 'setCohesion'; cohesion: 'tight' | 'loose' }
  | { type: 'soak'; level: SoakLevel; snowmelt?: boolean }
  | { type: 'detach'; then: Action[]; returnAfter?: boolean }   // returnAfter: 用事（then）が済んで止まったら元のグループへ戻る
  | { type: 'goToMember'; member: ClimberId }
  | { type: 'say'; text: string; to?: SpeakerRef; tone?: SpeechTone; documented?: boolean; source?: string }
);

export type SoakLevel = 'feet' | 'knees' | 'waist' | 'full';

// ---------- 分岐点 ----------
export interface ChoiceOptionDef {
  id: string;
  label: string;
  detail?: string;
  available?: Condition;
  unavailableText?: string;
  hideIfUnavailable?: boolean;
  actions: Action[];
  flags?: string[];
  tags?: ('recommended' | 'risky')[];
  bias: { base: number; mods?: { when: Condition; add: number }[] };
}

export interface ChoicePointDef {
  id: string;
  title: string;
  trigger: Condition;
  once?: boolean;        // 既定 true
  priority?: number;     // 既定 10
  situation: string;
  knowledge?: string[];
  timeoutSec?: number;   // 既定 30
  group?: string;        // グループ単位の分岐点（leader はそのグループのリーダー）
  options: ChoiceOptionDef[];
}

export type GenericChoiceKey = 'lostAware' | 'darkness' | 'hypothermia' | 'injured' | 'lightning' | 'waterfall' | 'straggler' | 'rescueFailed';
export interface GenericOverride { enabled?: boolean; situation?: string; knowledge?: string[]; options?: ChoiceOptionDef[] }

// ---------- イベント ----------
export type ScriptEffect =
  | { type: 'log'; text: string; important?: boolean }
  | { type: 'forecastUpdate'; entries: ForecastEntry[]; requiresSignal?: boolean }
  | { type: 'setFlag'; flag: string }
  | { type: 'clearFlag'; flag: string }
  | { type: 'injure'; who: Who; injury: InjuryKind }
  | { type: 'rockfall'; who: Who; p: number; injuryTable: 'T2' | 'EXPOSED' }
  | { type: 'actions'; actions: Action[] }
  | { type: 'weatherOverride'; keyframe: WeatherKeyframe }
  | { type: 'pin'; x: number; z: number; label: string }
  | { type: 'triggerChoice'; cp: string }
  | { type: 'soak'; who: Who; level: SoakLevel; snowmelt?: boolean }
  | { type: 'say'; who: SpeakerRef; text: string; to?: SpeakerRef; tone?: SpeechTone; documented?: boolean; source?: string };

export interface ScriptEventDef { id: string; trigger: Condition; once?: boolean; effects: ScriptEffect[] }

/** 一人言・考え。who を書けばその人だけが考える（登山者 ID、'leader' はグループのリーダー、'role:…' は役割）。省略すると誰でも */
export interface ThoughtDef { key: string; who?: SpeakerRef; when: Condition; lines: string[]; priority?: number }

export type SpeechTone = 'normal' | 'shout' | 'whisper' | 'sound';
export type SpeakerRef = ClimberId | 'leader' | 'any' | `role:${string}`;

export interface SpeechDef {
  key: string;
  who: SpeakerRef;
  to?: SpeakerRef;
  when: Condition;
  lines: string[];
  replies?: { who: SpeakerRef; lines: string[] };
  tone?: SpeechTone;
  priority?: number;
  cooldownMin?: number;
  once?: boolean;
  documented?: boolean;
  source?: string;
}

export type EndingKind = 'SAFE_RETURN' | 'SAFE_SHELTER' | 'ABORTED' | 'SELF_RESCUE' | 'RESCUED' | 'RESCUED_CRITICAL' | 'MISSING' | 'FATAL';
export interface EndingDef { kind: EndingKind; when?: Condition; title: string; text: string }
/** when を省くと、いつも出す */
export interface LessonDef { id: string; when?: Condition; title: string; text: string }

export type PolicyName = 'recommended' | 'bias' | 'random' | 'risky' | 'historical';
export interface BalanceTarget {
  goodMin?: number; goodMax?: number; badMin?: number; badMax?: number;
  fatalMin?: number; fatalMax?: number; rescuedMin?: number; rescuedMax?: number;
  lostMin?: number; lostMax?: number;
  deathCountMedian?: [number, number];
}

// ---------- World（シミュレーション状態：プレーン JSON のみ） ----------
export type BehaviorState =
  | 'WALKING' | 'RESTING' | 'SHELTERED' | 'BIVOUAC'
  | 'OFFROUTE_UNAWARE' | 'LOST_AWARE' | 'BACKTRACKING' | 'NAVIGATING_TO_TRAIL'
  | 'DESCENDING_DRAINAGE' | 'SEEKING_SIGNAL' | 'STAYING' | 'WAITING_RESCUE'
  | 'INCAPACITATED' | 'UNCONSCIOUS'
  | 'FINISHED' | 'RESCUED' | 'DEAD';

export type InjuryKind = 'none' | 'bruise' | 'sprain' | 'legFracture' | 'headInjury' | 'severeTrauma';
export type PrecipType = 'none' | 'rain' | 'sleet' | 'snow' | 'hail';
export type DeathCause = 'hypothermia' | 'fall' | 'lightning' | 'trauma' | 'heat' | 'illness' | 'anaphylaxis';

/** 急病の原因（本人には分からない。src/sim/climber/illness.ts） */
export type IllnessKind = 'angina' | 'mi' | 'dissection' | 'arrhythmia' | 'benign' | 'anaphylaxis';

export type ClimberPos =
  | { mode: 'edge'; edgeId: EdgeId; s: number; dir: 1 | -1 }
  | { mode: 'node'; nodeId: NodeId }
  | { mode: 'free'; x: number; z: number };

export interface LocalWeather {
  tempC: number;
  windMs: number;
  windDirDeg: number;
  precipMmH: number;
  precipType: PrecipType;
  visibilityM: number;
  windChillC: number;
  thunder: number;
  solarW: number;
  inCloud: boolean;
}

export interface ClimberBody {
  coreC: number;
  wetness: number;
  glycogenKcal: number;
  gutKcal: number;
  /** 体内のアルコール（g）。判断力と足元に響き、時間とともに抜ける。古い保存データにはない */
  alcoholG?: number;
  /** 急病（胸の痛みなど）。active は症状が出ているか。restSinceMin は休み始めた時刻 */
  illness?: { kind: IllnessKind; atMin: number; active: boolean; restSinceMin: number | null; meds: boolean; onsetAtMin?: number; epiUntilMin?: number | null };
  /** ハチに刺された回数 */
  stings?: number;
  waterDeficitL: number;
  fatigue: number;
  anxiety: number;
  injury: InjuryKind;
  injuryAtMin: number | null;
  conscious: boolean;
  alive: boolean;
  deathCause: DeathCause | null;
  cloWorn: number;
  cloPack: number;
  rainwearOn: boolean;
  rainExposureMin: number;
  groundInsulation: boolean;        // 地面との間にマット・ザックを敷いているか
  coldExtremitiesUntilMin: number | null;
  inBivy: boolean;
  shelterNodeId: NodeId | null;
  leeShelter: number;        // 0..1 現在地の風下効果
  stage: 'normal' | 'cold' | 'mild' | 'moderate' | 'severe' | 'heatExhaustion' | 'heatStroke';
}

export interface ClimberInventory {
  foodKcal: number;
  waterL: number;
  phone: { has: boolean; batteryPct: number; gpsApp: boolean; trackRecording: boolean; satelliteSos: boolean; dead: boolean; lastCheckMin: number | null };
  headlamp: { has: boolean; batteryH: number; inPack: boolean; spareBatteryH: number; on: boolean };
}

export interface ClimberPlanState {
  route: NodeId[];
  routeIndex: number;          // 次に向かう route 上のインデックス
  goalNodes: NodeId[];
  restUntilMin: number | null;
  bivouacUntil: UntilRef | null;
  paceFactor: number;
  hurry: boolean;
  stopCheckedNode: NodeId | null;
  /** この分岐では紛らわしい道へ入る（選択肢「そのまま進む」など。missJunction）。古い保存にはない */
  missJunctionNode?: NodeId | null;
  postureUntilMin: number | null;
  busyUntilMin: number | null; // 雨具着用など所要時間中
  busyWith: string | null;
  /** goToNode の行き先と到着後の行動 */
  goTo: { node: NodeId; then: 'stay' | 'continue' | 'call' } | null;
  /** 道の外で goToNode したとき、道に戻ってから向かう行き先 */
  pendingGoTo?: { node: NodeId; then: 'stay' | 'continue' | 'call' } | null;
}

export interface ClimberPerception {
  routeBelief: { edgeId: EdgeId; s: number } | null;
  awareLost: boolean;
  knowsPosition: boolean;
  knowsPositionAt: { x: number; z: number } | null;
  weatherImpression: 'fine' | 'worsening' | 'bad' | 'severe';
  timeBehindMin: number;
  forecast: ForecastEntry[];
}

export interface ClimberNavState {
  lastKnownOnRoute: { edgeId: EdgeId; s: number; x: number; z: number } | null;
  offrouteSinceMin: number | null;
  beliefDirRad: number | null;
  track: [number, number][];     // 逸脱以降の 10m ごとの点（BACKTRACKING 用）
  falseEdgeId: EdgeId | null;
  distAccumM: number;            // 10m 判定用の端数
  /** 道外で次に向かう点の列（先頭が今の目標）。経路探索・風下探索・効用による 1 歩 */
  path: [number, number][];
  /** 軌跡を見失う判定（100 m ごと）用の距離の端数 */
  trackCheckM: number;
}

export interface ClimberState {
  id: ClimberId;
  def: ClimberDef;               // 初期定義（参照用。変更しない）
  groupId: string | null;        // null = detach 済み（単独行動）
  /** 地図の外にいる（下山して駅へ向かったなど）。居場所の名前。3D には描かない */
  offMap?: string;
  state: BehaviorState;
  stateSinceMin: number;
  pos: ClimberPos;
  x: number; z: number; elevM: number; headingRad: number; speedMs: number;
  /** 歩いた記録: 行動時間（出発からの経過。待つ・ビバークの間も進む）、歩いた距離、累計の登り・下り（m）。ログの下の帯に出す */
  trip?: { activeMin: number; distM: number; upM: number; downM: number };
  metAct: number;
  body: ClimberBody;
  J: number;
  M: number;
  inv: ClimberInventory;
  plan: ClimberPlanState;
  perception: ClimberPerception;
  nav: ClimberNavState;
  local: LocalWeather;
  lastThoughtMin: number | null;
  thoughtHistory: Record<string, number>;
  memo: ClimberMemo;
}

/** 自律行動・結末判定のための覚え書き */
export interface ClimberMemo {
  lastEatMin: number | null;
  lastDrinkMin: number | null;
  /** 最後に降水（≥ 0.5 mm/h）を受けた時刻 */
  lastPrecipMin: number | null;
  /** until: "weatherClears" の判定用。条件を満たし始めた時刻 */
  clearSinceMin: number | null;
  bivouacked: boolean;
  sheltered: boolean;
  /** 重度外傷で死亡する時刻（負傷時に抽選。生き延びるなら null） */
  traumaDeathAtMin: number | null;
  /** 頭部外傷による意識喪失が戻る時刻 */
  unconsciousUntilMin: number | null;
  /** 滝の手前で止まった（汎用分岐点 waterfall） */
  atWaterfall: boolean;
  /** 偽の道が消えた直後（気づき +0.15 の判定用） */
  trailVanishedAtMin: number | null;
  /** 次の思考の吹き出しを出す時刻 */
  nextThoughtMin: number | null;
  /** 前の休憩から歩いた時間（分）。決まった間隔で休む習慣に使う */
  walkSinceRestMin: number;
}

export interface GlobalWeather {
  tempC: number; windMs: number; windDirDeg: number; precipMmH: number;
  cloudCover: number; cloudBaseM: number; visibilityM: number; inCloudVisibilityM: number;
  thunder: number; pressureHpa: number; gust: number;
  /** 時間ノイズのシード（生成時に weather ストリームから 1 回引く。What-if の再シードで引き直す） */
  noiseSeed: number;
  cells: { id: string; x: number; z: number; strength: number; radiusM: number }[];
  overrides: WeatherKeyframe[];
}

export interface GroundState { snowCm: number[]; wet: number[]; icy: number[] } // 50m ビン

export interface SunState { elevDeg: number; isDark: boolean; twilight: boolean; moonIllum: number }

export interface RescueState {
  status: 'none' | 'dispatched' | 'searching' | 'contacted';
  calledAtMin: number | null;
  via: 'phone' | 'satellite' | 'overdue' | 'script' | 'passerby' | null;
  locationEstimate: { x: number; z: number; radiusM: number } | null;
  heli: { readyAtMin: number | null; nextCheckMin: number | null; state: 'idle' | 'preparing' | 'waiting' | 'flying' | 'searching' | 'done' };
  ground: { readyAtMin: number | null; x: number; z: number; state: 'idle' | 'mobilizing' | 'moving' | 'searching' | 'standby' | 'done' };   // standby: 夜・悪天候で山に入らずに待つ
  searchRadiusM: number;
  /** 届け出た人（reportMissing の by） */
  reportedBy?: string;
  /** 居場所の分からない人を、ヘリが実際に探した時間（分）。見つかる率はこれで決まる（古い保存にはない） */
  heliBlindMin?: number;
}

export interface PendingChoice {
  cpId: string;                  // シナリオ ID または "generic:<key>"
  firedAtMin: number;
  realDeadlineMs: number | null; // 判断時間制限モード用（UI 側で管理してもよい）
  groupId?: string | null;       // どのグループの分岐点か（汎用分岐点をグループごとに出すため）
}

export interface World {
  version: 1;
  scenarioId: string;
  mapId: string;
  seed: number;
  tick: number;
  tMin: number;
  rng: Record<RngStreamName, RngState>;
  sun: SunState;
  weather: GlobalWeather;
  ground: GroundState;
  climbers: ClimberState[];
  flags: Record<string, number>;          // フラグ名 → 立った時刻 tMin
  firedChoices: string[];
  firedEvents: string[];
  chanceResults: Record<string, boolean>; // 条件 chance の固定結果（キー: 定義パス）
  decisions: { cpId: string; optionId: string; tMin: number; by: 'user' | 'bias' | 'policy' }[];
  pendingChoice: PendingChoice | null;
  rescue: RescueState;
  visitedNodes: Record<NodeId, number>;
  groups: { id: string; leader: ClimberId; cohesion: 'tight' | 'loose'; lastHeadcountMin: number | null }[];
  ended: { kind: EndingKind; atMin: number } | null;
  /** 直前のティックに出たイベント（条件 event / atNode の判定用） */
  recentEvents: { type: SimEventType; climberId: string | null; node: string | null }[];
  /** リーダーの局地気象・暗さの変化を検出するための前回値 */
  weatherMemo: { raining: boolean; rainStoppedAtMin: number | null; precipType: PrecipType; sunUp: boolean; dark: boolean };
  /** once: false の分岐点・イベントの立ち上がり検出（前回の真偽） */
  latches: Record<string, boolean>;
  /** いま見守っているパーティ（focus アクションで変わる。なければ最初のパーティ） */
  focusGroup?: string;
  /** 見守りを切り替えた時点の、そのパーティの人（あとで分かれた組もこの人たちなら見守る側） */
  focusMembers?: ClimberId[];
}

// ---------- イベント（ループで回収。World に残さない） ----------
export type SimEventType =
  | 'STATE' | 'NODE_ARRIVE' | 'RAIN_START' | 'RAIN_STOP' | 'PRECIP_TYPE' | 'SUNSET' | 'SUNRISE' | 'DARK'
  | 'OFFROUTE' | 'LOST_AWARE' | 'BACK_ON_ROUTE' | 'FALL' | 'INJURY' | 'STAGE_CHANGE'
  | 'GEAR' | 'EAT' | 'DRINK' | 'LAMP' | 'PHONE_DEAD' | 'LAMP_DEAD'
  | 'LIGHTNING_STRIKE' | 'LIGHTNING_NEAR'
  | 'RESCUE_CALLED' | 'RESCUE_CALL_FAILED' | 'HELI_DISPATCH' | 'GROUND_DISPATCH' | 'RESCUED'
  | 'SHELTER_ENTER' | 'SHELTER_LEAVE' | 'BIVOUAC_START' | 'DEATH' | 'FINISHED'
  | 'CHOICE_FIRED' | 'CHOICE_RESOLVED' | 'SCRIPT_LOG' | 'FORECAST_UPDATE' | 'PIN' | 'THOUGHT' | 'ENDED' | 'FOCUS'
  | 'SOAK' | 'CARDIAC_ARREST' | 'LEADER_CHANGED' | 'PARTY_SPLIT' | 'STRAGGLER' | 'GUST_FALL'
  | 'SPEECH'
  | 'SOUND' | 'MUSIC';   // 効果音・音楽（data: { id, volume }）。画面だけが使う   // data: { to, tone, distortLevel(0-3), documented }。text は変形前の原文

export interface SimEvent {
  tMin: number;
  type: SimEventType;
  climberId?: ClimberId;
  text?: string;              // ログ表示文（日本語）
  important?: boolean;
  data?: Record<string, number | string | boolean | null>;
}

// ---------- 実行コンテキスト ----------
export type RunMode = 'interactive' | 'timed' | 'observe' | 'headless';

export interface StaticContext {
  map: MapRuntime;
  scenario: ScenarioDef;
  tuning: Tuning;
  mode: RunMode;
  policy: PolicyName;              // headless / observe で使用
  events: SimEvent[];              // stepWorld が push、ループが回収
}

// ---------- 記録 ----------
export interface RecordSample {
  t: number;
  climbers: { id: ClimberId; x: number; z: number; elevM: number; coreC: number; glycogenKcal: number; waterDeficitL: number; fatigue: number; wetness: number; anxiety: number; J: number; M: number; state: BehaviorState; bac?: number }[];
  local: Pick<LocalWeather, 'tempC' | 'windMs' | 'precipMmH' | 'precipType' | 'visibilityM' | 'thunder' | 'windChillC'>;
}

export interface RunRecord {
  scenarioId: string;
  seed: number;
  samples: RecordSample[];
  decisions: { cpId: string; title: string; tMin: number; optionId: string; label: string; by: 'user' | 'bias' | 'policy'; tags: string[] }[];
  events: SimEvent[];
  track: [number, number][];
  stats: {
    minCoreC: number; maxAnxiety: number; fallCount: number; rainwearDelayMin: number;
    wasLost: boolean; lostMinutes: number; darkMinutesMoving: number; rescueCalledAt: number | null; distanceM: number;
  };
  ending: { kind: EndingKind; title: string; text: string; perClimber: { id: ClimberId; state: BehaviorState; cause: DeathCause | null }[] } | null;
}

// ---------- バンドル・エディター ----------
export interface SounanBundle {
  format: 'sounan-bundle' | 'hakoniwa-bundle';   // hakoniwa-bundle は旧名（読み込みだけ）
  version: 1;
  createdAt: string;
  generator: string;
  map: MapDef;
  scenario: ScenarioDef;
  attribution: Attribution[];
}

/** public/scenarios/index.json の 1 エントリ */
export interface ScenarioIndexEntry {
  id: string;
  file?: string;     // シナリオ JSON（mapId で既存マップを参照）
  bundle?: string;   // または バンドル
  title: string;
  subtitle?: string;
  theme: Theme;
  difficulty: 1 | 2 | 3 | 4 | 5;
  season: ScenarioDef['season'];
  estMinutes: number;
  region?: { name: string; real: boolean };
}

export interface EditorProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  map: MapDef;                       // heightmap の data は空文字で保存し heightsBuffer に分離
  heightsBuffer: ArrayBuffer | null; // Float32 (resolution²)
  scenario: ScenarioDef;
  raw: { osm?: unknown; gpx?: string[]; weather?: unknown };
  editorState: {
    mapView: { lat: number; lon: number; zoom: number };
    tab: 'area' | 'trails' | 'points' | 'environment' | 'weather' | 'party' | 'choices' | 'endings' | 'test' | 'json' | 'ai';
    selection: { kind: 'node' | 'edge' | 'hazard' | 'choice' | 'event' | 'keyframe' | 'cell' | null; id: string | null };
    draftEdgeIds: EdgeId[];          // 取り込み後、未確定の道
    probePoints: { label: string; x: number; z: number }[];
    rightsConfirmed: boolean;        // 書き出し時の権利確認
  };
}

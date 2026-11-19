/**
 * 生理（docs/06 §1〜§5）: 熱収支・震え・発汗・濡れ・エネルギー・水分・疲労。
 * 医学モデルではなくゲームモデル。定数は較正目標（§9）に合わせて tuning.ts で調整する。
 */
import { dexp, dpow } from '../core/dmath';
import { TUNING, type Tuning } from '../tuning';
import type { ClimberState, PrecipType, StaticContext, World, SoakLevel } from '../types';
import { groundAt } from '../weather/ground';

/** 体が置かれた熱環境（docs/06 §3.1 の表を適用した後の値） */
export interface ThermalEnv {
  tairC: number;
  /** 体に当たる風（歩く速さは含めない） */
  windMs: number;
  walkSpeedMs: number;
  /** 体に当たる降水 */
  precipMmH: number;
  precipType: PrecipType;
  solarW: number;
  /** ツェルト・シュラフカバーなどで足す断熱（clo） */
  extraClo: number;
  /** 降水による濡れの入力の倍率（風下 0.8、屋内 0） */
  wetInputF: number;
  /** 結露で濡れる量（/h） */
  condensePerH: number;
  /** 屋内で乾く量（/h）。0 なら屋外の乾き方の式を使う */
  forcedDryPerH: number;
  /** 地面に座る・倒れている */
  groundContact: boolean;
  groundTempC: number;
  /** 乾きやすさ（既定 1）。雲・霧の中は湿度が高く、ほとんど乾かない */
  dryF?: number;
  /** 営業小屋（食事と体温回復の上限） */
  staffed: boolean;
}

export interface Activity {
  metAct: number;
  /** 歩行中の平均勾配（上りが正） */
  grade: number;
  walking: boolean;
}

export interface BodyStepResult {
  netW: number;
  shiverMet: number;
}

/** 体表面積 m² */
/** 止まっている状態（雨水をためられる） */
const STILL = new Set(['BIVOUAC', 'WAITING_RESCUE', 'STAYING', 'INCAPACITATED']);

/** 血中アルコール濃度（%）。Widmark の式: g ÷ (体重 kg × r) ÷ 10 */
export function bacPct(c: ClimberState, tuning: Tuning = TUNING): number {
  const g = c.body.alcoholG ?? 0;
  if (g <= 0) return 0;
  const r = tuning.physiology.alcoholWidmarkR[c.def.sex] ?? 0.6;
  return g / (c.def.weightKg * r) / 10;
}

const areaCache = new Map<number, number>();
export function bodyArea(weightKg: number, tuning: Tuning = TUNING): number {
  const p = tuning.physiology;
  if (tuning !== TUNING) return p.areaBase * dpow(weightKg / p.areaRefKg, p.areaExp);
  let a = areaCache.get(weightKg);
  if (a === undefined) {
    a = p.areaBase * dpow(weightKg / p.areaRefKg, p.areaExp);
    areaCache.set(weightKg, a);
  }
  return a;
}

/** 震えの MET（docs/06 §2.3） */
export function shiverMet(c: ClimberState, metAct: number, tuning: Tuning = TUNING): number {
  const p = tuning.physiology;
  const b = c.body;
  if (b.coreC >= p.shiverStartC || !b.conscious || !b.alive) return 0;
  const ageS = Math.max(p.ageSMin, 1 - p.ageSPerYear * Math.max(0, c.def.age - p.ageRefYears));
  const low = tuning.movement.lowGlycogenKcal;
  const fuel = b.glycogenKcal > low ? 1 : p.shiverLowFuelBase + ((1 - p.shiverLowFuelBase) * Math.max(0, b.glycogenKcal)) / low;
  let s = Math.min(p.shiverMaxMet, (p.shiverStartC - b.coreC) * p.shiverPerC) * ageS * fuel;
  if (b.coreC < p.shiverFadeFromC) s *= Math.max(0, (b.coreC - (p.shiverFadeFromC - p.shiverFadeSpanC)) / p.shiverFadeSpanC);
  if (metAct > p.shiverWalkingMet) s *= p.shiverWalkingF;
  // 酒を飲むと震えが弱まる
  s *= 1 - Math.min(p.alcoholShiverMax, p.alcoholShiverK * bacPct(c, tuning));
  return s;
}

/** 雨具の防水率（docs/06 §4） */
export function rainProtection(c: ClimberState, windMs: number, tuning: Tuning = TUNING): number {
  const p = tuning.physiology;
  if (!c.body.rainwearOn) return 0;
  switch (c.def.gear.rainwear) {
    case 'poncho':
      return p.protectPoncho * (1 - Math.min(1, windMs / p.ponchoWindMs));
    case 'basic': {
      const h = c.body.rainExposureMin / 60;
      const degrade = h > p.basicDegradeAfterH ? Math.max(p.basicDegradeMin, 1 - p.basicDegradePerH * (h - p.basicDegradeAfterH)) : 1;
      return p.protectBasic * degrade;
    }
    case 'goretex':
      return p.protectGoretex;
    default:
      return 0;
  }
}

/** 1 ステップ（dtMin 分）の体の更新。深部体温・濡れ・エネルギー・水分・疲労を書き換える */
export function integrateBody(c: ClimberState, env: ThermalEnv, act: Activity, dtMin: number, tuning: Tuning = TUNING): BodyStepResult {
  const p = tuning.physiology;
  const b = c.body;
  const d = c.def;
  if (!b.alive) return { netW: 0, shiverMet: 0 };

  // ---- 代謝 ----
  const shiver = shiverMet(c, act.metAct, tuning);
  const hProd = (act.metAct + shiver) * p.wPerMetPerKg * d.weightKg * p.mechEfficiencyKeep;

  // ---- 熱損失 ----
  const A = bodyArea(d.weightKg, tuning);
  const tsk = b.coreC - p.skinCoreDiffC;
  const vEff = Math.max(0, env.windMs) + Math.max(0, env.walkSpeedMs);
  const windPen = b.rainwearOn ? p.windPenRainwear : p.windPenNone;
  const clo = (b.cloWorn + (b.rainwearOn ? p.rainwearClo : 0) + env.extraClo) * (1 - p.wetCloLoss * b.wetness);
  const cloEff = clo / (1 + windPen * vEff);
  const hc = p.hcBase + p.hcPerSqrtV * Math.sqrt(vEff);
  const R = p.cloToR * cloEff + 1 / (hc + p.radiativeH);
  const ageV = Math.max(p.ageVMin, 1 - p.ageVPerYear * Math.max(0, d.age - p.ageRefYears));
  // 酒を飲むと、寒くても皮膚の血管が縮みにくく、皮膚の血流が増えて熱が逃げる
  const bac = bacPct(c, tuning);
  const vaso = (1 - p.vasoK * ageV * Math.min(1, Math.max(0, (37 - b.coreC) / p.vasoSpanC)) * (1 - Math.min(p.alcoholVasoMax, p.alcoholVasoK * bac))) * (1 + p.alcoholHeatLossK * bac);
  const airArea = env.groundContact ? A * p.groundAirFrac : A;
  let qDry = (airArea * (tsk - env.tairC) * vaso) / R;
  if (!d.gear.hat) qDry *= p.noHatLossF;
  const eWet = Math.min(p.evapMaxW, b.wetness * (p.evapBase + p.evapPerV * vEff)) * (b.rainwearOn ? p.evapUnderRainwearF : 1);
  const eResp = p.respFrac * hProd;
  let qGround = 0;
  if (env.groundContact) {
    const rGround =
      p.cloToR * b.cloWorn * p.groundCloF * (1 - p.wetCloLoss * b.wetness) +
      p.groundContactR +
      (b.groundInsulation ? p.groundInsulationR : 0);
    qGround = (A * p.groundContactFrac * (tsk - env.groundTempC) * vaso) / rGround;
  }
  let net = hProd + env.solarW - qDry - eWet - eResp - qGround;

  // ---- 発汗（内側から濡れる） ----
  // 体温調節の発汗（余った熱を捨てる）に、激しい運動そのものによる発汗を足す。
  // 上限は暑さと脱水で下がる（汗をかいても乾かず冷えない＝熱がこもる）
  const hotF = Math.min(1, Math.max(p.sweatHotMinF, (p.sweatHotRefC - env.tairC) / p.sweatHotSpanC));
  const dehydF = Math.max(p.sweatDehydMinF, 1 - p.sweatDehydPerL * b.waterDeficitL);
  const sweatCap = p.sweatMaxW * hotF * dehydF;
  let sweatW = 0;
  if (b.coreC > p.sweatStartC && net > 0) sweatW = Math.min(net, sweatCap);
  sweatW = Math.min(p.sweatMaxW, sweatW + p.sweatExertWPerMet * Math.max(0, act.metAct - p.sweatExertFromMet));
  // 汗の多くは服を通して蒸発する。蒸発しきれない分だけ服が濡れ、汗だけでは sweatWetMax までしか濡れない
  const coldEvapF = Math.min(1, Math.max(p.sweatEvapColdMinF, (env.tairC + p.sweatEvapColdOffC) / p.sweatEvapColdSpanC));
  const evapThroughW = p.sweatEvapW * (1 + p.sweatEvapWindK * vEff) * coldEvapF * (b.rainwearOn ? p.evapUnderRainwearF : 1) * Math.min(1, env.dryF ?? 1) * (env.precipMmH > 0 ? 0.5 : 1);
  if (sweatW > 0) {
    net -= sweatW;
    const trap = b.rainwearOn ? (p.trapF[d.gear.rainwear] ?? p.trapF['none']!) : p.trapF['none']!;
    const soakW = Math.max(0, sweatW - evapThroughW);
    if (b.wetness < p.sweatWetMax) b.wetness = Math.min(p.sweatWetMax, b.wetness + soakW * p.sweatWetPerW * trap * dtMin);
  }

  // ---- 深部体温 ----
  let dCore = (net * 60) / (d.weightKg * p.specificHeatJ * p.kMass); // ℃/min
  if (dCore > 0 && b.coreC < p.poorRecoveryBelowC) dCore *= p.poorRecoveryF;
  if (b.coreC > 37 && net <= 0) dCore -= p.hotRelax * (b.coreC - 37);
  if (env.staffed && dCore > 0) dCore = Math.min(dCore, p.staffedRecoveryCPerH / 60);
  b.coreC = Math.min(p.coreMax, Math.max(p.coreMin, b.coreC + dCore * dtMin));

  // ---- 濡れ（外から） ----
  const protect = rainProtection(c, env.windMs, tuning);
  let typeF = p.precipTypeF[env.precipType] ?? 0;
  if (env.precipType === 'snow' && env.tairC > p.wetSnowAboveC) typeF = p.wetSnowF;
  const input = env.precipMmH * (1 - protect) * p.kRainPerMm * typeF * env.wetInputF; // /h
  b.wetness += (input / 60) * dtMin + (env.condensePerH / 60) * dtMin;
  if (env.forcedDryPerH > 0) b.wetness -= (env.forcedDryPerH / 60) * dtMin;
  else if (input <= 0) {
    // 汗が蒸発の余力より少なければ、その余りで乾く（汗をかいていても少しずつ乾く）
    const spare = sweatW <= 0 ? 1 : Math.max(0, 1 - sweatW / Math.max(1, evapThroughW));
    const warm = env.tairC > p.dryWarmAboveC ? 1 : p.dryColdF;
    b.wetness -= ((p.dryPerH * (1 + p.dryWindK * env.windMs) * warm * (env.dryF ?? 1) * spare) / 60) * dtMin;
  }
  b.wetness = Math.min(1, Math.max(0, b.wetness));
  if (env.precipMmH > 0 && env.wetInputF > 0) b.rainExposureMin += dtMin;

  // ---- エネルギー ----
  const expend = ((act.metAct + shiver) * d.weightKg) / 60; // kcal/min
  const frac = act.metAct > p.glycoFracMetAbove ? p.glycoFracHigh : p.glycoFracLow;
  b.glycogenKcal -= expend * frac * dtMin;
  const absorb = Math.min(b.gutKcal, p.absorbKcalPerMin * dtMin);
  b.gutKcal -= absorb;
  b.glycogenKcal += absorb * p.absorbEff;
  if (env.staffed) b.glycogenKcal += p.staffedMealKcalPerMin * p.absorbEff * dtMin; // 小屋の食事
  b.glycogenKcal = Math.min(p.glycogenMax, Math.max(0, b.glycogenKcal));

  // ---- 水分 ----
  const heatF = env.tairC > p.waterHotAboveC ? p.waterHotF : env.tairC > p.waterWarmAboveC ? p.waterWarmF : 1;
  const lossLPerH = p.waterBaseLPerH + p.waterPerMetLPerH * act.metAct * heatF;
  b.waterDeficitL = Math.min(p.waterDeficitMax, b.waterDeficitL + (lossLPerH / 60) * dtMin);
  // 営業小屋では水や温かい飲み物を買える（避難小屋には水がないことが多いので、飲まない）
  if (env.staffed) b.waterDeficitL = Math.max(0, b.waterDeficitL - (p.staffedDrinkLPerH / 60) * dtMin);
  // ツエルト・タープで止まっていて雨が降っていれば、雨水をためて水筒に足す（持ってきた量まで）
  if (STILL.has(c.state) && d.gear.bivy !== 'none' && env.precipMmH > 0.5 && c.inv.waterL < d.gear.waterL) {
    const l = (Math.min(p.rainCollectMaxLPerH, p.rainCollectLPerHPerMm * env.precipMmH) / 60) * dtMin;
    c.inv.waterL = Math.min(d.gear.waterL, c.inv.waterL + l);
  }
  // アルコールは時間とともに抜ける。分解した分に応じて尿が増える（利尿）
  if (b.alcoholG !== undefined && b.alcoholG > 0) {
    const g = Math.min(b.alcoholG, (p.alcoholElimGPerH / 60) * dtMin);
    b.alcoholG -= g;
    b.waterDeficitL = Math.min(p.waterDeficitMax, b.waterDeficitL + g * p.alcoholDiuresisLPerG);
  }

  // ---- 疲労 ----
  if (act.walking) {
    const gain = (Math.max(0, act.metAct - p.fatigueMetFree) * p.fatigueGainK) / d.fitness + (act.grade > p.fatigueSteepGrade ? p.fatigueSteepGain : 0);
    b.fatigue += gain * dtMin;
  } else {
    let rec = p.fatigueRecoverRest;
    if (c.state === 'SHELTERED') rec = p.fatigueRecoverHut;
    else if (c.state === 'BIVOUAC' || c.state === 'WAITING_RESCUE') {
      rec = b.coreC < p.fatigueColdBelowC ? p.fatigueRecoverColdBivouac : p.fatigueRecoverBivouac;
    }
    b.fatigue -= rec * dtMin;
  }
  b.fatigue = Math.min(100, Math.max(0, b.fatigue));

  return { netW: net, shiverMet: shiver };
}

/**
 * 浸水（docs/06 §4.1）: 冷水に浸かって濡れ、水中にいた時間ぶんの熱を一度に失う。
 * 追加損失は水温 10℃ を基準に (37 − 水温) / 27 で補正し、体の熱容量で深部体温の低下に換算する。
 */
export function applySoak(c: ClimberState, level: SoakLevel, waterTempC: number, tMin: number, tuning: Tuning = TUNING): void {
  const p = tuning.physiology;
  const s = p.soak[level];
  const b = c.body;
  if (!b.alive || !s) return;
  b.wetness = level === 'full' ? 1 : Math.min(1, b.wetness + s.wetAdd);
  const joule = s.lossW * s.waterMin * 60 * ((37 - waterTempC) / p.soakRefSpanC);
  b.coreC = Math.max(p.coreMin, b.coreC - joule / (c.def.weightKg * p.specificHeatJ * p.kMass));
  b.coldExtremitiesUntilMin = Math.max(b.coldExtremitiesUntilMin ?? 0, tMin + p.soakColdExtremitiesMin);
}

/** 水温: 雪解け水なら 2℃、それ以外は局地気温 − 2℃（下限 2℃） */
export function soakWaterTempC(c: ClimberState, snowmelt: boolean, tuning: Tuning = TUNING): number {
  const p = tuning.physiology;
  return snowmelt ? p.soakMinWaterC : Math.max(p.soakMinWaterC, c.local.tempC - 2);
}

/** World の状態から熱環境を作る（docs/06 §3.1） */
export function thermalEnvFor(world: World, ctx: StaticContext, c: ClimberState): ThermalEnv {
  const p = ctx.tuning.physiology;
  const l = c.local;
  const b = c.body;
  const gr = groundAt(world.ground, c.elevM);
  const groundTempC = gr.snowCm > 0 ? 0 : Math.max(l.tempC - p.groundBelowAirC, 0);
  const env: ThermalEnv = {
    tairC: l.tempC,
    windMs: l.windMs,
    walkSpeedMs: c.speedMs,
    precipMmH: l.precipMmH,
    precipType: l.precipType,
    solarW: l.solarW,
    extraClo: 0,
    wetInputF: 1,
    condensePerH: 0,
    forcedDryPerH: 0,
    groundContact: false,
    groundTempC,
    staffed: false,
  };
  const shelterNode = b.shelterNodeId ? ctx.map.nodes[b.shelterNodeId] : undefined;
  if (shelterNode?.shelter) {
    const staffed = shelterNode.shelter.kind === 'staffed';
    env.tairC = staffed ? p.staffedTempC : Math.max(l.tempC + p.emergencyTempUpC, l.tempC);
    env.windMs = 0;
    env.precipMmH = 0;
    env.precipType = 'none';
    env.solarW = 0;
    env.wetInputF = 0;
    env.forcedDryPerH = staffed ? p.staffedDryPerH : p.emergencyDryPerH;
    env.staffed = staffed;
    return env;
  }
  if (l.inCloud) env.dryF = p.inCloudDryF;
  // 風下の効果とツェルト等は重ねて効く
  if (b.leeShelter > 0) {
    env.windMs *= 1 - b.leeShelter;
    env.wetInputF = p.leePrecipF;
  }
  if (b.inBivy) {
    env.tairC = l.tempC + p.bivyTempUpC;
    env.windMs *= p.bivyWindF;
    env.wetInputF = 0;
    env.condensePerH = p.bivyCondensePerH;
    env.extraClo = p.bivyClo[c.def.gear.bivy] ?? 0;
  }
  const lying = c.state === 'BIVOUAC' || c.state === 'WAITING_RESCUE' || c.state === 'INCAPACITATED' || c.state === 'UNCONSCIOUS' || c.state === 'STAYING';
  if (lying && world.climbers.length > 1 && inTent(world, c, p)) {
    // テント（同じ場所でビバーク中の仲間が張ったもの）
    env.tairC = Math.max(env.tairC, l.tempC + p.tentTempUpC);
    env.windMs = Math.min(env.windMs, l.windMs * p.tentWindF);
    env.wetInputF = 0;
  } else if (lying && c.def.gear.rescueSheet && !b.inBivy) {
    env.windMs *= p.rescueSheetWindF;
    env.extraClo += p.rescueSheetClo;
  }
  env.groundContact =
    c.state === 'BIVOUAC' || c.state === 'STAYING' || c.state === 'WAITING_RESCUE' || c.state === 'INCAPACITATED' || c.state === 'UNCONSCIOUS' || c.state === 'DEAD';
  return env;
}

/**
 * テントに入れるか: 同じグループで近くにいる、ビバーク中・救助待ちの動ける仲間がテントを持っていること。
 * 入れるのは体温の低い順に tentCapacity 人まで。
 */
function inTent(world: World, c: ClimberState, p: Tuning['physiology']): boolean {
  let pitched = false;
  let colder = 0;
  const d2 = p.tentDistM * p.tentDistM;
  for (const o of world.climbers) {
    if (o.groupId !== c.groupId || !o.body.alive) continue;
    if ((o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z) > d2) continue;
    if (o.def.gear.tent && o.body.conscious && (o.state === 'BIVOUAC' || o.state === 'WAITING_RESCUE')) pitched = true;
    if (o !== c && (o.body.coreC < c.body.coreC || (o.body.coreC === c.body.coreC && o.id < c.id))) colder += 1;
  }
  return pitched && colder < p.tentCapacity;
}

/** 不安の目標値（docs/06 §5.4）へ τ=20 分で近づける */
export function updateAnxiety(world: World, c: ClimberState, dtMin: number, tuning: Tuning = TUNING): void {
  const p = tuning.physiology;
  const b = c.body;
  const l = c.local;
  const companionWorse = world.climbers.some(
    (o) => o.id !== c.id && o.groupId === c.groupId && (o.body.coreC < p.stageMildC || o.body.injury !== 'none' || !o.body.conscious),
  );
  let target = p.anxietyBase;
  if (world.sun.isDark) target += p.anxDark;
  if (l.visibilityM < p.anxLowVisM) target += p.anxLowVis;
  if (l.windMs > p.anxWindMs) target += p.anxWind;
  if (l.precipMmH > p.anxPrecipMmH) target += p.anxPrecip;
  if (c.perception.awareLost) target += p.anxLost;
  if (b.injury !== 'none') target += p.anxInjury;
  if (companionWorse) target += p.anxCompanion;
  if (c.perception.timeBehindMin > p.anxBehindMin) target += p.anxBehind;
  if (b.shelterNodeId) target += p.anxShelter;
  if (world.rescue.status !== 'none' && world.rescue.status !== 'searching') target += p.anxRescue;
  target = Math.min(100, Math.max(0, target));
  b.anxiety += (target - b.anxiety) * (1 - dexp(-dtMin / p.anxietyTauMin));
}

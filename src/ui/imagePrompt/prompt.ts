/**
 * 場面の写し（scene.ts）から、画像生成 AI 用のプロンプトを組み立てる（ユーザーの指定）。日本語と英語、画風と縦横を選べる。
 * 場所・時刻・天気・地形・人物・動物・場面の文・構図・画風と、流血などを描かない注意を入れる。ネガティブプロンプトも返す。
 */
import { fill } from '../../i18n/format';
import { JACKET_COLORS, PROMPT_STYLES, PROMPT_TEXT, type PromptLang } from '../../i18n/imagePrompt';
import type { SceneSnap } from './scene';

export type Aspect = 'wide' | 'square' | 'tall';

/** 上着の色の名前（いちばん近い色） */
function colorName(hex: string, lang: PromptLang): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '';
  const rgb = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  let best = JACKET_COLORS[0]!;
  let bd = Infinity;
  for (const c of JACKET_COLORS) {
    const d = (c.rgb[0] - rgb[0]!) ** 2 + (c.rgb[1] - rgb[1]!) ** 2 + (c.rgb[2] - rgb[2]!) ** 2;
    if (d < bd) (bd = d), (best = c);
  }
  return lang === 'ja' ? best.ja : best.en;
}

function timeKey(s: SceneSnap): string {
  const clock = ((s.tMin % 1440) + 1440) % 1440;
  if (s.sun.isDark) return s.sun.moonIllum > 0.4 && !s.wx.inCloud && s.wx.precipMmH < 0.2 ? 'nightMoon' : 'night';
  if (s.sun.twilight || s.sun.elevDeg < 0) return clock < 720 ? 'dawn' : 'dusk';
  if (s.sun.elevDeg < 15) return clock < 720 ? 'lowSunAm' : 'lowSunPm';
  return 'day';
}

function weatherParts(s: SceneSnap, T: (typeof PROMPT_TEXT)['ja']): string[] {
  const w = s.wx;
  const out: string[] = [];
  const p = w.precipMmH;
  if (p >= 0.2) {
    if (w.precipType === 'snow') out.push(p >= 3 || w.windMs >= 12 ? T.snowHeavy : p >= 1 ? T.snow : T.snowLight);
    else if (w.precipType === 'sleet') out.push(T.sleet);
    else if (w.precipType === 'hail') out.push(T.hail);
    else out.push(p >= 4 ? T.rainHeavy : p >= 1 ? T.rain : T.rainLight);
  }
  if (w.inCloud || w.visibilityM < 500) out.push(w.visibilityM < 100 ? T.fogThick : w.inCloud ? T.inCloud : T.fog);
  if (w.windMs >= 15) out.push(T.windStrong);
  else if (w.windMs >= 8) out.push(T.wind);
  if (w.thunder > 0.5) out.push(T.thunder);
  if (w.tempC <= 0) out.push(T.freezing);
  else if (w.tempC >= 28) out.push(T.hot);
  if (out.length === 0) out.push(s.sun.isDark ? T.cloudy : w.visibilityM > 3000 ? T.clear : T.cloudy);
  return out;
}

function personText(p: SceneSnap['people'][number], lang: PromptLang): string {
  const T = PROMPT_TEXT[lang];
  const who = p.age <= 12 ? fill(T.child, { age: p.age }) : fill(T.person, { age: Math.floor(p.age / 10) * 10, sex: p.sex === 'f' ? T.sexF : T.sexM });
  const parts = [
    p.pose === 'shelter' ? null : fill(T.jacket, { color: colorName(p.color, lang) }),
    p.rainwear ? T.rainwear : null,
    p.headlamp ? T.headlamp : null,
    T.pose[p.pose] ?? null,
    T.injury[p.injury] ?? null,
    p.coreC < 33 ? T.limp : p.coreC < 35 ? T.shiver : null,
  ].filter((x): x is string => !!x);
  return lang === 'ja' ? `${who}（${parts.join('、')}）` : `${who} (${parts.join(', ')})`;
}

/** プロンプトとネガティブプロンプト */
export function buildPrompt(s: SceneSnap, styleId: string, lang: PromptLang, aspect: Aspect): { prompt: string; negative: string } {
  const T = PROMPT_TEXT[lang];
  const style = PROMPT_STYLES.find((x) => x.id === styleId) ?? PROMPT_STYLES[0]!;
  const ja = lang === 'ja';
  const sep = ja ? '、' : ', ';
  const region = s.region ? (ja ? s.region : `${s.region} (Japan)`) : T.fictionalMountain;
  const place = `${region}${s.onTrail ? T.trail : T.offTrail}`;
  const where = [place, s.nodeName ? fill(T.near, { node: s.nodeName }) : null, fill(T.elev, { m: s.elevM.toLocaleString('en-US') })].filter(Boolean).join(sep);
  const when = [T.time[timeKey(s)], ja ? `${fill(T.month, { m: s.month })}・${T.season[s.season] ?? ''}` : `${T.season[s.season] ?? ''} (month ${s.month})`].join(sep);
  const land = [
    T.veg[s.veg] ?? T.veg[0],
    (s.veg === 0 || s.veg === 1) && s.snowCm < 5 ? T.leaves[s.season] : null,
    s.snowCm >= 5 ? T.snowGround : s.wet ? T.wetGround : null,
    s.slopeDeg >= 30 ? T.steep : null,
  ].filter((x): x is string => !!x).join(sep);
  const people = s.people.map((p) => personText(p, lang));
  if (s.more > 0) people.push(fill(T.morePeople, { n: s.more }));
  const animals = s.animals.map((a) => fill(T.animalAt, { what: T.animal[a.species] ?? a.species, m: a.distM }));
  if (s.heli) animals.push(T.heli);
  const close = s.people.length > 0 && s.people.length <= 2 && !s.animals.length;
  const lines = [
    `${T.style}: ${ja ? style.ja : style.en}`,
    `${where}${sep}${when}${sep}${weatherParts(s, T).join(sep)}${sep}${land}`,
    people.length > 0 ? `${T.people}: ${people.join(ja ? '、' : '; ')}` : null,
    animals.length > 0 ? `${T.animals}: ${animals.join(sep)}` : null,
    `${T.scene}: ${ja ? `「${s.text}」` : `"${s.text}" (Japanese)`}`,
    `${T.composition}: ${close ? T.compClose : T.compDefault}${sep}${T.aspect[aspect]}`,
    T.safety,
  ].filter((x): x is string => !!x);
  // 行の終わりに句点（すでに付いている行には付けない）
  const stop = ja ? '。' : '.';
  const prompt = lines.map((x) => (x.endsWith(stop) ? x : x + stop)).join('\n');
  return { prompt, negative: T.negative };
}

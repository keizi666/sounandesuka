/** 画像生成 AI 用のプロンプト（src/ui/imagePrompt/prompt.ts） */
import { describe, expect, it } from 'vitest';
import { PROMPT_STYLES } from '../src/i18n/imagePrompt';
import { buildPrompt } from '../src/ui/imagePrompt/prompt';
import type { SceneSnap } from '../src/ui/imagePrompt/scene';

const scene: SceneSnap = {
  text: '尾根の先、左の斜面の木の間に黒い姿が見えた。',
  tMin: 12 * 60 + 27,
  month: 10,
  season: 'autumn',
  region: '奥多摩・高水三山（青梅市）',
  nodeName: '岩茸石山',
  onTrail: true,
  elevM: 720,
  veg: 0,
  slopeDeg: 12,
  snowCm: 0,
  wet: false,
  sun: { elevDeg: 35, isDark: false, twilight: false, moonIllum: 0.5 },
  wx: { tempC: 14, windMs: 3, precipMmH: 0, precipType: 'none', visibilityM: 20000, thunder: 0, inCloud: false },
  people: [{ age: 76, sex: 'f', color: '#3266c8', pose: 'stand', injury: 'none', rainwear: false, headlamp: false, coreC: 37 }],
  more: 0,
  animals: [{ species: 'bear', distM: 70 }],
  heli: false,
};

describe('画像生成のプロンプト', () => {
  it('場所・時刻・天気・植生・人物・動物・場面・画風・注意が入る', () => {
    const { prompt, negative } = buildPrompt(scene, 'watercolor', 'ja', 'wide');
    for (const w of ['透明水彩', '高水三山', '岩茸石山', '720 m', '昼間', '10月', '晴れ', '広葉樹の森', '紅葉', '70代の女性', '青の上着', 'ツキノワグマ', '黒い姿', '横長 16:9', '流血']) expect(prompt).toContain(w);
    expect(negative).toContain('流血');
  });
  it('英語でも作れる。夜・雨・強風・雪・けがの言葉', () => {
    const night: SceneSnap = { ...scene, sun: { elevDeg: -20, isDark: true, twilight: false, moonIllum: 0.1 }, wx: { ...scene.wx, precipMmH: 5, precipType: 'rain', windMs: 16 }, people: [{ ...scene.people[0]!, headlamp: true, rainwear: true, injury: 'legFracture', pose: 'crawl', coreC: 34 }] };
    const { prompt } = buildPrompt(night, 'sumi', 'en', 'tall');
    for (const w of ['sumi-e', 'pitch-dark night', 'heavy rain', 'violent gale', 'headlamp on', 'wearing rain gear', 'crawling', 'favoring an injured leg', 'shivering', 'vertical 9:16', '(Japan)']) expect(prompt).toContain(w);
  });
  it('どの画風でも作れる', () => {
    for (const s of PROMPT_STYLES) expect(buildPrompt(scene, s.id, 'ja', 'square').prompt).toContain(s.ja.slice(0, 4));
  });
});

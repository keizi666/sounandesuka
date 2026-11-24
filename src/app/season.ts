/** 月（1〜12）の季節（3〜5 春・6〜8 夏・9〜11 秋・12〜2 冬）。トップの並び（いまの季節を先に）と週替わりのお題に使う */
export function seasonOfMonth(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}

/** いまの季節（日本時間） */
export function currentSeason(nowMs: number = Date.now()): 'spring' | 'summer' | 'autumn' | 'winter' {
  return seasonOfMonth(new Date(nowMs + 9 * 3600000).getUTCMonth() + 1);
}

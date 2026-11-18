/**
 * 日の出・日の入り（NOAA の簡易式、±2 分程度。docs/18 §1）。sim ではなくエディターで使う。
 * 戻り値はその日の 0 時からの分（日本標準時 = UTC+9 で計算）。
 */
const D = Math.PI / 180;

export function sunTimes(dateYmd: string, lat: number, lon: number, tzHours = 9): { sunriseMin: number; sunsetMin: number } {
  const [y, m, d] = dateYmd.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, 0, 1);
  const doy = Math.floor((Date.UTC(y, m - 1, d) - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + 0.5);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const zen = 90.833 * D;
  const cosH = (Math.cos(zen) - Math.sin(lat * D) * Math.sin(decl)) / (Math.cos(lat * D) * Math.cos(decl));
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / D;
  const noon = 720 - 4 * lon - eqt + tzHours * 60;
  return { sunriseMin: noon - 4 * ha, sunsetMin: noon + 4 * ha };
}

export function hhmm(min: number): string {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

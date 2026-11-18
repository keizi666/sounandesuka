/**
 * 超越関数の窓口（NFR-04 決定論）。
 * Math.sin などの超越関数は ECMAScript で結果の最終ビットが保証されず、エンジン間で差が出うる。
 * sim ではここ経由でだけ使い、ブラウザと Node でハッシュがずれたらこのファイルを
 * 決定論的な実装（fdlibm の移植など）に差し替える。`**` 演算子も sim では使わず dpow を使う。
 * sqrt / abs / floor / min / max などは IEEE 754 で正確なので Math を直接使ってよい。
 */

export const PI = Math.PI;
export const DEG = Math.PI / 180;

export function dsin(x: number): number {
  return Math.sin(x);
}
export function dcos(x: number): number {
  return Math.cos(x);
}
export function dtan(x: number): number {
  return Math.tan(x);
}
export function datan(x: number): number {
  return Math.atan(x);
}
export function datan2(y: number, x: number): number {
  return Math.atan2(y, x);
}
export function dexp(x: number): number {
  return Math.exp(x);
}
export function dlog(x: number): number {
  return Math.log(x);
}
/** 指数が整数なら掛け算で計算する（環境差をさらに減らす） */
export function dpow(x: number, y: number): number {
  if (Number.isInteger(y) && y >= 0 && y <= 8) {
    let r = 1;
    for (let i = 0; i < y; i += 1) r *= x;
    return r;
  }
  return Math.pow(x, y);
}

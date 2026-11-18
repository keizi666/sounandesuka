/**
 * 高品質用の追加アセット（docs/10 §10）を手続きで作り、public/assets/hq/ に書き出す。
 *   npm run assets:hq
 * - terrain_detail.png: 地表の細部（土・草・礫）。1024×1024、継ぎ目なし（周期的なノイズ）。R=明暗、G=粒、B=筋。
 * - manifest.json: ファイルの一覧と大きさ。プレイヤーは高品質のときだけ読み込み、失敗したら基本のまま続ける。
 */
import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePng } from './lib/image';

const OUT = resolve(import.meta.dirname, '../public/assets/hq');
const N = 1024;

// 周期的な値ノイズ（period で継ぎ目なし）
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const u = tx * tx * (3 - 2 * tx);
  const v = ty * ty * (3 - 2 * ty);
  const w = (a: number, b: number): number => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(xi, yi) + (w(xi + 1, yi) - w(xi, yi)) * u;
  const b = w(xi, yi + 1) + (w(xi + 1, yi + 1) - w(xi, yi + 1)) * u;
  return a + (b - a) * v;
}
function fbm(x: number, y: number, base: number, oct: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < oct; o += 1) {
    s += amp * vnoise((x / N) * base * f, (y / N) * base * f, base * f, seed + o);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

const px = new Uint8Array(N * N * 3);
for (let y = 0; y < N; y += 1) {
  for (let x = 0; x < N; x += 1) {
    const i = (y * N + x) * 3;
    px[i] = Math.round(Math.min(1, fbm(x, y, 8, 6, 1) * 1.1) * 255);
    px[i + 1] = Math.round(Math.min(1, fbm(x, y, 64, 3, 11)) * 255);
    // 筋（斜面の流れのような縞）
    const st = 0.5 + 0.5 * Math.sin((y / N) * Math.PI * 2 * 24 + fbm(x, y, 6, 3, 21) * 9);
    px[i + 2] = Math.round(st * 255);
  }
}
writePng(resolve(OUT, 'terrain_detail.png'), N, N, px, 3);
const files = ['terrain_detail.png'].map((f) => ({ file: f, bytes: statSync(resolve(OUT, f)).size }));
writeFileSync(resolve(OUT, 'manifest.json'), `${JSON.stringify({ version: 1, files }, null, 2)}\n`);
console.log(files);

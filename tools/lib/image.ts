// グレースケール画像の書き出し（PGM と PNG）。tools 専用（Node の zlib を使う）
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** 8bit グレースケールの PGM（P5） */
export function writePgm(path: string, width: number, height: number, pixels: Uint8Array): void {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii');
  writeFileSync(path, Buffer.concat([header, Buffer.from(pixels)]));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGB（channels=3）またはグレースケール（channels=1）の PNG */
export function writePng(path: string, width: number, height: number, pixels: Uint8Array, channels: 1 | 3 = 1): void {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

/** 値の配列を min..max で 0..255 に写す */
export function normalizeToBytes(values: ArrayLike<number>, min?: number, max?: number): Uint8Array {
  let lo = min ?? Infinity;
  let hi = max ?? -Infinity;
  if (min === undefined || max === undefined) {
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]!;
      if (min === undefined && v < lo) lo = v;
      if (max === undefined && v > hi) hi = v;
    }
  }
  const out = new Uint8Array(values.length);
  const span = hi - lo || 1;
  for (let i = 0; i < values.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round(((values[i]! - lo) / span) * 255)));
  }
  return out;
}

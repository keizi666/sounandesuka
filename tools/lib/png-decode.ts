// tools 用: PNG の最小デコーダ（8bit の RGB / RGBA / グレースケール / パレット、インターレースなし）。地理院の標高タイルを Node で読むために使う。
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA（width × height × 4） */
  rgba: Uint8Array;
}

export function decodePng(buf: Uint8Array): DecodedPng {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではありません');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
      if (data[8] !== 8) throw new Error(`ビット深度 ${data[8]} には対応していません`);
      if (data[12] !== 0) throw new Error('インターレース PNG には対応していません');
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= ch ? px[y * stride + x - ch]! : 0;
      const up = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const ul = y > 0 && x >= ch ? px[(y - 1) * stride + x - ch]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - ul;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (colorType === 3 && palette) {
      const k = px[i]!;
      rgba.set([palette[k * 3]!, palette[k * 3 + 1]!, palette[k * 3 + 2]!, trns && k < trns.length ? trns[k]! : 255], i * 4);
    } else if (ch >= 3) rgba.set([px[i * ch]!, px[i * ch + 1]!, px[i * ch + 2]!, ch === 4 ? px[i * ch + 3]! : 255], i * 4);
    else rgba.set([px[i * ch]!, px[i * ch]!, px[i * ch]!, 255], i * 4);
  }
  return { width, height, rgba };
}

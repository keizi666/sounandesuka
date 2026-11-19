/**
 * Mapbox Vector Tile（PBF）の最小の読み取り。地理院のベクトルタイルから点の地物（植生記号など）を取り出すためだけに使う。
 * 仕様: https://github.com/mapbox/vector-tile-spec （Tile.layers=3、Layer: name=1 features=2 keys=3 values=4 extent=5、
 * Feature: tags=2 type=3 geometry=4）。線・面の座標は読まない（点だけ）。
 */
export type MvtValue = string | number | boolean | null;

export interface MvtPoint {
  layer: string;
  /** タイルの左上を 0、extent を右下とする座標 */
  x: number;
  y: number;
  extent: number;
  props: Record<string, MvtValue>;
}

class Reader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  varint(): number {
    let v = 0;
    let s = 0;
    for (;;) {
      const c = this.b[this.p++]!;
      v += (c & 0x7f) * 2 ** s;
      if ((c & 0x80) === 0) return v;
      s += 7;
    }
  }
  /** 1 つのメッセージのフィールドを順に渡す。長さつき（型 2）は [始め, 終わり] */
  fields(start: number, end: number, cb: (field: number, type: number, v: number | [number, number]) => void): void {
    this.p = start;
    while (this.p < end) {
      const key = this.varint();
      const field = Math.floor(key / 8);
      const type = key & 7;
      if (type === 0) cb(field, type, this.varint());
      else if (type === 2) {
        const len = this.varint();
        const s = this.p;
        this.p += len;
        const keep = this.p;
        cb(field, type, [s, s + len]);
        this.p = keep;
      } else if (type === 5) {
        cb(field, type, this.p);
        this.p += 4;
      } else if (type === 1) {
        cb(field, type, this.p);
        this.p += 8;
      } else throw new Error(`PBF: 未対応の型 ${type}`);
    }
  }
}

const td = new TextDecoder();
const zigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/** タイルの中の点の地物をすべて返す（layers を指定すればその層だけ） */
export function decodeMvtPoints(buf: Uint8Array, layers?: readonly string[]): MvtPoint[] {
  const r = new Reader(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const layerRanges: [number, number][] = [];
  r.fields(0, buf.length, (f, t, v) => {
    if (f === 3 && t === 2) layerRanges.push(v as [number, number]);
  });
  const out: MvtPoint[] = [];
  for (const [ls, le] of layerRanges) {
    let name = '';
    let extent = 4096;
    const keys: string[] = [];
    const values: MvtValue[] = [];
    const feats: [number, number][] = [];
    r.fields(ls, le, (f, t, v) => {
      if (f === 1 && t === 2) name = td.decode(buf.subarray((v as [number, number])[0], (v as [number, number])[1]));
      else if (f === 2 && t === 2) feats.push(v as [number, number]);
      else if (f === 3 && t === 2) keys.push(td.decode(buf.subarray((v as [number, number])[0], (v as [number, number])[1])));
      else if (f === 5 && t === 0) extent = v as number;
      else if (f === 4 && t === 2) {
        const [vs, ve] = v as [number, number];
        const save = r.p;
        let val: MvtValue = null;
        r.fields(vs, ve, (ff, tt, vv) => {
          if (ff === 1 && tt === 2) val = td.decode(buf.subarray((vv as [number, number])[0], (vv as [number, number])[1]));
          else if (ff === 2 && tt === 5) val = dv.getFloat32(vv as number, true);
          else if (ff === 3 && tt === 1) val = dv.getFloat64(vv as number, true);
          else if ((ff === 4 || ff === 5) && tt === 0) val = vv as number;
          else if (ff === 6 && tt === 0) val = zigzag(vv as number);
          else if (ff === 7 && tt === 0) val = (vv as number) !== 0;
        });
        r.p = save;
        values.push(val);
      }
    });
    if (layers && !layers.includes(name)) continue;
    for (const [fs, fe] of feats) {
      let type = 0;
      let tags: number[] = [];
      let geom: number[] = [];
      const save = r.p;
      r.fields(fs, fe, (f, t, v) => {
        if (t !== 2 && f === 3) type = v as number;
        else if (t === 2 && (f === 2 || f === 4)) {
          const [s, e] = v as [number, number];
          const keep = r.p;
          r.p = s;
          const arr: number[] = [];
          while (r.p < e) arr.push(r.varint());
          r.p = keep;
          if (f === 2) tags = arr;
          else geom = arr;
        }
      });
      r.p = save;
      if (type !== 1) continue; // 点だけ
      const props: Record<string, MvtValue> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]!] ?? `k${tags[i]}`] = values[tags[i + 1]!] ?? null;
      // MoveTo（id 1）の連続。座標は前の点からの差（zigzag）
      let cx = 0;
      let cy = 0;
      let i = 0;
      while (i < geom.length) {
        const cmd = geom[i++]!;
        const id = cmd & 7;
        const count = Math.floor(cmd / 8);
        if (id !== 1) break;
        for (let k = 0; k < count && i + 1 < geom.length; k += 1) {
          cx += zigzag(geom[i++]!);
          cy += zigzag(geom[i++]!);
          out.push({ layer: name, x: cx, y: cy, extent, props });
        }
      }
    }
  }
  return out;
}

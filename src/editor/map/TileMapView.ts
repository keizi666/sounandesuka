/**
 * 2D 地図ビュー（docs/16 §2）。自作の Canvas2D。地理院タイル（docs/15 §4 の表のものだけ）を背景に、レイヤーを重ねる。
 * パン（ドラッグ）、ズーム（ホイール、z 10〜17）、タイルの LRU キャッシュ 400 枚、右下に出典。
 * 道具（MapTool）がポインタを取れば、パンの代わりに道具が動く（範囲の移動、道の手描き、塗りなど）。
 */
import { lonLatToTile, tileToLonLat, tileUrl, type BaseLayer } from '../geo/tiles';
import { toLatLon, toXZ } from '../geo/projection';

export interface MapPointer {
  px: number;
  py: number;
  lat: number;
  lon: number;
  x: number;
  z: number;
  ev: PointerEvent | MouseEvent;
}

export interface MapTool {
  cursor?: string;
  /** true を返すとドラッグを道具が受け取る（パンしない） */
  down?(p: MapPointer): boolean;
  move?(p: MapPointer, dragging: boolean): void;
  up?(p: MapPointer): void;
  click?(p: MapPointer): void;
  dblclick?(p: MapPointer): void;
}

export interface MapLayer {
  id: string;
  visible: boolean;
  draw(g: CanvasRenderingContext2D, v: TileMapView): void;
}

const TILE = 256;
const CACHE_MAX = 400;

export class TileMapView {
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  lat = 36.4;
  lon = 137.7;
  zoom = 13;
  base: BaseLayer | 'none' = 'std';
  hillshade = false;
  /** 箱庭の原点（エリア中心）。x・z との変換に使う */
  lat0 = 36.4;
  lon0 = 137.7;
  layers: MapLayer[] = [];
  tool: MapTool | null = null;
  /** タイルを使わない（オフライン・架空の山） */
  offline = false;
  onView: (() => void) | null = null;
  private cache = new Map<string, HTMLImageElement>();
  private pending = 0;
  private attribution: HTMLElement;
  private scheduled = false;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tilemap';
    this.attribution = document.createElement('div');
    this.attribution.className = 'map-attr';
    this.attribution.innerHTML = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
    this.root = document.createElement('div');
    this.root.className = 'tilemap-root';
    this.root.append(this.canvas, this.attribution);
    host.append(this.root);
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.root);
  }

  resize(): void {
    const r = this.root.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.redraw();
  }

  get width(): number {
    return this.canvas.width / Math.min(2, window.devicePixelRatio || 1);
  }
  get height(): number {
    return this.canvas.height / Math.min(2, window.devicePixelRatio || 1);
  }

  // ---- 座標変換（CSS ピクセル）----
  private centerTile(): { x: number; y: number } {
    return lonLatToTile(this.lon, this.lat, this.zoom);
  }
  toPx(lat: number, lon: number): { px: number; py: number } {
    const c = this.centerTile();
    const t = lonLatToTile(lon, lat, this.zoom);
    return { px: (t.x - c.x) * TILE + this.width / 2, py: (t.y - c.y) * TILE + this.height / 2 };
  }
  fromPx(px: number, py: number): { lat: number; lon: number } {
    const c = this.centerTile();
    const ll = tileToLonLat(c.x + (px - this.width / 2) / TILE, c.y + (py - this.height / 2) / TILE, this.zoom);
    return { lat: ll.lat, lon: ll.lon };
  }
  xzToPx(x: number, z: number): { px: number; py: number } {
    const ll = toLatLon(this.lat0, this.lon0, x, z);
    return this.toPx(ll.lat, ll.lon);
  }
  pxToXz(px: number, py: number): { x: number; z: number } {
    const ll = this.fromPx(px, py);
    return toXZ(this.lat0, this.lon0, ll);
  }
  /** 1 m が何ピクセルか（中心付近） */
  pxPerM(): number {
    const a = this.xzToPx(0, 0);
    const b = this.xzToPx(1000, 0);
    return Math.hypot(b.px - a.px, b.py - a.py) / 1000;
  }

  setView(lat: number, lon: number, zoom = this.zoom): void {
    this.lat = lat;
    this.lon = lon;
    this.zoom = Math.max(8, Math.min(17, zoom));
    this.redraw();
    this.onView?.();
  }

  /** 箱庭の範囲がちょうど入るように */
  fitArea(sizeM: number): void {
    const ll = { lat: this.lat0, lon: this.lon0 };
    const metersPerPxAtZ0 = (156543.03 * Math.cos((ll.lat * Math.PI) / 180));
    const z = Math.log2((metersPerPxAtZ0 * Math.min(this.width, this.height) * 0.85) / sizeM);
    this.setView(ll.lat, ll.lon, Math.floor(z * 4) / 4);
  }

  redraw(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // rAF はタブが隠れていると止まるので、setTimeout でまとめる
    setTimeout(() => {
      this.scheduled = false;
      this.draw();
    }, 0);
  }

  private tile(layer: string, z: number, x: number, y: number): HTMLImageElement | null {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    const xx = ((x % n) + n) % n;
    const key = `${layer}/${z}/${xx}/${y}`;
    let img = this.cache.get(key);
    if (img) {
      this.cache.delete(key);
      this.cache.set(key, img);
      return img.complete && img.naturalWidth > 0 ? img : null;
    }
    if (this.pending >= 8) return null;
    img = new Image();
    img.crossOrigin = 'anonymous';
    this.pending += 1;
    img.onload = img.onerror = () => {
      this.pending -= 1;
      this.redraw();
    };
    img.src = tileUrl(layer as BaseLayer, z, xx, y);
    this.cache.set(key, img);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return null;
  }

  draw(): void {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#d9d6cf';
    g.fillRect(0, 0, this.width, this.height);
    if (!this.offline && this.base !== 'none') {
      this.drawTiles(g, this.base, 1);
      if (this.hillshade) this.drawTiles(g, 'hillshademap', 0.45);
    }
    for (const l of this.layers) if (l.visible) l.draw(g, this);
    this.attribution.style.display = this.offline || this.base === 'none' ? 'none' : '';
  }

  private drawTiles(g: CanvasRenderingContext2D, layer: string, alpha: number): void {
    const zi = Math.min(18, Math.max(2, Math.round(this.zoom)));
    const scale = 2 ** (this.zoom - zi);
    const c = lonLatToTile(this.lon, this.lat, zi);
    const size = TILE * scale;
    const x0 = Math.floor(c.x - this.width / 2 / size);
    const x1 = Math.floor(c.x + this.width / 2 / size);
    const y0 = Math.floor(c.y - this.height / 2 / size);
    const y1 = Math.floor(c.y + this.height / 2 / size);
    g.globalAlpha = alpha;
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const img = this.tile(layer, zi, x, y);
        if (img) g.drawImage(img, (x - c.x) * size + this.width / 2, (y - c.y) * size + this.height / 2, size + 0.5, size + 0.5);
      }
    g.globalAlpha = 1;
  }

  private pointer(e: PointerEvent | MouseEvent): MapPointer {
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const ll = this.fromPx(px, py);
    const xz = toXZ(this.lat0, this.lon0, ll);
    return { px, py, lat: ll.lat, lon: ll.lon, x: xz.x, z: xz.z, ev: e };
  }

  private bind(): void {
    let drag: { mode: 'pan' | 'tool'; sx: number; sy: number; lat: number; lon: number; moved: boolean } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const p = this.pointer(e);
      const toolTakes = e.button === 0 && (this.tool?.down?.(p) ?? false);
      drag = { mode: toolTakes ? 'tool' : 'pan', sx: e.clientX, sy: e.clientY, lat: this.lat, lon: this.lon, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = this.pointer(e);
      if (drag) {
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
        if (drag.mode === 'pan' && drag.moved) {
          const c = lonLatToTile(drag.lon, drag.lat, this.zoom);
          const ll = tileToLonLat(c.x - (e.clientX - drag.sx) / TILE, c.y - (e.clientY - drag.sy) / TILE, this.zoom);
          this.setView(ll.lat, ll.lon);
        } else if (drag.mode === 'tool') this.tool?.move?.(p, true);
      } else this.tool?.move?.(p, false);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const p = this.pointer(e);
      if (drag?.mode === 'tool') this.tool?.up?.(p);
      if (drag && !drag.moved && e.button === 0) this.tool?.click?.(p);
      drag = null;
    });
    this.canvas.addEventListener('dblclick', (e) => this.tool?.dblclick?.(this.pointer(e)));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.pointer(e);
        const nz = Math.max(8, Math.min(17, this.zoom - Math.sign(e.deltaY) * 0.25));
        // カーソル位置を固定してズーム
        const before = lonLatToTile(p.lon, p.lat, nz);
        const ll = tileToLonLat(before.x - (p.px - this.width / 2) / TILE, before.y - (p.py - this.height / 2) / TILE, nz);
        this.setView(ll.lat, ll.lon, nz);
      },
      { passive: false },
    );
  }

  setCursor(c: string): void {
    this.canvas.style.cursor = c;
  }
}

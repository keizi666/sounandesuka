/**
 * アイコンの画像の切り抜き（docs/20_community.md §2.1）。
 * 選んだ画像を丸い枠に合わせ、ドラッグで位置、つまみ・ホイールで大きさを決める。
 * 送るのは、端末で正方形 AVATAR_PX に縮めた WebP（使えない端末は JPEG）だけ。描き直すので EXIF などは付かない。
 */
import { JA } from '../../i18n/ja';
import { AVATAR_MAX_BYTES, AVATAR_PX } from '../../net/rules';
import { el } from '../dom';

const VIEW = 260;

export interface CroppedImage {
  /** 送る画像（base64） */
  b64: string;
  /** 見本に出す URL（data:） */
  url: string;
}

function blobOf(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((ok) => c.toBlob(ok, type, q));
}

async function toB64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 画像を正方形 AVATAR_PX に描いて、上限に収まる WebP（か JPEG）にする */
async function encode(draw: (g: CanvasRenderingContext2D, side: number) => void): Promise<CroppedImage> {
  const c = el('canvas', { width: AVATAR_PX, height: AVATAR_PX });
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  draw(g, AVATAR_PX);
  for (const q of [0.86, 0.75, 0.6, 0.45]) {
    let b = await blobOf(c, 'image/webp', q);
    // WebP を作れない端末（古い Safari）は PNG が返るので JPEG にする
    if (!b || b.type !== 'image/webp') {
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
      g.globalCompositeOperation = 'source-over';
      b = await blobOf(c, 'image/jpeg', q);
    }
    if (b && b.size <= AVATAR_MAX_BYTES) {
      const b64 = await toB64(b);
      return { b64, url: `data:${b.type};base64,${b64}` };
    }
  }
  throw new Error('tooLarge');
}

/**
 * 切り抜きの部品。onChange は、位置や大きさを変えて手を離すたびに、縮めた画像で呼ぶ
 */
export function avatarCrop(img: ImageBitmap, onChange: (r: CroppedImage) => void): HTMLElement {
  const C = JA.community;
  const canvas = el('canvas', { width: VIEW * 2, height: VIEW * 2, class: 'cm-crop-canvas', 'aria-label': C.imageCrop });
  const g = canvas.getContext('2d')!;
  // cover: 枠をちょうど覆う倍率。k はそれに掛ける拡大（1〜4）
  const cover = Math.max(VIEW / img.width, VIEW / img.height);
  let k = 1;
  let cx = img.width / 2;
  let cy = img.height / 2;
  const clamp = (): void => {
    const half = VIEW / (2 * cover * k);
    cx = Math.min(img.width - half, Math.max(half, cx));
    cy = Math.min(img.height - half, Math.max(half, cy));
  };
  /** 枠の中に見える範囲（元の画像の座標） */
  const src = (): [number, number, number] => {
    const side = VIEW / (cover * k);
    return [cx - side / 2, cy - side / 2, side];
  };
  const paint = (): void => {
    const W = canvas.width;
    const [sx, sy, side] = src();
    g.clearRect(0, 0, W, W);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, side, side, 0, 0, W, W);
    // 丸い枠の外を暗く
    g.save();
    g.fillStyle = 'rgba(10, 14, 20, 0.55)';
    g.beginPath();
    g.rect(0, 0, W, W);
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2, true);
    g.fill('evenodd');
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  };
  let timer = 0;
  const emit = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const [sx, sy, side] = src();
      void encode((gg, s) => gg.drawImage(img, sx, sy, side, side, 0, 0, s, s)).then(onChange, () => undefined);
    }, 120);
  };
  const zoom = el('input', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, 'aria-label': C.imageZoom }) as HTMLInputElement;
  zoom.addEventListener('input', () => {
    k = Number(zoom.value);
    clamp();
    paint();
    emit();
  });
  // ドラッグで動かす
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, cx, cy };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const scale = (canvas.getBoundingClientRect().width / VIEW) * cover * k;
    cx = drag.cx - (e.clientX - drag.x) / scale;
    cy = drag.cy - (e.clientY - drag.y) / scale;
    clamp();
    paint();
  });
  const end = (): void => {
    if (!drag) return;
    drag = null;
    emit();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    k = Math.min(4, Math.max(1, k * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    zoom.value = String(k);
    clamp();
    paint();
    emit();
  }, { passive: false });
  paint();
  emit();
  return el('div', { class: 'cm-crop' }, [canvas, el('label', { class: 'cm-crop-zoom' }, [el('span', {}, C.imageZoom), zoom])]);
}

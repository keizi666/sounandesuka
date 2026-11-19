/**
 * 人形の顔に、アイコンの顔の絵を貼る（ユーザーの指定: 顔の部分だけ）。
 * 顔の絵（public/portraits/<区分>.webp。1 人 128px）から、眉・目・鼻・口・あごのあたりだけを切り出し、縁をぼかして肌になじませ、
 * 頭の楕円体の前面に沿った薄い皮として貼る。貼れたら、組み立ての目・眉・頬・口は隠す。
 * 絵が読めなければ何もしない（組み立ての顔のまま）。
 */
import * as THREE from 'three';
import { assetUrl } from '../app/data';
import type { ClimberDef } from '../sim/types';
import { parsePortrait, portraitGroup, portraitIndex } from '../ui/avatar';
import type { FigureRig } from './figureModel';

/** 頭の楕円体（figureModel の ell と同じ。首の骨の座標） */
const HEAD_C = new THREE.Vector3(0, 0.135, 0.008);
const HEAD_R = new THREE.Vector3(0.115 * 0.98, 0.115 * 1.04, 0.115 * 0.98);
/** 皮を頭の面から少し浮かせる倍率 */
const LIFT = 1.012;
/**
 * 顔の皮の広がり（度）: 左右 ±42°、上下は頭の中心から 85°（眉。帽子のつばのすぐ下）〜 144°（あご）。
 * 絵の目が首の骨から 0.128 の高さ（つばのすぐ下）に来るよう、切り出す範囲（眉〜あご、頬まで）と合わせてある
 */
const PHI_HALF = 42;
const THETA0 = 85;
const THETA1 = 144;
/** 絵の 1 人分（128px）の中で切り出す範囲（0..1）。眉からあごまで */
const CROP = { x0: 0.12, x1: 0.88, y0: 0.36, y1: 0.9 };
const OUT = 128;

interface PortraitIndex {
  cols: number;
  cell: number;
  counts: Record<string, number>;
}

let indexP: Promise<PortraitIndex | null> | null = null;
const atlasP = new Map<string, Promise<HTMLImageElement | null>>();

function loadIndex(): Promise<PortraitIndex | null> {
  indexP ??= fetch(assetUrl('portraits/index.json'))
    .then((r) => (r.ok ? (r.json() as Promise<PortraitIndex>) : null))
    .catch(() => null);
  return indexP;
}
function loadAtlas(group: string): Promise<HTMLImageElement | null> {
  let p = atlasP.get(group);
  if (!p) {
    p = new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = assetUrl(`portraits/${group}.webp`);
    });
    atlasP.set(group, p);
  }
  return p;
}

/** 頭の前面に沿った皮の形（UV は切り出した顔の絵の全体） */
function faceGeometry(): THREE.BufferGeometry {
  const D = Math.PI / 180;
  const g = new THREE.SphereGeometry(1, 20, 16, Math.PI / 2 - PHI_HALF * D, PHI_HALF * 2 * D, THETA0 * D, (THETA1 - THETA0) * D);
  g.scale(HEAD_R.x * LIFT, HEAD_R.y * LIFT, HEAD_R.z * LIFT);
  g.translate(HEAD_C.x, HEAD_C.y, HEAD_C.z);
  return g;
}

/** 切り出した顔に、縁がぼけた楕円の形の透明度を付ける */
function faceCanvas(img: HTMLImageElement, sx: number, sy: number, cell: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = OUT;
  c.height = OUT;
  const g = c.getContext('2d')!;
  g.drawImage(img, sx + CROP.x0 * cell, sy + CROP.y0 * cell, (CROP.x1 - CROP.x0) * cell, (CROP.y1 - CROP.y0) * cell, 0, 0, OUT, OUT);
  g.globalCompositeOperation = 'destination-in';
  g.save();
  g.translate(OUT / 2, OUT * 0.46);
  g.scale(1, 1.05);
  const grad = g.createRadialGradient(0, 0, OUT * 0.36, 0, 0, OUT * 0.52);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(-OUT, -OUT, OUT * 2, OUT * 2);
  g.restore();
  return c;
}

/** 人形に顔の絵を貼る（読み込みを待たずに戻る。読めたら貼り、組み立ての顔を隠す） */
export function attachPortraitFace(rig: FigureRig, def: ClimberDef, onMaterial?: (m: THREE.MeshStandardMaterial) => void): void {
  void (async () => {
    const idx = await loadIndex();
    if (!idx) return;
    const chosen = parsePortrait(def.portrait);
    const group = chosen?.group ?? portraitGroup(def);
    const count = idx.counts[group] ?? 0;
    if (count <= 0) return;
    const i = chosen ? Math.min(chosen.index, count - 1) : portraitIndex(def.id, count);
    const img = await loadAtlas(group);
    if (!img) return;
    const cell = idx.cell;
    const tex = new THREE.CanvasTexture(faceCanvas(img, (i % idx.cols) * cell, Math.floor(i / idx.cols) * cell, cell));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    onMaterial?.(mat);
    const face = new THREE.Mesh(faceGeometry(), mat);
    face.castShadow = false;
    face.renderOrder = 2;
    face.name = 'portraitFace';
    rig.neck.add(face);
    // 組み立ての目・眉・頬・口は隠す（まばたきの動きは目に付いているが、見えないので害はない）
    rig.neck.traverse((o) => {
      if (o.userData['faceFeature']) o.visible = false;
    });
  })();
}

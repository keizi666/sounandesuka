/**
 * 地形データを公開していないシナリオ（実在の山）の記録のための、軌跡だけの地図。
 * 背景は無地に方眼。北が上、縮尺は軌跡に合わせる。
 */
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';

export interface TrackMarker {
  x: number;
  z: number;
  color: string;
}

export function drawTrackOnly(canvas: HTMLCanvasElement, track: [number, number][], colors: string[], markers: TrackMarker[]): void {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  g.fillStyle = '#1a1e24';
  g.fillRect(0, 0, W, H);
  if (track.length === 0) return;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of track) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const span = Math.max(200, x1 - x0, z1 - z0) * 1.15;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const k = Math.min(W, H) / span;
  const px = (x: number, z: number): [number, number] => [W / 2 + (x - cx) * k, H / 2 + (z - cz) * k];
  // 方眼（100 m か 500 m か 1 km）
  const step = span > 6000 ? 1000 : span > 1500 ? 500 : 100;
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let x = Math.floor((cx - span) / step) * step; x < cx + span; x += step) {
    const [a] = px(x, 0);
    g.beginPath();
    g.moveTo(a, 0);
    g.lineTo(a, H);
    g.stroke();
  }
  for (let z = Math.floor((cz - span) / step) * step; z < cz + span; z += step) {
    const [, b] = px(0, z);
    g.beginPath();
    g.moveTo(0, b);
    g.lineTo(W, b);
    g.stroke();
  }
  // 軌跡（縁取りしてから色）
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 7;
  g.beginPath();
  track.forEach(([x, z], i) => (i === 0 ? g.moveTo(...px(x, z)) : g.lineTo(...px(x, z))));
  g.stroke();
  g.lineWidth = 4;
  for (let i = 1; i < track.length; i += 1) {
    g.strokeStyle = colors[i] ?? '#2563eb';
    g.beginPath();
    g.moveTo(...px(track[i - 1]![0], track[i - 1]![1]));
    g.lineTo(...px(track[i]![0], track[i]![1]));
    g.stroke();
  }
  // 出発と終わり
  const dot = (x: number, z: number, fill: string, r: number): void => {
    const [a, b] = px(x, z);
    g.fillStyle = fill;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(a, b, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  dot(track[0]![0], track[0]![1], '#16a34a', 8);
  const last = track[track.length - 1]!;
  dot(last[0], last[1], '#ef4444', 8);
  for (const m of markers) {
    const [a, b] = px(m.x, m.z);
    g.fillStyle = m.color;
    g.strokeStyle = '#1a1e24';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a, b - 9);
    g.lineTo(a + 7, b);
    g.lineTo(a, b + 9);
    g.lineTo(a - 7, b);
    g.closePath();
    g.fill();
    g.stroke();
  }
  // 縮尺
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = `${Math.round(W / 40)}px system-ui, sans-serif`;
  g.fillText(fill(JA.community.gridLabel, { step: step >= 1000 ? `${step / 1000} km` : `${step} m` }), 16, H - 16);
}

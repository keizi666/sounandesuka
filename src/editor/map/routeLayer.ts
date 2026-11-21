/**
 * 計画ルートのレイヤー: 区間ごとにつなぐ道の形に沿って、白い縁取りの紫の太線と進む向きの矢印、順番の印（同じ地点は「1・9」）を描く。
 * 登山道（オレンジ・赤茶の線、下書きは破線）や沢（青）と見分けがつくように。
 */
import type { Ed } from '../context';
import type { MapLayer } from './TileMapView';

export function routeLayer(ed: Ed): MapLayer {
  return {
    id: 'route',
    visible: true,
    draw(g, v) {
      const r = ed.p.scenario.plan.route;
      if (r.length === 0) return;
      const m = ed.runtime();
      const node = (id: string | undefined): { x: number; z: number } | undefined => ed.p.map.nodes.find((x) => x.id === id);
      // 区間ごとに、つなぐ道の形に沿って描く（道がなければ直線）
      const pts: { px: number; py: number }[] = [];
      const mids: { a: { px: number; py: number }; b: { px: number; py: number } }[] = [];
      for (let i = 0; i < r.length; i += 1) {
        const b = node(r[i]);
        if (!b) continue;
        if (i === 0) {
          pts.push(v.xzToPx(b.x, b.z));
          continue;
        }
        const a = r[i - 1]!;
        const e = ed.p.map.edges.find((x) => (x.from === a && x.to === r[i]) || (x.from === r[i] && x.to === a));
        let leg: { x: number; z: number }[] = [b];
        if (e) {
          const samples = m?.trails[e.id]?.samples;
          const raw = [node(e.from), ...e.waypoints.map((w) => ({ x: w[0], z: w[1] })), node(e.to)].filter((q): q is { x: number; z: number } => Boolean(q));
          leg = samples ? samples.map((q) => ({ x: q.x, z: q.z })) : raw;
          if (e.from !== a) leg = [...leg].reverse();
        }
        const legPx = leg.map((q) => v.xzToPx(q.x, q.z));
        const k = Math.floor(legPx.length / 2);
        if (legPx.length >= 2) mids.push({ a: legPx[Math.max(0, k - 1)]!, b: legPx[k]! });
        pts.push(...legPx);
      }
      const line = (color: string, w: number): void => {
        g.strokeStyle = color;
        g.lineWidth = w;
        g.beginPath();
        pts.forEach((p, i) => (i === 0 ? g.moveTo(p.px, p.py) : g.lineTo(p.px, p.py)));
        g.stroke();
      };
      g.save();
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.setLineDash([]);
      // 登山道（オレンジ・赤茶）・沢（青）と見分けるため、白い縁取りの紫の太線
      line('rgba(255,255,255,0.95)', 9);
      line('#a21caf', 5);
      // 進む向きの矢印（区間の中ほど）
      g.fillStyle = '#ffffff';
      for (const { a, b } of mids) {
        const ang = Math.atan2(b.py - a.py, b.px - a.px);
        if (!Number.isFinite(ang) || Math.hypot(b.px - a.px, b.py - a.py) < 0.01) continue;
        g.save();
        g.translate((a.px + b.px) / 2, (a.py + b.py) / 2);
        g.rotate(ang);
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(-3, -3.5);
        g.lineTo(-3, 3.5);
        g.closePath();
        g.fill();
        g.restore();
      }
      // 順番の印（同じ地点を何度も通るときは「1・9」のようにまとめる）
      const byNode = new Map<string, number[]>();
      r.forEach((id, i) => byNode.set(id, [...(byNode.get(id) ?? []), i + 1]));
      g.font = 'bold 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [id, nums] of byNode) {
        const n = node(id);
        if (!n) continue;
        const p = v.xzToPx(n.x, n.z);
        const label = nums.join('・');
        const w = Math.max(22, g.measureText(label).width + 12);
        const cx = p.px;
        const cy = p.py + 20;
        g.fillStyle = '#a21caf';
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(cx - w / 2, cy - 11, w, 22, 11);
        g.fill();
        g.stroke();
        g.fillStyle = '#ffffff';
        g.fillText(label, cx, cy + 0.5);
      }
      g.restore();
    },
  };
}

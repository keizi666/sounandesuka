/**
 * 2D の地図の、地図記号の施設・送電線・鉄塔（エディター）。送電線は細い灰色の線、鉄塔は小さな四角、施設は地形図に近い字の記号。
 */
import type { Ed } from '../context';
import { LANDMARK_GLYPH } from '../geo/landmarks';
import type { MapLayer } from './TileMapView';

export function landmarkLayer(ed: Ed): MapLayer {
  return {
    id: 'landmarks',
    visible: true,
    draw(g, v) {
      const lines = ed.p.map.powerLines ?? [];
      const list = ed.p.map.landmarks ?? [];
      if (lines.length === 0 && list.length === 0) return;
      const sel = ed.p.editorState.selection;
      g.save();
      g.strokeStyle = 'rgba(60,60,70,0.75)';
      g.lineWidth = 1.5;
      g.setLineDash([10, 3, 2, 3]);
      for (const l of lines) {
        g.beginPath();
        l.pts.forEach(([x, z], i) => {
          const p = v.xzToPx(x, z);
          if (i === 0) g.moveTo(p.px, p.py);
          else g.lineTo(p.px, p.py);
        });
        g.stroke();
      }
      g.setLineDash([]);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const l of list) {
        const p = v.xzToPx(l.x, l.z);
        const selected = sel.kind === 'landmark' && sel.id === l.id;
        if (l.kind === 'tower') {
          g.fillStyle = selected ? '#ffcc00' : '#3c3c46';
          g.strokeStyle = '#fff';
          g.lineWidth = 1.5;
          g.beginPath();
          g.rect(p.px - 4, p.py - 4, 8, 8);
          g.fill();
          g.stroke();
          g.beginPath();
          g.moveTo(p.px - 4, p.py - 4);
          g.lineTo(p.px + 4, p.py + 4);
          g.moveTo(p.px + 4, p.py - 4);
          g.lineTo(p.px - 4, p.py + 4);
          g.strokeStyle = '#fff';
          g.lineWidth = 1;
          g.stroke();
          continue;
        }
        g.beginPath();
        g.arc(p.px, p.py, 10, 0, Math.PI * 2);
        g.fillStyle = selected ? '#ffcc00' : 'rgba(255,255,255,0.92)';
        g.fill();
        g.strokeStyle = '#7a2e1e';
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = '#7a2e1e';
        g.font = 'bold 12px system-ui, sans-serif';
        g.fillText(LANDMARK_GLYPH[l.kind], p.px, p.py + 0.5);
        if (l.name) {
          g.font = '11px system-ui, sans-serif';
          g.textAlign = 'left';
          g.strokeStyle = 'rgba(255,255,255,0.9)';
          g.lineWidth = 3;
          g.strokeText(l.name, p.px + 13, p.py);
          g.fillStyle = '#4a2a1e';
          g.fillText(l.name, p.px + 13, p.py);
          g.textAlign = 'center';
        }
      }
      g.restore();
    },
  };
}

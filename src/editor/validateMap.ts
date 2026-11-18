/**
 * エディター固有の検証（docs/16 §7、docs/18 §5）。シナリオの検証（sim/scenario/validate）に足して使う。
 */
import { standardLegMin } from './pace';
import type { Issue } from '../sim/scenario/validate';
import type { EditorProject, MapRuntime } from '../sim/types';
import { attributionFor } from './store/project';

export function validateEditor(p: EditorProject, m: MapRuntime | null): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, code: string, message: string): void => void out.push({ level: 'error', path, code, message });
  const warn = (path: string, code: string, message: string): void => void out.push({ level: 'warning', path, code, message });
  const map = p.map;
  const ids = new Set<string>();
  for (const n of map.nodes) {
    if (ids.has(n.id)) err(`map.nodes.${n.id}`, 'dupId', `ID ${n.id} が重複しています`);
    ids.add(n.id);
    if (Math.abs(n.x) > map.size / 2 || Math.abs(n.z) > map.size / 2) err(`map.nodes.${n.id}`, 'outside', `${n.name} がエリアの外にあります`);
  }
  const edgeIds = new Set<string>();
  for (const e of map.edges) {
    if (edgeIds.has(e.id) || ids.has(e.id)) err(`map.edges.${e.id}`, 'dupId', `ID ${e.id} が重複しています`);
    edgeIds.add(e.id);
    if (!ids.has(e.from) || (e.kind === 'trail' && (!e.to || !ids.has(e.to)))) err(`map.edges.${e.id}`, 'dangling', `道 ${e.name || e.id} の端がノードにつながっていません`);
  }
  const used = new Set(map.edges.flatMap((e) => [e.from, e.to ?? '']));
  for (const n of map.nodes) if (!used.has(n.id)) warn(`map.nodes.${n.id}`, 'isolated', `${n.name} はどの道にもつながっていません`);
  if (!map.nodes.some((n) => n.type === 'trailhead')) warn('map.nodes', 'noTrailhead', '下山口（登山口）のノードがありません');
  if (!map.nodes.some((n) => n.shelter)) warn('map.nodes', 'noHut', '小屋・避難小屋がエリアに 1 つもありません（ビバークしか選べません）');
  if (m) {
    for (const e of map.edges) {
      const t = m.trails[e.id];
      if (!t || e.kind !== 'trail') continue;
      let steep = 0;
      for (let i = 1; i < t.samples.length; i += 1) {
        const a = t.samples[i - 1]!;
        const b = t.samples[i]!;
        // 歩く距離 s（つづら折りの係数込み）に対する傾斜で見る
        const h = b.s - a.s;
        if (h > 0 && (Math.atan(Math.abs(b.elevM - a.elevM) / h) * 180) / Math.PI > 38) steep += h;
      }
      if (steep > 30) warn(`map.edges.${e.id}`, 'steep', `道 ${e.name || e.id} に傾斜 38° を超える区間が ${Math.round(steep)} m あります`);
      if (e.courseTimeMin && e.to) {
        const sim = standardLegMin(m, e.id, 1) / (e.paceAdj ?? 1);
        const dev = sim / e.courseTimeMin[0] - 1;
        if (Math.abs(dev) > 0.25) warn(`map.edges.${e.id}`, 'courseTime', `道 ${e.name || e.id} のコースタイム ${e.courseTimeMin[0]} 分に対し、試算 ${Math.round(sim)} 分（${dev > 0 ? '+' : ''}${Math.round(dev * 100)}%）`);
      }
    }
  }
  const drafts = p.editorState.draftEdgeIds.length;
  if (drafts > 0) out.push({ level: 'warning', path: 'editorState.draftEdgeIds', code: 'drafts', message: `取り込んだがまだ確定していない道が ${drafts} 本あります` });
  if (p.map.geo && p.map.terrain.type === 'heightmap' && !p.heightsBuffer && !p.map.terrain.data) err('map.terrain', 'noTerrain', 'まだ標高を取得していません（タブ 1）');
  if (p.map.geo && !attributionFor(p).some((a) => a.id === 'gsi')) warn('attribution', 'attribution', '地理院タイルの出典がありません');
  return out;
}

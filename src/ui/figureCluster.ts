/**
 * 人数の多いシナリオで、頭の上の顔アイコンをまとめる（ユーザーの指定: 5 人ずつ）。DOM を使わない純粋な関数。
 * 並び順（world.climbers の順 = 列の順）に見て、画面の上で直前にまとめた人から radiusPx 以内にいる、
 * 同じ列（グループ）・同じ生死の人を max 人までつないでひとつにする（縦に長い列も 5 人ずつになる）。1 人だけのまとまりは作らない。
 */
export interface ClusterInput {
  id: string;
  /** 列（グループ）。null は一人で動いている人で、まとめない */
  groupId: string | null;
  alive: boolean;
}

export function clusterHeads(people: readonly ClusterInput[], pos: ReadonlyMap<string, { x: number; y: number }>, max: number, radiusPx: number): string[][] {
  const out: string[][] = [];
  const used = new Set<string>();
  const r2 = radiusPx * radiusPx;
  for (let i = 0; i < people.length; i++) {
    const a = people[i]!;
    const pa = pos.get(a.id);
    if (!pa || used.has(a.id) || a.groupId === null) continue;
    const ids = [a.id];
    let last = pa;
    for (let j = i + 1; j < people.length && ids.length < max; j++) {
      const b = people[j]!;
      const pb = pos.get(b.id);
      if (!pb || used.has(b.id) || b.groupId !== a.groupId || b.alive !== a.alive) continue;
      if ((pb.x - last.x) * (pb.x - last.x) + (pb.y - last.y) * (pb.y - last.y) <= r2) {
        ids.push(b.id);
        last = pb;
      }
    }
    if (ids.length < 2) continue;
    for (const id of ids) used.add(id);
    out.push(ids);
  }
  return out;
}

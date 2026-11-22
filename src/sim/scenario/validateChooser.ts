// 分岐点の「選ぶ人」の検査: 選択肢の行動がすべて 1 人に向いているのに group がない分岐点を警告する。
// group のない分岐点は、人のいる最初のグループのリーダーが選ぶ（パーティーが分かれたあとは分かれた先の最初のグループ）。
// そのため、父が一人でスマホを探す分岐が「母: スマホがない」と出てしまうことがある（s06 で起きた）。
import type { Action, ChoicePointDef, ClimberId, GroupDef, ScenarioDef } from '../types';

export interface ChooserIssue {
  path: string;
  message: string;
}

/** 誰にも向かない（全体に効く・画面だけの）行動。これらは「誰に向いているか」の判定に数えない */
const NEUTRAL = new Set<Action['type']>(['setFlag', 'clearFlag', 'narrate', 'sound', 'music', 'focus', 'reportMissing']);

/** グループを作る定義（s.groups と、splitParty ごとの groups の並び） */
function groupLists(s: ScenarioDef): GroupDef[][] {
  const out: GroupDef[][] = s.groups?.length ? [s.groups] : [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (x === null || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (o['type'] === 'splitParty' && Array.isArray(o['groups'])) out.push(o['groups'] as GroupDef[]);
    for (const v of Object.values(o)) walk(v);
  };
  walk(s.choices);
  walk(s.events);
  walk(s.genericOverrides);
  return out;
}

/** 選択肢の行動がすべて同じ登山者に向いていれば、その ID。グループ全体に効く行動が 1 つでもあれば null */
function soleTarget(cp: ChoicePointDef, climbers: ReadonlySet<string>): ClimberId | null {
  let only: ClimberId | null = null;
  for (const o of cp.options) {
    for (const a of o.actions) {
      if (NEUTRAL.has(a.type)) continue;
      const who = (a as { who?: unknown }).who;
      if (typeof who !== 'string' || !climbers.has(who)) return null;
      if (only !== null && only !== who) return null;
      only = who;
    }
  }
  return only;
}

export function checkChoosers(s: ScenarioDef): ChooserIssue[] {
  const climbers = new Set(s.party.map((p) => p.id));
  const lists = groupLists(s);
  const defaultLeader = s.party.find((p) => p.leader)?.id ?? s.party[0]?.id;
  // group のない分岐点を選びうる人: 最初のグループのリーダー（分かれる前と、分かれるたびの最初のグループ）
  const choosers = new Set<string>(lists.length > 0 ? lists.map((l) => l[0]?.leader ?? '') : [defaultLeader ?? '']);
  // 分かれる前のグループ（s.groups）は、分かれた後のグループがあればすすめない
  const all = (lists.length > 1 && s.groups?.length ? lists.slice(1) : lists).flat();
  const name = (id: string): string => s.party.find((p) => p.id === id)?.name ?? id;
  const out: ChooserIssue[] = [];
  s.choices.forEach((cp, i) => {
    if (cp.group !== undefined) return;
    const who = soleTarget(cp, climbers);
    if (who === null) return;
    const others = [...choosers].filter((c) => c !== who && c !== '');
    if (others.length === 0) return;
    const led = [...new Set(all.filter((g) => g.leader === who).map((g) => g.id))];
    const hint = led.length > 0 ? `group に "${led.join('" か "')}" を指定してください` : `${name(who)} がリーダーのグループを作り、group に指定してください`;
    out.push({
      path: `choices[${i}].group`,
      message: `分岐点 "${cp.id}" の行動はすべて ${name(who)}（${who}）に向いていますが group がないので、選ぶ人が ${others.map(name).join('・')} として出ることがあります。${hint}`,
    });
  });
  return out;
}

/**
 * 教訓（docs/09 §10、FR-33）: 条件に合う教訓を選び、プレースホルダを展開する。
 */
import { partyLeader } from '../climber/party';
import { evalCondition } from '../scenario/conditions';
import { expandText, type TextLabels } from '../scenario/text';
import { resolveVar, type VarValue } from '../scenario/vars';
import type { StaticContext, World } from '../types';

export interface LessonText {
  id: string;
  title: string;
  text: string;
}

export function selectLessons(world: World, ctx: StaticContext, rec: Record<string, VarValue | null>, labels: TextLabels = {}): LessonText[] {
  const scope = { world, map: ctx.map, scenario: ctx.scenario, leader: partyLeader(world), rec };
  // 教訓の評価で乱数（chance）を引いても結果に影響しないよう、World の写しで評価する
  const w2 = JSON.parse(JSON.stringify(world)) as World;
  const scope2 = { ...scope, world: w2, leader: w2.climbers.find((c) => c.id === scope.leader.id)! };
  return ctx.scenario.lessons
    .filter((l, i) => l.when === undefined || evalCondition(l.when, scope2, `lessons[${i}].when`))
    .map((l) => ({ id: l.id, title: l.title, text: expandText(l.text, (p) => resolveVar(p, scope), labels) }));
}

/**
 * スクリプトイベントの効果「動物が出る」「動物が立ち去る」の入力欄（タブ 8 結末）。
 * 種類・ふるまい・頭数・場所（地点か座標、そこからの前後左右のずれ）・出ている時間・不安・自動のログ。
 */
import { ANIMAL_SPECIES } from '../../sim/hazards/animals';
import { TUNING } from '../../sim/tuning';
import type { AnimalBehavior, AnimalEffect, AnimalSpecies, MapDef } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { el } from '../../ui/dom';
import { check, num, select, text } from './fields';

const BEHAVIORS: AnimalBehavior[] = ['graze', 'watch', 'wander', 'cross', 'flee', 'stalk'];

export function speciesOptions(): [AnimalSpecies, string][] {
  return ANIMAL_SPECIES.map((s) => [s, JA.log.animal[s] ?? s]);
}

type Place = 'leader' | 'node' | 'xz';

/** 効果 animal の入力欄。set は差分（undefined はその欄を消す） */
export function animalEffectEditor(e: AnimalEffect, map: MapDef, set: (patch: Partial<AnimalEffect>) => void): HTMLElement {
  const st = TUNING.animals.species[e.species];
  const place: Place = e.at !== undefined ? 'node' : e.x !== undefined ? 'xz' : 'leader';
  const nodes = map.nodes.map((n) => [n.id, `${n.name || '（名前なし）'}（${n.id}）`] as [string, string]);
  const behaviorOpts: [string, string][] = [['', `種類の既定（${JA.log.animalBehavior[st?.behavior ?? ''] ?? ''}）`], ...BEHAVIORS.map((b) => [b, JA.log.animalBehavior[b] ?? b] as [string, string])];
  const rows: (HTMLElement | null)[] = [
    select('種類', e.species, speciesOptions(), (v) => set({ species: v })),
    select('ふるまい', e.behavior ?? '', behaviorOpts, (v) => set({ behavior: v === '' ? undefined : (v as AnimalBehavior) })),
    num('頭数', e.count ?? 1, (v) => set({ count: Math.round(v) }), { min: 1, max: TUNING.animals.maxCount, step: 1 }),
    select<Place>('場所', place, [['leader', 'リーダーの位置から'], ['node', '地点から'], ['xz', '座標（m）から']], (v) => {
      if (v === 'node') set({ at: map.nodes[0]?.id ?? '', x: undefined, z: undefined });
      else if (v === 'xz') set({ at: undefined, x: 0, z: 0 });
      else set({ at: undefined, x: undefined, z: undefined });
    }),
    place === 'node' ? select('地点', e.at ?? '', nodes, (v) => set({ at: v })) : null,
    place === 'xz' ? el('div', { class: 'cond-row' }, [num('x（東）', e.x ?? 0, (v) => set({ x: v }), { unit: 'm' }), num('z（南）', e.z ?? 0, (v) => set({ z: v }), { unit: 'm' })]) : null,
    el('div', { class: 'cond-row' }, [
      num('前へ', e.aheadM ?? 0, (v) => set({ aheadM: v === 0 ? undefined : v }), { unit: 'm', hint: 'リーダーの進む向きに（負で後ろ）' }),
      num('右へ', e.sideM ?? 0, (v) => set({ sideM: v === 0 ? undefined : v }), { unit: 'm', hint: '進む向きの右へ（負で左）' }),
    ]),
    num('出ている時間', e.durationMin ?? st?.durationMin ?? 10, (v) => set({ durationMin: v }), { min: 0, unit: '分', hint: '人が近づくと、これより早く立ち去る' }),
    num('見つけたときの不安', e.anxiety ?? st?.anxiety ?? 0, (v) => set({ anxiety: v }), { min: -30, max: 50, hint: 'そのグループの全員の不安（0〜100）に足す。0 で増えない' }),
    st && st.attackApproachP > 0
      ? num('襲ってくる確率の倍率', e.aggression ?? 1, (v) => set({ aggression: v === 1 ? undefined : v }), { min: 0, max: 10, step: 0.1, hint: `0 で襲わない。既定（1）では、気づいて近づくと ${Math.round(st.attackApproachP * 100)}%、鉢合わせで ${Math.round(st.attackSurpriseP * 100)}%（止まっている人・人数の多いグループでは下がる）` })
      : null,
    check('自動のログを出さない（ログの効果で書く）', e.quiet ?? false, (v) => set({ quiet: v || undefined })),
    text('ID（省略可。立ち去らせるときに使う）', e.id, (v) => set({ id: v === '' ? undefined : v })),
    el('p', { class: 'note' }, `分岐点の条件では animal.${e.species}（リーダーから最も近い${JA.log.animal[e.species] ?? ''}までの m。いなければ 99999）が使えます。人が ${st?.fleeM ?? '?'} m まで近づくと立ち去ります${st && st.attackApproachP > 0 ? '（低い確率で向かってきて、けがをさせてから立ち去ります。そのときフラグ bearAttack が立ちます）' : ''}。`),
  ];
  return el('div', {}, rows.filter((x): x is HTMLElement => x !== null));
}

/** 効果 animalLeave の入力欄 */
export function animalLeaveEditor(e: { id?: string; species?: AnimalSpecies }, set: (patch: { id?: string; species?: AnimalSpecies }) => void): HTMLElement {
  return el('div', {}, [
    select<string>('種類', e.species ?? '', [['', 'すべて'], ...speciesOptions()], (v) => set({ species: v === '' ? undefined : (v as AnimalSpecies) })),
    text('ID（省略可）', e.id, (v) => set({ id: v === '' ? undefined : v })),
  ]);
}

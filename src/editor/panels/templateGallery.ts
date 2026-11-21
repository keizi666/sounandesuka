/**
 * テンプレートの一覧（物語のタブの「＋ テンプレートから足す」）: 種類ごとのカードから選んで足す。
 * 地点で起きるテンプレートは、上の「どこで」で選んだ地点に置く。
 */
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { nodeSelect } from '../forms/whenPicker';
import { applyStory, CAT_LABELS, tplCtx, type StoryCat, type StorySel, type StoryTemplate } from '../templates/story';
import { STORY_TEMPLATES } from '../templates/storyParts2';

/** テンプレートを足して、足した最初の項目を返す（Undo の 1 単位） */
export function addStoryTemplate(ed: Ed, t: StoryTemplate, node?: string): StorySel | null {
  let sel: StorySel | null = null;
  ed.change(`テンプレート: ${t.name}`, () => (sel = applyStory(ed.p.scenario, t.make(tplCtx(ed.p, node)))));
  ed.toast(`「${t.name}」を足しました（Ctrl＋Z で戻せます）`, 3500);
  return sel;
}

export function openTemplateGallery(ed: Ed, o: { cat?: StoryCat; node?: string }, added: (sel: StorySel | null) => void): void {
  const dlg = el('dialog', { class: 'ed-dialog wide tg-dialog' });
  let cat: StoryCat = o.cat ?? 'kit';
  let node = o.node ?? tplCtx(ed.p).node;
  const cats = (Object.keys(CAT_LABELS) as StoryCat[]).filter((c) => !o.node || STORY_TEMPLATES.some((t) => t.cat === c && t.atNode));
  if (!cats.includes(cat)) cat = cats[0]!;
  const render = (): void => {
    const list = STORY_TEMPLATES.filter((t) => t.cat === cat && (!o.node || t.atNode));
    const where = list.some((t) => t.atNode)
      ? el('div', { class: 'cond-row tg-where' }, ['どこで起こす:', nodeSelect({ scenario: ed.p.scenario, map: ed.p.map }, node, (id) => (node = id)), el('small', { class: 'note' }, '（📍 の付いたものは、この地点に置きます。あとで変えられます）')])
      : null;
    dlg.replaceChildren(
      ...[
        el('h2', {}, o.node ? `「${ed.p.map.nodes.find((n) => n.id === o.node)?.name || o.node}」で起こすこと` : 'テンプレートから足す'),
        el('div', { class: 'tg-cats' }, cats.map((c) => el('button', { class: c === cat ? 'on' : '', onclick: () => ((cat = c), render()) }, CAT_LABELS[c][0]))),
        el('p', { class: 'note' }, CAT_LABELS[cat][1]),
        where,
        el('div', { class: 'tg-grid' }, list.map((t) =>
          el('button', {
            class: 'tg-card',
            onclick: () => {
              const sel = addStoryTemplate(ed, t, t.atNode || t.cat === 'kit' ? node : undefined);
              dlg.close();
              added(sel);
            },
          }, [el('span', { class: 'tg-icon' }, t.icon), el('strong', {}, `${t.atNode ? '📍 ' : ''}${t.name}`), el('small', {}, t.desc)]),
        )),
        el('div', { class: 'actions' }, [el('button', { onclick: () => dlg.close() }, '閉じる')]),
      ].filter((x) => x !== null),
    );
  };
  render();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

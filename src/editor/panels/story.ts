/**
 * タブ 6 物語（docs/18 §3・§4）: 分かれ道・できごと・会話・結末・教訓を 1 つの画面で作る。
 * 中央にカードのボード（storyBoard.ts）、右にやさしい言葉の編集欄（storyInspector.ts）、「＋」でテンプレートの一覧（templateGallery.ts）。
 * もとの「分岐点」「結末」の 2 つのタブをまとめた（ユーザーの指摘: エディターが複雑すぎる。直感的にイベント・分岐・結果を操作したい）。
 */
import type { EndingKind } from '../../sim/types';
import { JA } from '../../i18n/ja';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { fill } from '../forms/fields';
import { nextId } from '../store/project';
import type { StorySel } from '../templates/story';
import { STORY_TEMPLATES } from '../templates/storyParts2';
import { storyBoard, type BoardApi } from './storyBoard';
import { storyInspector } from './storyInspector';
import { addStoryTemplate, openTemplateGallery } from './templateGallery';
import type { Panel } from './types';

let sel: StorySel | null = null;
/** ボードを隠して地図を見ている */
let mapShown = false;

/** 空の部品を足す（テンプレートを使わない） */
function addBlank(ed: Ed, kind: StorySel['kind'], endingKind?: EndingKind): void {
  const s = ed.p.scenario;
  ed.change('物語の部品の追加', () => {
    if (kind === 'ending') sel = { kind, idx: s.endings.push({ kind: endingKind ?? 'SAFE_RETURN', title: JA.endings[endingKind ?? 'SAFE_RETURN']?.title ?? '', text: '' }) - 1 };
    else if (kind === 'lesson') sel = { kind, idx: s.lessons.push({ id: nextId(s.lessons.map((l) => l.id), 'l'), title: '', text: '' }) - 1 };
  });
}

export const storyPanel: Panel = {
  id: 'story',
  label: '物語',
  render(ed) {
    // 検証の「場所を開く」などで分岐点が選ばれていたら、そのカードを選ぶ
    const es = ed.p.editorState.selection;
    if (es.kind === 'choice') {
      const idx = ed.p.scenario.choices.findIndex((c) => c.id === es.id);
      if (idx >= 0) sel = { kind: 'choice', idx };
      ed.p.editorState.selection = { kind: null, id: null };
    }
    const done = (s: StorySel | null): void => {
      sel = s;
    };
    const openGallery = (cat?: Parameters<BoardApi['add']>[0], node?: string): void =>
      openTemplateGallery(ed, { cat, node }, (s) => {
        if (s) sel = s;
        ed.refresh();
      });
    const api: BoardApi = {
      sel,
      select(s) {
        sel = s;
        ed.refresh();
      },
      add: openGallery,
      addTemplate(id) {
        const t = STORY_TEMPLATES.find((x) => x.id === id);
        if (!t) return;
        sel = addStoryTemplate(ed, t) ?? sel;
        ed.refresh();
      },
      blank: (kind, k) => addBlank(ed, kind, k),
      done,
      close() {
        sel = null;
        ed.refresh();
      },
      showMap() {
        mapShown = true;
        ed.refresh();
      },
    };
    ed.setStage(mapShown ? null : storyBoard(ed, api));
    fill(
      ed.inspector,
      mapShown
        ? el('button', {
            class: 'primary',
            onclick: () => {
              mapShown = false;
              ed.refresh();
            },
          }, '← 物語のボードに戻る')
        : null,
      ...storyInspector(ed, sel, done, () => openGallery()),
    );
    ed.bottom.replaceChildren();
  },
};

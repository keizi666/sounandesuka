/**
 * AI タブ: 遭難の大まかなストーリーから、AI に詳しいシナリオを設計・作成・検証させるためのプロンプトを作る（src/editor/aiPrompt.ts）。
 * 入力はブラウザに覚える（プロジェクトごと）。作ったプロンプトはコピー・ファイルに保存できる。
 */
import { el } from '../../ui/dom';
import { buildAiPrompt, type AiPromptInput } from '../aiPrompt';
import type { Ed } from '../context';
import { button, fill } from '../forms/fields';
import type { Panel } from './types';

const KEY = (id: string): string => `hks.ed.ai.${id}`;

function loadInput(ed: Ed): AiPromptInput {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(ed.p.id)) ?? 'null') as AiPromptInput | null;
    if (v && typeof v.story === 'string') return v;
  } catch {
    // 読めなければ新しく
  }
  return { story: '', mode: 'agent', real: !!ed.p.map.geo };
}
function saveInput(ed: Ed, v: AiPromptInput): void {
  try {
    localStorage.setItem(KEY(ed.p.id), JSON.stringify(v));
  } catch {
    // 保存できなくても続ける
  }
}

export const aiPanel: Panel = {
  id: 'ai',
  label: 'AI プロンプト',
  render(ed) {
    const v = loadInput(ed);
    const out = el('textarea', { class: 'mono', spellcheck: 'false', readonly: true, style: 'min-height:40vh' }) as HTMLTextAreaElement;
    const update = (): void => {
      saveInput(ed, v);
      out.value = buildAiPrompt(ed.p, v);
    };
    const area = (label: string, key: 'story' | 'source' | 'area' | 'season' | 'people' | 'extra', rows: number, ph: string): HTMLElement => {
      const ta = el('textarea', { rows, placeholder: ph }) as HTMLTextAreaElement;
      ta.value = v[key] ?? '';
      ta.addEventListener('input', () => {
        v[key] = ta.value;
        update();
      });
      return el('label', { class: 'f-col' }, [el('span', { class: 'f-label' }, label), ta]);
    };
    const mode = el('select', {}, [el('option', { value: 'agent' }, 'このリポジトリで作業する AI エージェント（ファイルを作り、検証まで）'), el('option', { value: 'chat' }, '会話の AI（シナリオの JSON を返してもらい、JSON タブに貼る）')]) as HTMLSelectElement;
    mode.value = v.mode;
    mode.addEventListener('change', () => {
      v.mode = mode.value as AiPromptInput['mode'];
      update();
    });
    const real = el('input', { type: 'checkbox', checked: v.real }) as HTMLInputElement;
    real.addEventListener('change', () => {
      v.real = real.checked;
      update();
    });
    fill(
      ed.inspector,
      el('h2', {}, 'AI プロンプト'),
      el('p', { class: 'note' }, '遭難の大まかなストーリーを書くと、AI に「詳しいシナリオの設計 → 作成 → 検証（人間らしさを含む）」をさせるプロンプトを作ります。使える仕組みの一覧と、いま開いているマップの地点・道を自動で入れます。'),
      area('大まかなストーリー（必須）', 'story', 7, '例: 5月中旬の晴れた土曜日、40代の夫婦と小学生 2 人が石老山へ。展望台で妻と子が先に下り、夫はタバコを吸ってから一人で追いかけたが、下りてこない……'),
      area('原案・出典（タイトル・作者・日付・URL）', 'source', 2, '例: 松本圭司「架空遭難 …」note（2024年2月26日） https://…'),
      area('山域・地名', 'area', 2, '例: 相模湖の南の石老山。石老山入口〜顕鏡寺〜山頂〜大明神展望台'),
      area('時期・天気', 'season', 2, '例: 5月中旬、晴れ。夜は 10℃ 前後'),
      area('登場人物', 'people', 2, '例: 父 44・母 42・小6・小5。ハイキングのつもりで、ヘッドランプなし'),
      area('そのほかの希望', 'extra', 2, '例: 家族の側の判断（バス停で待つ・駅へ行く・交番）も選べるように'),
      el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '渡す先'), mode]),
      el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, '実在の地形で作る'), real]),
      el('div', {}, [
        button('コピー', async () => {
          try {
            await navigator.clipboard.writeText(out.value);
            ed.toast('プロンプトをコピーしました', 2500);
          } catch {
            out.select();
            ed.toast('選択しました。Ctrl+C でコピーしてください', 4000);
          }
        }, 'primary'),
        button('ファイルに保存（.md）', () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/markdown' }));
          a.download = `prompt-${ed.p.scenario.id || 'scenario'}.md`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }),
      ]),
    );
    ed.bottom.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:4px' }, [el('strong', {}, '作ったプロンプト（AI にそのまま渡す）'), out]));
    update();
  },
};

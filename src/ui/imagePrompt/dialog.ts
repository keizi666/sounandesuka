/**
 * 画像生成 AI 用のプロンプトの窓（ユーザーの指定: ログの黄色い行の「＞」から開く）。
 * 画風（イラスト・写真・水彩・油彩・水墨・鉛筆・絵本・木版画・アニメ調・ジオラマ）、言葉（日本語・英語）、縦横を選び、
 * プロンプトとネガティブプロンプトをコピーする。外部には何も送らない（貼り付けるのは使う人）。選んだ画風などは端末に覚える。
 */
import { PROMPT_STYLES, PROMPT_UI, type PromptLang } from '../../i18n/imagePrompt';
import { JA } from '../../i18n/ja';
import { formatDateTime } from '../../i18n/format';
import type { ScenarioDef } from '../../sim/types';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { buildPrompt, type Aspect } from './prompt';
import type { SceneSnap } from './scene';

const PREF_KEY = 'hks.v1.imagePrompt';
/** 使う人の Meta AI（画像生成の Muse）のページ。?q= にチャットへ送る文を入れて開く */
const MUSE_URL = 'https://www.meta.ai/';

interface Pref {
  style: string;
  lang: PromptLang;
  aspect: Aspect;
}

function loadPref(): Pref {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as Partial<Pref> | null;
    return { style: p?.style ?? 'illust', lang: p?.lang === 'en' ? 'en' : 'ja', aspect: p?.aspect === 'square' || p?.aspect === 'tall' ? p.aspect : 'wide' };
  } catch {
    return { style: 'illust', lang: 'ja', aspect: 'wide' };
  }
}

function savePref(p: Pref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // 覚えられなくても使える
  }
}

/** 選択肢のボタンの列（1 つだけ選ぶ） */
function chips<T extends string>(items: { id: T; label: string }[], cur: T, onPick: (id: T) => void): HTMLElement {
  const row = el('div', { class: 'ip-chips', role: 'radiogroup' });
  const paint = (sel: T): void => {
    for (const b of Array.from(row.children) as HTMLButtonElement[]) {
      const on = b.dataset['id'] === sel;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  for (const it of items) {
    row.append(el('button', { type: 'button', class: 'ip-chip', role: 'radio', 'data-id': it.id, onclick: () => (paint(it.id), onPick(it.id)) }, it.label));
  }
  paint(cur);
  return row;
}

async function copyText(text: string, area: HTMLTextAreaElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(PROMPT_UI.copied, 2500);
  } catch {
    area.focus();
    area.select();
    toast(JA.ui.shareCopyManual, 4000);
  }
}

export function openImagePrompt(scene: SceneSnap, scenario: ScenarioDef, hooks: { onOpen?: () => void; onClose?: () => void } = {}): void {
  const U = PROMPT_UI;
  const pref = loadPref();
  const prompt = el('textarea', { class: 'ip-text', readonly: true, rows: 9, 'aria-label': U.prompt }) as HTMLTextAreaElement;
  const negative = el('textarea', { class: 'ip-text ip-neg', readonly: true, rows: 2, 'aria-label': U.negative }) as HTMLTextAreaElement;
  const render = (): void => {
    const r = buildPrompt(scene, pref.style, pref.lang, pref.aspect);
    prompt.value = r.prompt;
    negative.value = r.negative;
    savePref(pref);
  };
  const copy = el('button', { class: 'primary', type: 'button', onclick: () => void copyText(prompt.value, prompt) }, [icon('contentCopy'), U.copy]);
  const copyNeg = el('button', { type: 'button', class: 'small', onclick: () => void copyText(negative.value, negative) }, [icon('contentCopy'), U.copy]);
  // 使う人の Meta AI（Muse）で作る: チャットに送る文（頼む一文・プロンプト・入れないもの）をコピーし、?q= に入れて開く。
  // ページを開くのは押したときの同じ処理の中で（ポップアップとして止められないように）。サーバーは使わない
  const chatText = (): string => {
    const ja = pref.lang === 'ja';
    return `${ja ? U.askJa : U.askEn}
${prompt.value}
${ja ? U.avoidJa : U.avoidEn}: ${negative.value}`;
  };
  const muse = el('button', { class: 'primary', type: 'button', onclick: () => {
    const text = chatText();
    // コピーを先に始める（ページを開くと、押した操作の扱いが使い切られ、コピーできないブラウザがある）
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    window.open(`${MUSE_URL}?q=${encodeURIComponent(text)}`, '_blank', 'noopener');
    toast(U.museOpened, 6000);
  } }, [icon('photoCamera'), U.muse]);
  // スマホなど、共有のしくみがある端末では、共有の一覧から Meta AI のアプリなどに送れる
  const share = typeof navigator.share === 'function'
    ? el('button', { type: 'button', onclick: () => void navigator.share({ text: chatText() }).catch(() => undefined) }, [icon('share'), U.share])
    : null;
  const time = formatDateTime(scenario, scene.tMin);
  const dlg = el('dialog', { class: 'cap-dlg ip-dlg', 'aria-label': U.title }, [
    el('header', { class: 'cap-head' }, [
      el('h2', {}, [icon('photoCamera'), U.title]),
      el('button', { class: 'icon', type: 'button', title: `${JA.ui.close} (Esc)`, 'aria-label': JA.ui.close, onclick: () => dlg.close() }, icon('close')),
    ]),
    el('p', { class: 'ip-scene' }, [el('time', {}, time), scene.text]),
    el('p', { class: 'ip-lead' }, U.lead),
    el('div', { class: 'ip-row' }, [el('span', { class: 'ip-k' }, U.style), chips(PROMPT_STYLES.map((s) => ({ id: s.id, label: s.label })), pref.style, (id) => ((pref.style = id), render()))]),
    el('div', { class: 'ip-row' }, [
      el('span', { class: 'ip-k' }, U.lang),
      chips<PromptLang>([{ id: 'ja', label: U.langJa }, { id: 'en', label: U.langEn }], pref.lang, (id) => ((pref.lang = id), render())),
      el('span', { class: 'ip-k' }, U.aspect),
      chips<Aspect>([{ id: 'wide', label: U.aspectWide }, { id: 'square', label: U.aspectSquare }, { id: 'tall', label: U.aspectTall }], pref.aspect, (id) => ((pref.aspect = id), render())),
    ]),
    el('h3', { class: 'cap-sub' }, U.prompt),
    prompt,
    el('div', { class: 'cap-actions' }, [copy, muse, share]),
    el('h3', { class: 'cap-sub' }, U.negative),
    negative,
    el('div', { class: 'cap-actions' }, [copyNeg]),
    el('p', { class: 'ip-note' }, U.museNote),
    el('p', { class: 'ip-note' }, U.note),
  ]);
  render();
  dlg.addEventListener('close', () => {
    dlg.remove();
    hooks.onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  hooks.onOpen?.();
}

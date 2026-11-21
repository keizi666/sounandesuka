/**
 * トップ画面の「AI 向けプロンプト作成」のダイアログ。入力（タイトル・参考文献の URL・登場人物の条件・ストーリー・舞台）から
 * aiStandalone.ts でプロンプトを作り、コピー・ファイル保存（.md）できるようにする。入力はブラウザに覚える。
 * 付録（形式の説明と型）を含むので、このモジュールはボタンを押したときに読み込む（projects.ts から動的 import）。
 */
import { assetUrl } from '../app/data';
import { JA } from '../i18n/ja';
import type { MapDef } from '../sim/types';
import { el } from '../ui/dom';
import { buildStandalonePrompt, type StandaloneContext, type StandaloneInput, type StandaloneStage } from './aiStandalone';
import { getProject, listProjects } from './store/idb';

const T = JA.editor.aiTool;
const KEY = 'hks.ed.aiTool';

interface Saved extends StandaloneInput {
  projectId?: string;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (v && typeof v.story === 'string' && Array.isArray(v.urls)) return v;
  } catch {
    // 読めなければ新しく
  }
  return { title: '', urls: [''], people: '', story: '', stage: 'real' };
}
function save(v: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // 保存できなくても続ける
  }
}

/** ファイル名に使える形（記号を _ に） */
function fileSlug(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'scenario';
}

async function contextFor(v: Saved): Promise<StandaloneContext> {
  if (v.stage === 'fictional') {
    const r = await fetch(assetUrl('maps/sounan.json'));
    return { map: (await r.json()) as MapDef };
  }
  if (v.stage === 'project' && v.projectId) {
    const p = await getProject(v.projectId);
    if (p) return { map: p.map, scenario: p.scenario };
  }
  return {};
}

export async function showAiToolDialog(): Promise<void> {
  const v = load();
  const projects = await listProjects();

  const title = el('input', { value: v.title, placeholder: T.titlePh }) as HTMLInputElement;
  title.addEventListener('input', () => ((v.title = title.value), save(v)));

  // 参考文献の URL（行を足せる）
  const urlBox = el('div', { class: 'ai-urls' });
  const renderUrls = (): void => {
    if (v.urls.length === 0) v.urls.push('');
    urlBox.replaceChildren(
      ...v.urls.map((u, idx) => {
        const inp = el('input', { type: 'url', value: u, placeholder: T.urlPh, 'aria-label': `${T.urls} ${idx + 1}` }) as HTMLInputElement;
        inp.addEventListener('input', () => ((v.urls[idx] = inp.value), save(v)));
        const rm = el('button', { type: 'button', title: T.removeUrl, 'aria-label': T.removeUrl, onclick: () => (v.urls.splice(idx, 1), save(v), renderUrls()) }, '✕');
        return el('div', { class: 'ai-url-row' }, [inp, rm]);
      }),
      el('button', { type: 'button', onclick: () => (v.urls.push(''), save(v), renderUrls(), (urlBox.querySelectorAll('input')[v.urls.length - 1] as HTMLInputElement | undefined)?.focus()) }, `＋ ${T.addUrl}`),
    );
  };
  renderUrls();

  const people = el('textarea', { rows: 2, placeholder: T.peoplePh }) as HTMLTextAreaElement;
  people.value = v.people;
  people.addEventListener('input', () => ((v.people = people.value), save(v)));
  const story = el('textarea', { rows: 7, placeholder: T.storyPh }) as HTMLTextAreaElement;
  story.value = v.story;
  story.addEventListener('input', () => ((v.story = story.value), save(v)));

  const stage = el('select', {}, [
    el('option', { value: 'real' }, T.stageReal),
    el('option', { value: 'fictional' }, T.stageFictional),
    el('option', { value: 'project', disabled: projects.length === 0 }, T.stageProject),
  ]) as HTMLSelectElement;
  if (v.stage === 'project' && projects.length === 0) v.stage = 'real';
  stage.value = v.stage;
  const project = el('select', {}, projects.length ? projects.map((x) => el('option', { value: x.id }, x.name)) : [el('option', { value: '' }, T.noProject)]) as HTMLSelectElement;
  if (v.projectId && projects.some((x) => x.id === v.projectId)) project.value = v.projectId;
  v.projectId = project.value || undefined;
  const projectRow = el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, T.project), project]);
  const syncStage = (): void => void (projectRow.style.display = v.stage === 'project' ? '' : 'none');
  stage.addEventListener('change', () => ((v.stage = stage.value as StandaloneStage), save(v), syncStage()));
  project.addEventListener('change', () => ((v.projectId = project.value), save(v)));
  syncStage();

  const out = el('textarea', { class: 'mono ai-out', spellcheck: 'false', readonly: true, 'aria-label': T.result }) as HTMLTextAreaElement;
  const count = el('span', { class: 'note' });
  // 知らせはダイアログの中に出す（モーダルのダイアログの下にトーストが隠れるため）
  const buildStatus = el('span', { class: 'note', role: 'status' });
  const outStatus = el('span', { class: 'note', role: 'status' });
  const copyBtn = el('button', { disabled: true, onclick: async () => {
    try {
      await navigator.clipboard.writeText(out.value);
      outStatus.textContent = T.copied;
    } catch {
      // クリップボードの API が使えないとき: 選択して、古い方法でコピーを試す
      out.focus();
      out.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      outStatus.textContent = ok ? T.copied : T.selectToCopy;
    }
  } }, T.copy) as HTMLButtonElement;
  const saveBtn = el('button', { disabled: true, onclick: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/markdown' }));
    a.download = `prompt-${fileSlug(v.title)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    outStatus.textContent = T.saved(a.download);
  } }, T.save) as HTMLButtonElement;
  const resultBox = el('div', { class: 'ai-result', style: 'display:none' }, [el('div', { class: 'ai-result-head' }, [el('strong', {}, T.result), count]), out, el('div', { class: 'actions' }, [copyBtn, saveBtn, outStatus])]);

  const build = async (): Promise<void> => {
    buildStatus.textContent = '';
    if (!v.story.trim()) {
      buildStatus.textContent = T.needStory;
      story.focus();
      return;
    }
    let ctx: StandaloneContext;
    try {
      ctx = await contextFor(v);
    } catch (e) {
      buildStatus.textContent = `${T.mapFailed}: ${String(e)}`;
      return;
    }
    outStatus.textContent = '';
    out.value = buildStandalonePrompt(v, ctx);
    count.textContent = T.chars(out.value.length);
    copyBtn.disabled = saveBtn.disabled = false;
    resultBox.style.display = '';
    out.scrollTop = 0;
    resultBox.scrollIntoView({ block: 'nearest' });
  };

  const dlg = el('dialog', { class: 'ed-dialog wide ai-tool' }, [
    el('h2', {}, T.heading),
    el('p', { class: 'note' }, T.intro),
    el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, T.title), title]),
    el('div', { class: 'f-row ai-url-field' }, [el('span', { class: 'f-label' }, T.urls), urlBox]),
    el('label', { class: 'f-col' }, [el('span', { class: 'f-label' }, T.people), people]),
    el('label', { class: 'f-col' }, [el('span', { class: 'f-label' }, T.story), story]),
    el('label', { class: 'f-row' }, [el('span', { class: 'f-label' }, T.stage), stage]),
    projectRow,
    el('p', { class: 'note' }, T.note),
    el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: () => void build() }, T.build), el('button', { onclick: () => dlg.close() }, T.close), buildStatus]),
    resultBox,
  ]) as HTMLDialogElement;
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

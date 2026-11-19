/**
 * シナリオ選択（FR-01、FR-74）。上のバー、カード一覧（3D の地形の画・2D の地図・登場人物の顔・季節や人数のアイコン）、
 * エディターで作ったシナリオ、バンドルのファイル読み込み（ドラッグ＆ドロップ可）。
 * 絵は npm run thumbs で作る（public/scenarios/thumbs/、実在の山は public/scenarios/real/thumbs/）。なければ色の帯だけ。
 */
import type { AppContext } from '../app/App';
import { assetUrl, buildRuntime, bundleExists, listEditorProjects, loadEditorProject, loadEntry, loadIndex, loadScenarioFile } from '../app/data';
import { JA } from '../i18n/ja';
import { validateScenario } from '../sim/scenario/validate';
import type { HakoniwaBundle, ScenarioDef, ScenarioIndexEntry } from '../sim/types';
import { avatar } from './avatar';
import { el, toast } from './dom';
import { icon, type IconName } from './icons';
import { progressTo, showLoading } from './loading';

/** バンドル（*.hakoniwa.json）を読み、検証してからブリーフィングへ（FR-74、docs/18 §7） */
async function openBundle(app: AppContext, file: File): Promise<void> {
  let b: HakoniwaBundle;
  try {
    b = JSON.parse(await file.text()) as HakoniwaBundle;
    if (b.format !== 'hakoniwa-bundle' || b.version !== 1 || !b.map || !b.scenario) throw new Error('format');
  } catch {
    toast(JA.ui.bundleBroken, 5000);
    return;
  }
  const errors = validateScenario(b.scenario, b.map).filter((x) => x.level === 'error');
  if (errors.length > 0) {
    toast(`${JA.ui.bundleInvalid}: ${errors.slice(0, 3).map((x) => `${x.path} ${x.message}`).join(' / ')}`, 8000);
    return;
  }
  try {
    app.go({ name: 'briefing', loaded: { scenario: b.scenario, map: await buildRuntime(b.map), attribution: b.attribution ?? [] } });
  } catch (e) {
    toast(`${JA.ui.bundleBroken}（${String(e)}）`, 8000);
  }
}

const THEME_ICON: Record<string, IconName> = { hypothermia: 'acUnit', lost: 'explore', lightning: 'thunderstorm', fall: 'trendingUp', heat: 'emergencyHeat', mixed: 'warning' };
const THEME_HUE: Record<string, number> = { hypothermia: 205, lost: 140, lightning: 265, fall: 25, heat: 10, mixed: 45 };

const thumbBase = (e: ScenarioIndexEntry): string => assetUrl(`scenarios/${e.region?.real ? 'real/thumbs' : 'thumbs'}/${e.id}`);

/** 一覧の項目のシナリオ本体（登場人物などを出すため。実在の山はバンドルではなく元の JSON を読む） */
async function scenarioOf(e: ScenarioIndexEntry): Promise<ScenarioDef | null> {
  try {
    if (e.bundle) return await loadScenarioFile(e.bundle.replace(/\.hakoniwa\.json$/, '.json'));
    return await loadScenarioFile(e.file ?? `${e.id}.json`);
  } catch {
    return null;
  }
}

function chip(ic: IconName, text: string, cls = ''): HTMLElement {
  return el('span', { class: `sel-chip ${cls}` }, [icon(ic), text]);
}

function stars(n: number): HTMLElement {
  return el('span', { class: 'sel-stars', 'aria-label': `${JA.ui.difficulty} ${n}` }, Array.from({ length: 5 }, (_, i) => icon(i < n ? 'starFill' : 'star')));
}

function card(app: AppContext, e: ScenarioIndexEntry, list: HTMLElement): HTMLElement {
  const hue = THEME_HUE[e.theme] ?? 200;
  const img = el('img', { class: 'sel-shot', alt: '', loading: 'lazy', src: `${thumbBase(e)}.jpg` }) as HTMLImageElement;
  img.addEventListener('error', () => img.remove());
  const mapImg = el('img', { class: 'sel-map', alt: '地図', loading: 'lazy', src: `${thumbBase(e)}.map.png` }) as HTMLImageElement;
  mapImg.addEventListener('error', () => mapImg.remove());
  const people = el('div', { class: 'sel-people' });
  const facts = el('div', { class: 'sel-facts' }, [chip('timer', `${e.estMinutes} 分`)]);
  const note = e.region?.real ? el('p', { class: 'sel-note' }, [icon('warning'), JA.disclaimer.realMountainShort.replace(/^※/, '')]) : null;
  const btn = el('button', { class: 'sel-card', style: `--h:${hue}` }, [
    el('div', { class: 'sel-hero' }, [
      img,
      el('div', { class: 'sel-shade' }),
      el('div', { class: 'sel-top' }, [chip(THEME_ICON[e.theme] ?? 'warning', JA.labels.theme[e.theme] ?? e.theme, 'theme'), e.region?.real ? chip('landscape', e.region.name, 'real') : chip('landscape', '箱庭岳'), el('span', { class: 'sel-grow' }), stars(e.difficulty)]),
      el('div', { class: 'sel-titles' }, [el('h2', {}, e.title), e.subtitle ? el('p', {}, e.subtitle) : null]),
      mapImg,
    ]),
    el('div', { class: 'sel-body' }, [people, facts, note]),
  ]);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    list.setAttribute('aria-busy', 'true');
    const ld = showLoading(JA.ui.loadingTitle);
    try {
      const loaded = await loadEntry(e, progressTo(ld, { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain }));
      ld.done();
      app.go({ name: 'briefing', loaded });
    } catch (err) {
      ld.done();
      list.removeAttribute('aria-busy');
      toast(String(err), 6000);
    }
  });
  // 登場人物・季節・人数（シナリオ本体を読んでから）
  void scenarioOf(e).then((s) => {
    if (!s) return;
    const month = Number(s.startDate.slice(5, 7));
    facts.prepend(chip('calendarToday', `${month}月・${JA.labels.season[s.season] ?? s.season}`), chip('groups', `${s.party.length}人`));
    const shown = s.party.slice(0, 6);
    const more = s.party.length > shown.length ? [el('span', { class: 'sel-more' }, `+${s.party.length - shown.length}`)] : [];
    people.replaceChildren(
      ...shown.map((p) => el('span', { class: 'sel-face', title: `${p.name}（${p.age}歳${p.role ? `・${p.role}` : ''}）` }, avatar(p, 40))),
      ...more,
      el('span', { class: 'sel-names' }, s.party.length <= 4 ? s.party.map((p) => `${p.name} ${p.age}`).join('・') : `${s.party[0]!.name} ほか ${s.party.length - 1} 人`),
    );
  });
  // 実地形のバンドルがまだ作られていなければ、選べないことを示す
  if (e.bundle)
    void bundleExists(e).then((ok) => {
      if (ok) return;
      btn.disabled = true;
      btn.append(el('p', { class: 'sel-note warn' }, [icon('warning'), JA.ui.bundleMissing]));
    });
  return btn;
}

export function showScenarioSelect(app: AppContext): () => void {
  const list = el('div', { class: 'sel-grid' }, el('p', { class: 'note' }, JA.ui.loading));
  const input = el('input', { type: 'file', accept: '.json,application/json', onchange: (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void openBundle(app, f);
  } });
  const mine = el('section', { class: 'sel-section', hidden: true });
  const drop = el('label', { class: 'sel-drop' }, [icon('folderOpen'), el('span', {}, [el('strong', {}, JA.ui.loadFile), el('small', {}, JA.ui.dropHint)]), input]);
  const count = el('span', { class: 'sel-count' });
  // 画面のどこに落としても読み込む
  const onOver = (e: DragEvent): void => {
    e.preventDefault();
    drop.classList.add('over');
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer?.files[0];
    if (f) void openBundle(app, f);
  };
  document.addEventListener('dragover', onOver);
  document.addEventListener('drop', onDrop);
  app.root.append(
    el('main', { class: 'select2' }, [
      el('header', { class: 'sel-bar' }, [
        el('div', { class: 'sel-bar-in' }, [
          el('button', { class: 'sel-back', onclick: () => app.go({ name: 'title' }), 'aria-label': JA.ui.back }, [icon('arrowBack'), JA.ui.back]),
          el('h1', {}, [icon('hiking'), JA.ui.selectTitle]),
          count,
        ]),
      ]),
      el('div', { class: 'sel-wrap' }, [
        el('section', { class: 'sel-section' }, [el('h2', { class: 'sel-h' }, [icon('landscape'), '収録のシナリオ']), list]),
        mine,
        drop,
      ]),
    ]),
  );
  void listEditorProjects().then((ps) => {
    if (ps.length === 0) return;
    mine.hidden = false;
    mine.replaceChildren(
      el('h2', { class: 'sel-h' }, [icon('folderOpen'), JA.ui.editorScenarios]),
      el('div', { class: 'sel-mine' }, ps.map((p) =>
        el('button', { class: 'sel-mine-card', onclick: async () => {
          try {
            app.go({ name: 'briefing', loaded: await loadEditorProject(p.id) });
          } catch (e) {
            toast(String(e), 6000);
          }
        } }, [icon(p.real ? 'landscape' : 'hiking'), el('span', {}, [el('strong', {}, p.name), el('small', {}, `${p.real ? '実在の山' : '箱庭岳'} ・ ${new Date(p.updatedAt).toLocaleDateString('ja-JP')}`)])]),
      )),
    );
  });
  void loadIndex().then((idx) => {
    count.textContent = `${idx.length} 本`;
    list.replaceChildren(...idx.map((e) => card(app, e, list)));
  });
  return () => {
    document.removeEventListener('dragover', onOver);
    document.removeEventListener('drop', onDrop);
  };
}

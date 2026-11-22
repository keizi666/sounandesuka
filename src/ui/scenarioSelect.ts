/**
 * トップページ＝シナリオ選択（FR-01、FR-74。ユーザーの指定でタイトル画面と一つにした）。
 * 上のバー（題名と、音・履歴・設定・エディターのカプセルボタン）、カード一覧（3D の地形の画・2D の地図・登場人物の顔・季節や人数のアイコン）。
 * 途中まで遊んだシナリオには「再開」（と小さく「最初から」）、それ以外は「状況開始」。
 * エディターで作ったシナリオ、バンドルのファイル読み込み（ドラッグ＆ドロップ可）。
 * 絵は npm run thumbs で作る（public/scenarios/thumbs/、実在の山は public/scenarios/real/thumbs/）。なければ色の帯だけ。
 */
import { scrollMemory } from '../app/scrollMemory';
import type { AppContext } from '../app/App';
import { assetUrl, buildRuntime, bundleExists, listEditorProjects, loadEditorProject, loadEntry, loadIndex, loadScenarioFile } from '../app/data';
import { isLocalHost } from '../app/local';
import { loadResume, resumableScenarios } from '../app/storage';
import { versionLabel } from '../app/version';
import { applyConditions } from '../sim/scenario/startConditions';
import { JA } from '../i18n/ja';
import { fill } from '../i18n/format';
import { favorites, isFavorite, playCounts, toggleFavorite } from '../app/playStats';
import { validateScenario } from '../sim/scenario/validate';
import type { SounanBundle, ScenarioDef, ScenarioIndexEntry } from '../sim/types';
import { audio } from './audio';
import { avatar } from './avatar';
import { el, toast } from './dom';
import { icon, type IconName } from './icons';
import { progressTo, showLoading } from './loading';
import { openSettings } from './settingsDialog';
import { anySoundOn, toggleSoundPanel } from './soundPanel';
import { communityBanner } from './community/banner';
import { cIcon, userAvatar } from './community/common';
import { openProfileDialog } from './community/profileDialog';
import { loadProfile } from '../net/profile';
import { refreshProfile } from '../net/communityApi';
import { shareButtons, siteUrl } from './shareButtons';
import { maskSpoiler, mountainName } from './spoiler';

/** バンドル（*.sounan.json）を読み、検証してからブリーフィングへ（FR-74、docs/18 §7） */
async function openBundle(app: AppContext, file: File): Promise<void> {
  let b: SounanBundle;
  try {
    b = JSON.parse(await file.text()) as SounanBundle;
    if ((b.format !== 'sounan-bundle' && b.format !== 'hakoniwa-bundle') || b.version !== 1 || !b.map || !b.scenario) throw new Error('format');
  } catch {
    toast(JA.ui.bundleBroken, 5000);
    return;
  }
  // 地形のまだない下書き（AI などが書いたスケルトン）は、エディターで標高と登山道を取り込んでから（ユーザーの指摘: 「高さマップの大きさが合いません」になった）
  if (b.map.skeleton === true || (b.map.terrain?.type === 'heightmap' && !b.map.terrain.data)) {
    toast(JA.ui.bundleNeedsEditor, 15000);
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

const FAV_ONLY_KEY = 'hks.v1.favOnly';

const thumbBase = (e: ScenarioIndexEntry): string => assetUrl(`scenarios/${e.region?.real ? 'real/thumbs' : 'thumbs'}/${e.id}`);

/** 一覧の項目のシナリオ本体（登場人物などを出すため。実在の山はバンドルではなく元の JSON を読む） */
async function scenarioOf(e: ScenarioIndexEntry): Promise<ScenarioDef | null> {
  try {
    if (e.bundle) return await loadScenarioFile(e.bundle.replace(/\.sounan\.json$/, '.json'));
    return await loadScenarioFile(e.file ?? `${e.id}.json`);
  } catch {
    return null;
  }
}

function chip(ic: IconName, text: string, cls = ''): HTMLElement {
  return el('span', { class: `sel-chip ${cls}` }, [icon(ic), text]);
}

/**
 * 未プレイで題名を伏せたカードの、絵の中央に大きく出す山名（ユーザーの指定）。
 * 地域名は「奥多摩・高水三山（青梅市）」のような形なので、かっこを除き、「・」の前を小さな地域、後ろを大きな山名にする
 */
function mountainLabel(e: ScenarioIndexEntry): HTMLElement {
  const { area, main } = mountainName(e.region);
  return el('div', { class: 'sel-mtn', 'aria-hidden': 'true' }, [area ? el('small', {}, area) : null, el('strong', {}, main)]);
}

function stars(n: number): HTMLElement {
  return el('span', { class: 'sel-stars', 'aria-label': `${JA.ui.difficulty} ${n}` }, Array.from({ length: 5 }, (_, i) => icon(i < n ? 'starFill' : 'star')));
}

function card(app: AppContext, e: ScenarioIndexEntry, list: HTMLElement, resumable: boolean, plays: number, onFav: () => void): HTMLElement {
  // 1 回も遊んでいないシナリオは、テーマと題名をぼかす（ユーザーの指定）。カードの色もテーマで決まるので、同じ色にする
  const hidden = plays === 0;
  const hue = hidden ? 210 : THEME_HUE[e.theme] ?? 200;
  const M = JA.myPlays;
  const veil = <T extends HTMLElement>(n: T): T => (hidden ? maskSpoiler(n, false) : n);
  // お気に入り（ユーザーの指定）。カードを開く操作とは別に押せる
  const fav = el('button', { class: 'sel-fav', type: 'button' });
  const paintFav = (): void => {
    const on = isFavorite(e.id);
    fav.classList.toggle('on', on);
    fav.setAttribute('aria-pressed', String(on));
    fav.title = on ? M.unfav : M.fav;
    fav.setAttribute('aria-label', fav.title);
    fav.replaceChildren(icon(on ? 'favoriteFill' : 'favorite'));
  };
  fav.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleFavorite(e.id);
    paintFav();
    onFav();
  });
  fav.addEventListener('keydown', (ev) => ev.stopPropagation());
  paintFav();
  // 実地形のシナリオは、バンドルがあると分かってから絵を読む（公開版では地形データと絵を配っていないので、読みに行かない）
  const img = el('img', { class: 'sel-shot', alt: '', loading: 'lazy' }) as HTMLImageElement;
  img.addEventListener('error', () => img.remove());
  const mapImg = el('img', { class: 'sel-map', alt: '地図', loading: 'lazy' }) as HTMLImageElement;
  mapImg.addEventListener('error', () => mapImg.remove());
  const showThumbs = (): void => {
    img.src = `${thumbBase(e)}.jpg`;
    mapImg.src = `${thumbBase(e)}.map.png`;
  };
  if (!e.bundle) showThumbs();
  const people = el('div', { class: 'sel-people' });
  const facts = el('div', { class: 'sel-facts' }, [chip('timer', `${e.estMinutes} 分`), plays > 0 ? chip('checkCircle', fill(M.played, { n: plays }), 'played') : null]);
  const note = e.region?.real ? el('p', { class: 'sel-note' }, [icon('warning'), JA.disclaimer.realMountainShort.replace(/^※/, '')]) : null;
  let busy = false;
  let disabled = false;
  /** resume: 保存した続きから（変えた条件も当て直す）。保存が読めなければブリーフィングから */
  const open = async (resume: boolean): Promise<void> => {
    if (busy || disabled) return;
    busy = true;
    list.setAttribute('aria-busy', 'true');
    const ld = showLoading(JA.ui.loadingTitle);
    try {
      const data = resume ? await loadResume(e.id) : null;
      const loaded = await loadEntry(e, progressTo(ld, { data: JA.ui.loadingData, terrain: JA.ui.loadingTerrain }));
      ld.done();
      if (data) {
        const cond = data.conditions;
        app.go({ name: 'sim', loaded: cond ? { ...loaded, scenario: applyConditions(loaded.scenario, cond), conditions: cond } : loaded, resume: data });
      } else app.go({ name: 'briefing', loaded });
    } catch (err) {
      ld.done();
      busy = false;
      list.removeAttribute('aria-busy');
      toast(String(err), 6000);
    }
  };
  const primary = el('button', { class: 'primary sel-go', onclick: () => void open(resumable) }, resumable ? [icon('playCircle'), JA.ui.resumeShort] : [icon('playArrow'), JA.ui.start]);
  const restart = resumable ? el('button', { class: 'sel-restart', onclick: () => void open(false), title: JA.ui.fromStartHint }, [icon('replay'), JA.ui.fromStart]) : null;
  const hero = el('div', {
    class: 'sel-hero',
    role: 'button',
    tabindex: 0,
    'aria-label': `${hidden ? JA.spoiler.hiddenTitle : e.title}（${resumable ? JA.ui.resumeShort : JA.ui.start}）`,
    onclick: () => void open(resumable),
    onkeydown: (e0: Event) => {
      const ev = e0 as KeyboardEvent;
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      void open(resumable);
    },
  }, [
    img,
    el('div', { class: 'sel-shade' }),
    hidden ? mountainLabel(e) : null,
    el('div', { class: 'sel-top' }, [veil(chip(THEME_ICON[e.theme] ?? 'warning', JA.labels.theme[e.theme] ?? e.theme, 'theme')), e.region?.real ? chip('landscape', e.region.name, 'real') : chip('landscape', '箱庭岳'), el('span', { class: 'sel-grow' }), stars(e.difficulty), fav]),
    el('div', { class: 'sel-titles' }, [veil(el('h2', {}, e.title)), e.subtitle ? veil(el('p', {}, e.subtitle)) : null]),
    mapImg,
    resumable ? el('span', { class: 'sel-badge' }, JA.ui.inProgress) : plays > 0 ? el('span', { class: 'sel-badge played' }, [icon('checkCircle'), M.playedBadge]) : null,
  ]);
  const btn = el('article', { class: `sel-card${resumable ? ' resumable' : ''}${plays > 0 ? ' played' : ''}${hidden ? ' unplayed' : ''}`, style: `--h:${hue}`, 'data-id': e.id }, [
    hero,
    el('div', { class: 'sel-body' }, [people, facts, note, el('div', { class: 'sel-actions' }, [primary, restart])]),
  ]);
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
      el('span', { class: 'sel-names' }, s.party.length <= 4 ? s.party.map((p) => `${p.name} ${p.age}歳`).join('・') : `${s.party[0]!.name} ほか ${s.party.length - 1} 人`),
    );
  });
  // 実地形のバンドルがまだ作られていなければ、選べないことを示す
  if (e.bundle)
    void bundleExists(e).then((ok) => {
      if (ok) return showThumbs();
      img.remove();
      mapImg.remove();
      disabled = true;
      btn.classList.add('disabled');
      primary.disabled = true;
      if (restart) restart.disabled = true;
      btn.append(el('p', { class: 'sel-note warn' }, [icon('warning'), JA.ui.bundleMissing]));
    });
  return btn;
}

export function showScenarioSelect(app: AppContext): () => void {
  audio().music('wilderness');
  const list = el('div', { class: 'sel-grid' }, el('p', { class: 'note' }, JA.ui.loading));
  const input = el('input', { type: 'file', accept: '.json,application/json', onchange: (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void openBundle(app, f);
  } });
  const mine = el('section', { class: 'sel-section', hidden: true });
  const drop = el('label', { class: 'sel-drop' }, [icon('folderOpen'), el('span', {}, [el('strong', {}, JA.ui.loadFile), el('small', {}, JA.ui.dropHint)]), input]);
  const count = el('span', { class: 'sel-count' });
  // お気に入りだけに絞る（ユーザーの指定。端末に覚える）
  let favOnly = false;
  try {
    favOnly = localStorage.getItem(FAV_ONLY_KEY) === '1';
  } catch {
    // 読めなければすべて
  }
  const favBtn = el('button', { class: 'sel-favonly', type: 'button', 'aria-pressed': 'false' }, [icon('favorite'), JA.myPlays.favOnly]);
  const noFav = el('p', { class: 'note', hidden: true }, JA.myPlays.noFav);
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
  // 上のカプセルボタン: 音・履歴・設定・エディター（エディターは手元＝localhost だけ）
  const soundCap = el('button', { class: 'cap', 'aria-label': JA.soundPanel.title }, [icon(anySoundOn(app.settings, false) ? 'volumeUp' : 'volumeOff'), JA.soundPanel.title]);
  soundCap.addEventListener('click', () =>
    toggleSoundPanel(app, soundCap, { ambient: false, onChange: () => soundCap.replaceChildren(icon(anySoundOn(app.settings, false) ? 'volumeUp' : 'volumeOff'), JA.soundPanel.title) }),
  );
  const historyCap = el('button', { class: 'cap', onclick: () => app.go({ name: 'history' }) }, [icon('history'), JA.ui.history]);
  const settingsCap = el('button', { class: 'cap', onclick: () => openSettings(app) }, [icon('settings'), JA.ui.settings]);
  // 右上のプロフィール（作ってあれば顔とニックネーム、なければ「プロフィールを作る」。ユーザーの指定）
  const profCap = el('button', { class: 'cap sel-prof', type: 'button', title: JA.community.profileTitle });
  const paintProf = (): void => {
    const p = loadProfile();
    profCap.replaceChildren(...(p ? [userAvatar(p.user, 24), el('span', { class: 'sel-prof-t' }, p.user.nickname)] : [cIcon('personEdit'), el('span', { class: 'sel-prof-t' }, JA.community.makeProfile)]));
  };
  profCap.addEventListener('click', () => openProfileDialog(() => paintProf()));
  paintProf();
  void refreshProfile().then((changed) => changed && paintProf());
  const editorCap = isLocalHost() ? el('a', { class: 'cap', href: `${import.meta.env.BASE_URL}editor.html` }, [icon('edit'), JA.ui.editorShort]) : null;
  document.addEventListener('dragover', onOver);
  document.addEventListener('drop', onDrop);
  // プロフィールでプレイ記録を消したら、一覧（プレイ済みの印・伏せ方・再開）を作り直す
  const onPlaysCleared = (): void => app.go({ name: 'select' });
  window.addEventListener('hks:plays-cleared', onPlaysCleared);
  app.root.append(
    el('main', { class: 'select2' }, [
      el('header', { class: 'sel-bar' }, [
        el('div', { class: 'sel-bar-in' }, [
          // ロゴ: アイコンと、明朝の題・線・英字・ひとこと（ユーザーの指定。画像ではなく文字で組む）
          el('h1', { class: 'sel-brand', 'aria-label': JA.app.title }, [
            el('img', { class: 'sel-logo', src: assetUrl('icon-128.webp'), srcset: `${assetUrl('icon-128.webp')} 1x, ${assetUrl('icon-256.webp')} 2x`, alt: '', width: 64, height: 64 }),
            el('span', { class: 'brand-text', 'aria-hidden': 'true' }, [
              el('span', { class: 'brand-ja' }, JA.app.title),
              el('span', { class: 'brand-rule' }),
              el('span', { class: 'brand-en' }, JA.app.titleEn),
              el('span', { class: 'brand-tag' }, JA.app.tagline),
            ]),
          ]),
          count,
          el('nav', { class: 'sel-caps' }, [soundCap, historyCap, settingsCap, editorCap]),
          profCap,
        ]),
      ]),
      el('div', { class: 'sel-wrap' }, [
        el('p', { class: 'sel-lead' }, JA.disclaimer.fictional),
        // みんなの遭難記録（docs/20_community.md）
        communityBanner(app),
        el('section', { class: 'sel-section' }, [el('div', { class: 'sel-h-row' }, [el('h2', { class: 'sel-h' }, [icon('landscape'), JA.ui.selectTitle]), favBtn]), noFav, list]),
        mine,
        drop,
        el('section', { class: 'sel-section sel-share' }, [el('h2', { class: 'sel-h' }, [icon('share'), JA.share.siteTitle]), shareButtons({ text: JA.share.siteText, url: siteUrl() })]),
        el('footer', { class: 'sel-foot' }, [
          el('span', {}, JA.ui.copyright),
          el('a', { href: `${import.meta.env.BASE_URL}legal/terms.html` }, JA.ui.terms),
          el('a', { href: `${import.meta.env.BASE_URL}legal/privacy.html` }, JA.ui.privacy),
          el('span', {}, versionLabel()),
          el('span', {}, [JA.ui.audioCredit, ' ', el('a', { href: `${import.meta.env.BASE_URL}audio/CREDITS.md`, target: '_blank', rel: 'noopener' }, JA.ui.audioCreditLink)]),
          el('span', {}, [JA.ui.skyCredit, ' ', el('a', { href: `${import.meta.env.BASE_URL}sky/CREDITS.md`, target: '_blank', rel: 'noopener' }, JA.ui.audioCreditLink)]),
        ]),
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
    const saved = new Set(resumableScenarios());
    // 途中のシナリオを先に
    const sorted = [...idx.filter((e) => saved.has(e.id)), ...idx.filter((e) => !saved.has(e.id))];
    const counts = playCounts();
    const applyFilter = (): void => {
      const favs = favorites();
      let shown = 0;
      for (const c of Array.from(list.children) as HTMLElement[]) {
        const hide = favOnly && !favs.has(c.dataset['id'] ?? '');
        c.hidden = hide;
        if (!hide) shown += 1;
      }
      noFav.hidden = !(favOnly && shown === 0);
    };
    list.replaceChildren(...sorted.map((e) => card(app, e, list, saved.has(e.id), counts[e.id] ?? 0, applyFilter)));
    favBtn.onclick = () => {
      favOnly = !favOnly;
      favBtn.classList.toggle('on', favOnly);
      favBtn.setAttribute('aria-pressed', String(favOnly));
      try {
        localStorage.setItem(FAV_ONLY_KEY, favOnly ? '1' : '0');
      } catch {
        // 覚えられなくても絞り込める
      }
      applyFilter();
    };
    favBtn.classList.toggle('on', favOnly);
    favBtn.setAttribute('aria-pressed', String(favOnly));
    applyFilter();
    // 詳細から戻ったら、離れたときの位置へ
    if (scrollMemory.listY > 0) window.scrollTo(0, scrollMemory.listY);
  });
  return () => {
    window.removeEventListener('hks:plays-cleared', onPlaysCleared);
    document.removeEventListener('dragover', onOver);
    document.removeEventListener('drop', onDrop);
  };
}

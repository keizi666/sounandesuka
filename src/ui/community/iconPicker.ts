/**
 * プロフィールのアイコンを選ぶ部品（docs/20_community.md §2.1）。
 * 「似顔絵」（登山者のイラスト 64 種）・「絵文字」（OS の絵文字をそのまま）・「画像」（アップロード）の 3 つのタブ。
 * 画像は、ここでは端末で縮めるだけ。サーバーへ送るのはプロフィールを保存するとき（profileDialog）。
 */
import { JA } from '../../i18n/ja';
import { AVATAR_SOURCE_MAX_BYTES, EMOJIS, parseIcon, type AgeBand, type Sex } from '../../net/rules';
import { parsePortrait, portraitCounts, PORTRAIT_GROUPS, type PortraitGroup } from '../avatar';
import { el } from '../dom';
import { avatarCrop, type CroppedImage } from './avatarCrop';
import { userAvatar } from './common';

type Tab = 'portrait' | 'emoji' | 'image';

/** 年代と性別から、最初に見せる顔の区分 */
function groupFor(sex: Sex, age: AgeBand): PortraitGroup {
  const a = age === '10' ? 'child' : age === '20' || age === '30' ? 'young' : age === '60' || age === '70' ? 'senior' : 'mid';
  return `${a}_${sex === 'f' ? 'f' : 'm'}` as PortraitGroup;
}

export interface IconPicker {
  el: HTMLElement;
  /** 枠の色を変えたとき */
  repaint(): void;
  /** 年代・性別を選んだとき（まだ似顔絵を選んでいなければ、それに合う区分にする） */
  follow(sex: Sex, age: AgeBand): void;
}

/**
 * initial は今のアイコンの値。onChange は、選んだ値（画像のときは送る前の画像も）で呼ぶ。
 * 画像を新しく選んだときの値は "img:new"（保存のときに送って、サーバーの版に置き換わる）
 */
export function iconPicker(o: {
  initial: string;
  userId: number;
  color: () => string;
  onChange: (portrait: string, image: CroppedImage | null) => void;
}): IconPicker {
  const C = JA.community;
  let value = o.initial;
  let image: CroppedImage | null = null;
  const start = parseIcon(value);
  let tab: Tab = start?.kind === 'emoji' ? 'emoji' : start?.kind === 'img' ? 'image' : 'portrait';
  let group: PortraitGroup = parsePortrait(start?.kind === 'portrait' ? start.value : '')?.group ?? 'mid_m';
  let pickedFace = start !== null && o.userId > 0;
  let counts: Partial<Record<PortraitGroup, number>> | null = null;
  /** 画像のタブの、前に置いた画像（なければ null） */
  const savedImg = start?.kind === 'img' ? value : null;

  const set = (v: string, img: CroppedImage | null): void => {
    value = v;
    image = img;
    o.onChange(v, img);
    paint();
  };

  const tabs = el('div', { class: 'cm-tabs', role: 'tablist' });
  const body = el('div', { class: 'cm-tab-body' });

  // ---- 似顔絵 ----
  const portraitTab = (): HTMLElement[] => {
    const groups = el('div', { class: 'cm-groups' }, PORTRAIT_GROUPS.map((g) => el('button', { type: 'button', class: g === group ? 'on' : '', onclick: () => {
      group = g;
      paint();
    } }, C.portraitGroups[g] ?? g)));
    const n = counts?.[group] ?? 8;
    const faces = el('div', { class: 'cm-faces' }, Array.from({ length: n }, (_, i) => {
      const v = `${group}:${i + 1}`;
      return el('button', { type: 'button', class: `cm-face${v === value ? ' on' : ''}`, 'aria-label': `${C.portraitGroups[group] ?? group} ${i + 1}`, onclick: () => {
        pickedFace = true;
        set(v, null);
      } }, userAvatar({ id: 0, nickname: '', portrait: v, color: o.color() }, 48));
    }));
    return [groups, faces];
  };

  // ---- 絵文字 ----
  const emojiTab = (): HTMLElement[] => [
    el('div', { class: 'cm-emojis' }, EMOJIS.map((e) => el('button', { type: 'button', class: `cm-emoji${value === `emoji:${e}` ? ' on' : ''}`, 'aria-label': e, onclick: () => set(`emoji:${e}`, null) }, e))),
    el('p', { class: 'cm-note' }, C.emojiNote),
  ];

  // ---- 画像 ----
  const cropBox = el('div', { class: 'cm-crop-box' });
  const imgErr = el('p', { class: 'cm-err', role: 'alert' });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    imgErr.textContent = '';
    if (f.size > AVATAR_SOURCE_MAX_BYTES) {
      imgErr.textContent = C.imageTooBig;
      return;
    }
    try {
      // 向き（EXIF の回転）を当ててから読む。GIF は最初のコマ
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      cropBox.replaceChildren(avatarCrop(bmp, (r) => set('img:new', r)));
    } catch {
      imgErr.textContent = C.imageBad;
    }
  });
  const imageTab = (): HTMLElement[] => {
    const pick = el('button', { type: 'button', class: 'cm-pick', onclick: () => file.click() }, C.imagePick);
    const keep = savedImg && value !== savedImg && !image
      ? el('button', { type: 'button', class: 'small', onclick: () => set(savedImg, null) }, C.imageKeep)
      : null;
    if (!cropBox.firstChild && savedImg) cropBox.replaceChildren(userAvatar({ id: o.userId, nickname: '', portrait: savedImg, color: o.color() }, 120));
    return [el('div', { class: 'cm-pick-row' }, [pick, keep, file]), cropBox, imgErr, el('p', { class: 'cm-note' }, C.imageHint), el('p', { class: 'cm-note warn' }, C.imageNote)];
  };

  const paint = (): void => {
    tabs.replaceChildren(...(['portrait', 'emoji', 'image'] as Tab[]).map((t) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(t === tab), onclick: () => {
      tab = t;
      paint();
    } }, C.iconTabs[t] ?? t)));
    // 画像のタブは作り直さない（切り抜きの途中の状態を残す）
    const parts = tab === 'portrait' ? portraitTab() : tab === 'emoji' ? emojiTab() : imageTab();
    body.replaceChildren(...parts);
  };
  void portraitCounts().then((c) => {
    counts = c;
    if (tab === 'portrait') paint();
  });
  paint();
  return {
    el: el('div', { class: 'cm-icon-picker' }, [tabs, body]),
    repaint: paint,
    follow(sex, age) {
      if (pickedFace || parseIcon(value)?.kind !== 'portrait') return;
      group = groupFor(sex, age);
      set(`${group}:1`, null);
    },
  };
}

/**
 * ネタバレを伏せる（ユーザーの指定: 1 回もプレイしていないシナリオは、テーマと題名をぼかし、ブリーフィングでもネタバレになる所を伏せる）。
 * 「プレイした」は、結末まで 1 回遊んだとき（プレイ回数。ユーザーの指定: 途中まで遊んだだけでは、プレイ中も題名を隠したまま）。
 * 伏せた所は、ぼかして選べなくする。ブリーフィングでは押すとその場で見える（史実の注記・出典は、読みたい人がすぐ読めるように）
 */
import { playCounts } from '../app/playStats';
import { JA } from '../i18n/ja';

/** 1 回もプレイしていないシナリオか */
export function unplayed(scenarioId: string): boolean {
  try {
    return (playCounts()[scenarioId] ?? 0) === 0;
  } catch {
    return false;
  }
}

/** 山名（地域名からかっこを除く）。「・」の前が地域、後ろが山。箱庭岳のシナリオは「箱庭岳」 */
export function mountainName(region: { name: string; real?: boolean } | undefined): { area: string; main: string } {
  const name = (region?.real ? region.name : '箱庭岳').replace(/（[^）]*）/g, '').trim();
  const i = name.indexOf('・');
  return { area: i > 0 ? name.slice(0, i) : '', main: i > 0 ? name.slice(i + 1) : name };
}

/**
 * 要素をぼかして伏せる。reveal なら、押す（Enter・スペースでも）とぼかしを外す。
 * 中身は読み上げにも出さない（aria-hidden）。伏せたことは aria-label で伝える
 */
export function maskSpoiler<T extends HTMLElement>(node: T, reveal: boolean): T {
  node.classList.add('spoiler');
  const S = JA.spoiler;
  if (!reveal) {
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  node.classList.add('revealable');
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.title = S.reveal;
  const show = (ev: Event): void => {
    if (!node.classList.contains('spoiler')) return;
    ev.preventDefault();
    ev.stopPropagation();
    node.classList.remove('spoiler', 'revealable');
    node.removeAttribute('role');
    node.removeAttribute('title');
    node.removeAttribute('tabindex');
  };
  node.addEventListener('click', show);
  node.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') show(ev);
  });
  return node;
}

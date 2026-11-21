/**
 * ネタバレを伏せる（ユーザーの指定: 1 回もプレイしていないシナリオは、テーマと題名をぼかし、ブリーフィングでもネタバレになる所を伏せる）。
 * 「プレイした」は、結末まで遊んだか（プレイ回数）、途中まで遊んで保存があるとき。
 * 伏せた所は、ぼかして選べなくする。ブリーフィングでは押すとその場で見える（史実の注記・出典は、読みたい人がすぐ読めるように）
 */
import { playCounts } from '../app/playStats';
import { resumableScenarios } from '../app/storage';
import { JA } from '../i18n/ja';

/** 1 回もプレイしていないシナリオか */
export function unplayed(scenarioId: string): boolean {
  try {
    return (playCounts()[scenarioId] ?? 0) === 0 && !resumableScenarios().includes(scenarioId);
  } catch {
    return false;
  }
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

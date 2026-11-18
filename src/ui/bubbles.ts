/**
 * セリフと思考の吹き出し（docs/11 §8）。3D キャンバスの上に DOM を重ね、毎フレーム頭の投影位置へ追従させる。
 * 同時表示は最大 4（スマホ 2）、あふれた分は待ち行列（最大 6、5 秒で破棄）。aria-live にも同じ文を流す。
 */
import type { SpeechView } from '../i18n/format';
import type { ScenarioDef } from '../sim/types';
import { bubbleDurationSec, bubblePath, layoutBubbles, type BubbleIn } from './bubbleLayout';
import { el } from './dom';

export interface HeadPos {
  x: number;
  y: number;
  /** カメラの前にあるか */
  front: boolean;
  /** 画面内か */
  inView: boolean;
  occluded: boolean;
}

interface Live {
  id: string;
  speaker: string;
  view: SpeechView;
  node: HTMLElement;
  svg: SVGSVGElement;
  path: SVGPathElement;
  body: HTMLElement;
  w: number;
  h: number;
  priority: number;
  /** 残り表示時間（実秒、一時停止中は減らない） */
  left: number;
  /** 表示開始までの遅れ（応答） */
  delay: number;
}

const SVGNS = 'http://www.w3.org/2000/svg';

export class BubbleLayer {
  readonly root: HTMLElement;
  private live: Live[] = [];
  private queue: { at: number; item: Live }[] = [];
  private aria: HTMLElement;
  speechOn = true;
  thoughtOn = true;
  fictionalOn = true;
  /** 視点カメラの本人（字幕で出す） */
  eyeOf: string | null = null;
  private subtitle: HTMLElement;

  constructor(
    host: HTMLElement,
    private scenario: ScenarioDef,
    private nameOf: (id: string) => { name: string; color: string },
  ) {
    this.root = el('div', { class: 'bubbles', 'aria-hidden': 'true' });
    this.aria = el('div', { class: 'sr-only', 'aria-live': 'polite' });
    this.subtitle = el('div', { class: 'subtitle' });
    host.append(this.root, this.aria, this.subtitle);
  }

  private maxVisible(): number {
    return window.innerWidth < 600 ? 2 : 4;
  }

  /** SPEECH / THOUGHT を 1 つ加える */
  add(climberId: string, view: SpeechView, speedFast: boolean): void {
    const isHistorical = this.scenario.historical !== undefined;
    if (view.thought ? !this.thoughtOn : !this.speechOn) return;
    if (isHistorical && view.cls === 'fictional' && !this.fictionalOn) return;
    const priority = view.thought ? 5 : view.cls === 'documented' || view.tone === 'shout' ? 30 : 10;
    if (speedFast && priority < 20) return;
    const who = this.nameOf(climberId);
    this.aria.textContent = `${view.cls === 'fictional' && isHistorical ? '架空のセリフ、' : ''}${who.name}、${view.text}`;
    // 同じ人にセリフと思考が同時に来たらセリフを優先
    const same = this.live.find((l) => l.id === climberId);
    if (same && view.thought && !same.view.thought) return;
    if (same) this.remove(same);
    if (this.eyeOf === climberId && !view.thought) {
      this.subtitle.textContent = view.display;
      this.subtitle.classList.add('on');
      window.setTimeout(() => this.subtitle.classList.remove('on'), bubbleDurationSec(view.display) * 1000);
      return;
    }
    const to = view.to ? ` → ${this.nameOf(view.to).name}` : '';
    const lisp = view.level === 1 ? el('small', { class: 'lisp' }, '（ろれつが回らない）') : null;
    const badge = view.cls === 'documented' ? el('span', { class: 'badge rec' }, '記録') : view.cls === 'fictional' && isHistorical ? el('span', { class: 'badge fic' }, '架空') : null;
    const body = el('div', { class: 'b-body' }, view.display);
    const svg = document.createElementNS(SVGNS, 'svg');
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('stroke', who.color);
    svg.append(path);
    const node = el('div', { class: `bubble tone-${view.tone}${view.thought ? ' thought' : ''}${view.level === 1 ? ' shiver' : ''}` }, [
      el('div', { class: 'b-name', style: `color:${who.color}` }, [`${who.name}${to}`, lisp]),
      body,
      badge,
    ]);
    node.prepend(svg);
    const live: Live = { id: climberId, speaker: who.name, view, node, svg, path, body, w: 0, h: 0, priority, left: bubbleDurationSec(view.display), delay: view.delaySec / 6 };
    if (this.live.length >= this.maxVisible()) {
      if (this.queue.length < 6) this.queue.push({ at: performance.now(), item: live });
      return;
    }
    this.show(live);
  }

  private show(l: Live): void {
    this.root.append(l.node);
    const r = l.node.getBoundingClientRect();
    l.w = Math.ceil(r.width);
    l.h = Math.ceil(r.height);
    this.live.push(l);
  }

  private remove(l: Live): void {
    l.node.classList.add('out');
    window.setTimeout(() => l.node.remove(), 200);
    this.live = this.live.filter((x) => x !== l);
  }

  clear(): void {
    for (const l of [...this.live]) this.remove(l);
    this.queue = [];
  }

  /** 毎フレーム。dtSec は実時間（一時停止中は 0 を渡す） */
  update(dtSec: number, headOf: (id: string) => HeadPos | null, viewW: number): void {
    const now = performance.now();
    this.queue = this.queue.filter((q) => now - q.at < 5000);
    while (this.live.length < this.maxVisible() && this.queue.length > 0) this.show(this.queue.shift()!.item);
    const items: BubbleIn[] = [];
    for (const l of [...this.live]) {
      if (l.delay > 0) {
        l.delay -= dtSec;
        l.node.style.visibility = 'hidden';
        continue;
      }
      l.left -= dtSec;
      if (l.left <= 0) {
        this.remove(l);
        continue;
      }
      const h = headOf(l.id);
      if (!h || !h.front || (!h.inView && l.view.tone !== 'shout')) {
        l.node.style.visibility = 'hidden';
        continue;
      }
      l.node.style.visibility = 'visible';
      l.node.classList.toggle('occluded', h.occluded);
      items.push({ id: l.id, headX: Math.max(4, Math.min(viewW - 4, h.x)), headY: Math.max(l.h + 30, h.y), w: l.w, h: l.h, priority: l.priority });
    }
    const out = layoutBubbles(items, viewW);
    for (const o of out) {
      const l = this.live.find((x) => x.id === o.id);
      if (!l) continue;
      if (o.hidden) {
        l.node.style.visibility = 'hidden';
        continue;
      }
      l.node.style.transform = `translate(${o.x}px, ${o.y}px)`;
      const pad = 2;
      const tail = l.view.thought || l.view.tone === 'sound' ? 0 : o.tailLen;
      l.svg.setAttribute('width', String(l.w + pad * 2));
      l.svg.setAttribute('height', String(l.h + tail + pad * 2));
      l.svg.setAttribute('viewBox', `${-pad} ${-pad} ${l.w + pad * 2} ${l.h + tail + pad * 2}`);
      const r = l.h > 40 ? 14 : 12;
      l.path.setAttribute('d', tail > 0 ? bubblePath(l.w, l.h, r, o.tailX, tail) : bubblePath(l.w, l.h, r, l.w / 2, 0, 0));
      l.node.style.setProperty('--tail', `${o.tailLen}px`);
      l.node.style.setProperty('--tailx', `${o.tailX}px`);
    }
  }

  dispose(): void {
    this.root.remove();
    this.aria.remove();
    this.subtitle.remove();
  }
}


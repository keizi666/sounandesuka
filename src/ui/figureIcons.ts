/**
 * 3D 画面で、登山者の頭の上に顔アイコンを出す。押すと、その人のいまの状態をポップアップで出す。
 * 位置は毎フレーム、頭の画面上の位置（SceneView.headScreen）に合わせる。地形に隠れているときは薄くする。
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { ClimberState, World } from '../sim/types';
import { avatar } from './avatar';
import { el } from './dom';
import { hpLevel, hpOf } from './hp';
import { openLogDetail, snapOf } from './logDetail';

export interface HeadPos {
  x: number;
  y: number;
  front: boolean;
  inView: boolean;
  occluded: boolean;
}

export interface FigureIcons {
  el: HTMLElement;
  /** 毎フレーム呼ぶ。head は頭の画面上の位置（なければ null） */
  update(world: World, head: (id: string) => HeadPos | null, opts: { god: boolean; time: string; hidden: boolean }): void;
  dispose(): void;
}

/** 頭からアイコンの中心までの高さ（px）。吹き出しはこの上に出す */
export const ICON_LIFT_PX = 34;

export function createFigureIcons(climbers: readonly ClimberState[]): FigureIcons {
  const host = el('div', { class: 'fig-icons' });
  const items = new Map<string, { b: HTMLButtonElement; ring: HTMLElement }>();
  let latest: World | null = null;
  let god = true;
  let time = '';
  for (const c of climbers) {
    const ring = el('span', { class: 'fig-hp' });
    const b = el('button', { class: 'fig-icon', type: 'button', title: fill(JA.logDetail.iconTitle, { name: c.def.name }), 'aria-label': fill(JA.logDetail.iconTitle, { name: c.def.name }) }, [avatar(c.def, 40), ring]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const cs = latest?.climbers.find((x) => x.id === c.id);
      if (!cs) return;
      openLogDetail({ who: cs.def, time, text: '', snap: snapOf(cs), god, anchor: b, note: JA.logDetail.nowNote });
    });
    // 3D 画面のドラッグ操作に渡さない
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.append(b);
    items.set(c.id, { b, ring });
  }
  return {
    el: host,
    update(world, head, o) {
      latest = world;
      god = o.god;
      time = o.time;
      host.hidden = o.hidden;
      if (o.hidden) return;
      for (const c of world.climbers) {
        const it = items.get(c.id);
        if (!it) continue;
        const h = head(c.id);
        const show = !!h && h.front && h.inView;
        it.b.hidden = !show;
        if (!show || !h) continue;
        it.b.style.transform = `translate(${Math.round(h.x - 22)}px, ${Math.round(h.y - ICON_LIFT_PX - 22)}px)`;
        it.b.classList.toggle('occluded', h.occluded);
        it.b.classList.toggle('dead', !c.body.alive);
        const hp = hpOf(c.body);
        it.ring.style.setProperty('--hp', String(hp / 100));
        it.ring.dataset['lv'] = hpLevel(hp);
      }
    },
    dispose() {
      host.remove();
    },
  };
}

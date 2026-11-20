/**
 * 3D 画面で、登山者の頭の上に顔アイコンを出す。押すと、その人のいまの状態をポップアップで出す。
 * 位置は毎フレーム、頭の画面上の位置（SceneView.headScreen）に合わせる。地形に隠れているときは薄くする。
 * 人数の多いシナリオでは、画面の上で近くにいる同じ列の人を 5 人までひとつのアイコンにまとめる（ユーザーの指定）。
 * まとめたアイコンを押すと、その人たちの顔が並び、一人を選ぶとその人の状態を出す。
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { ClimberState, World } from '../sim/types';
import { avatar } from './avatar';
import { clusterHeads } from './figureCluster';
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
/** この人数以上のシナリオで、顔アイコンをまとめる */
const CLUSTER_MIN_PARTY = 10;
/** ひとつにまとめる人数の上限 */
const CLUSTER_MAX = 5;
/** まとめる相手の、最初の人からの画面上の距離（px） */
const CLUSTER_RADIUS_PX = 64;
/** アイコンの半分の大きさ（px）。中心を頭の上に合わせる */
const HALF_PX = 22;

interface Cluster {
  b: HTMLButtonElement;
  ring: HTMLElement;
  count: HTMLElement;
  sig: string;
  ids: string[];
  x: number;
  y: number;
}

export function createFigureIcons(climbers: readonly ClimberState[]): FigureIcons {
  const host = el('div', { class: 'fig-icons' });
  const items = new Map<string, { b: HTMLButtonElement; ring: HTMLElement }>();
  const defs = new Map(climbers.map((c) => [c.id, c.def]));
  const clusterOn = climbers.length >= CLUSTER_MIN_PARTY;
  const clusters = new Map<string, Cluster>();
  let latest: World | null = null;
  let god = true;
  let time = '';

  const showDetail = (id: string, anchor: HTMLElement): void => {
    const cs = latest?.climbers.find((x) => x.id === id);
    if (!cs) return;
    openLogDetail({ who: cs.def, time, text: '', snap: snapOf(cs), god, anchor, note: JA.logDetail.nowNote });
  };
  const noDrag = (b: HTMLElement): void => b.addEventListener('pointerdown', (e) => e.stopPropagation());

  for (const c of climbers) {
    const ring = el('span', { class: 'fig-hp' });
    const b = el('button', { class: 'fig-icon', type: 'button', title: fill(JA.logDetail.iconTitle, { name: c.def.name }), 'aria-label': fill(JA.logDetail.iconTitle, { name: c.def.name }) }, [avatar(c.def, 40), ring]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      showDetail(c.id, b);
    });
    // 3D 画面のドラッグ操作に渡さない
    noDrag(b);
    host.append(b);
    items.set(c.id, { b, ring });
  }

  // ---- まとめたアイコンを押したときの、顔の一覧 ----
  let pop: { el: HTMLElement; key: string; sig: string; rings: Map<string, { b: HTMLElement; ring: HTMLElement }> } | null = null;
  const closePop = (): void => {
    pop?.el.remove();
    pop = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (e: PointerEvent): void => {
    if (pop && !pop.el.contains(e.target as Node) && !clusters.get(pop.key)?.b.contains(e.target as Node)) closePop();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && pop) {
      e.stopPropagation();
      closePop();
    }
  };
  const openPop = (key: string): void => {
    const cl = clusters.get(key);
    if (!cl) return;
    const rings = new Map<string, { b: HTMLElement; ring: HTMLElement }>();
    const list = el('div', { class: 'fig-pop', role: 'dialog', 'aria-label': fill(JA.logDetail.clusterTitle, { n: cl.ids.length }) },
      cl.ids.map((id) => {
        const d = defs.get(id)!;
        const ring = el('span', { class: 'fig-hp' });
        const b = el('button', { class: 'fig-pop-item', type: 'button', title: fill(JA.logDetail.iconTitle, { name: d.name }) }, [el('span', { class: 'fig-pop-face' }, [avatar(d, 36), ring]), el('span', { class: 'fig-pop-name' }, d.name)]);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const anchor = cl.b;
          closePop();
          showDetail(id, anchor);
        });
        noDrag(b);
        rings.set(id, { b, ring });
        return b;
      }),
    );
    noDrag(list);
    host.append(list);
    pop = { el: list, key, sig: cl.sig, rings };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  };

  const clusterEl = (key: string): Cluster => {
    let cl = clusters.get(key);
    if (cl) return cl;
    const ring = el('span', { class: 'fig-hp' });
    const count = el('span', { class: 'fig-count' });
    const b = el('button', { class: 'fig-icon fig-cluster', type: 'button' }, [ring, count]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pop?.key === key) closePop();
      else {
        closePop();
        openPop(key);
      }
    });
    noDrag(b);
    host.append(b);
    cl = { b, ring, count, sig: '', ids: [], x: 0, y: 0 };
    clusters.set(key, cl);
    return cl;
  };

  /** まとめたアイコンの中身（後ろに 2 人、前に最初の人）を、顔ぶれが変わったときだけ作り直す */
  const fillCluster = (cl: Cluster, ids: string[]): void => {
    const sig = ids.join(',');
    if (cl.sig === sig) return;
    cl.sig = sig;
    cl.ids = ids;
    const names = ids.map((id) => defs.get(id)!.name).join('・');
    const label = `${fill(JA.logDetail.clusterTitle, { n: ids.length })}: ${names}`;
    cl.b.title = label;
    cl.b.setAttribute('aria-label', label);
    for (const f of Array.from(cl.b.querySelectorAll('.fig-back, .fig-front'))) f.remove();
    const backs = ids.slice(1, 3).map((id, k) => el('span', { class: `fig-back b${k + 1}` }, avatar(defs.get(id)!, 32)));
    cl.b.prepend(...backs.reverse(), el('span', { class: 'fig-front' }, avatar(defs.get(ids[0]!)!, 40)));
    cl.count.textContent = String(ids.length);
  };

  return {
    el: host,
    update(world, head, o) {
      latest = world;
      god = o.god;
      time = o.time;
      host.hidden = o.hidden;
      if (o.hidden) {
        closePop();
        return;
      }
      const pos = new Map<string, HeadPos>();
      for (const c of world.climbers) {
        const h = head(c.id);
        if (h && h.front && h.inView) pos.set(c.id, h);
      }
      const groups = clusterOn ? clusterHeads(world.climbers.map((c) => ({ id: c.id, groupId: c.groupId, alive: c.body.alive })), pos, CLUSTER_MAX, CLUSTER_RADIUS_PX) : [];
      const inCluster = new Set(groups.flat());
      const byId = new Map(world.climbers.map((c) => [c.id, c]));

      for (const c of world.climbers) {
        const it = items.get(c.id);
        if (!it) continue;
        const h = pos.get(c.id);
        const show = !!h && !inCluster.has(c.id);
        it.b.hidden = !show;
        if (!show || !h) continue;
        it.b.style.transform = `translate(${Math.round(h.x - HALF_PX)}px, ${Math.round(h.y - ICON_LIFT_PX - HALF_PX)}px)`;
        it.b.classList.toggle('occluded', h.occluded);
        it.b.classList.toggle('dead', !c.body.alive);
        const hp = hpOf(c.body);
        it.ring.style.setProperty('--hp', String(hp / 100));
        it.ring.dataset['lv'] = hpLevel(hp);
      }

      const live = new Set<string>();
      for (const ids of groups) {
        const key = ids[0]!;
        live.add(key);
        const cl = clusterEl(key);
        fillCluster(cl, ids);
        let x = 0;
        let y = 0;
        let occluded = true;
        let worst = 100;
        for (const id of ids) {
          const h = pos.get(id)!;
          x += h.x;
          y += h.y;
          occluded &&= h.occluded;
          worst = Math.min(worst, hpOf(byId.get(id)!.body));
        }
        cl.x = x / ids.length;
        cl.y = y / ids.length - ICON_LIFT_PX;
        cl.b.hidden = false;
        cl.b.style.transform = `translate(${Math.round(cl.x - HALF_PX)}px, ${Math.round(cl.y - HALF_PX)}px)`;
        cl.b.classList.toggle('occluded', occluded);
        cl.b.classList.toggle('dead', !byId.get(key)!.body.alive);
        // 輪は、まとめた中で一番弱っている人の体力
        cl.ring.style.setProperty('--hp', String(worst / 100));
        cl.ring.dataset['lv'] = hpLevel(worst);
      }
      for (const [key, cl] of clusters) if (!live.has(key)) cl.b.hidden = true;

      // 顔の一覧は、まとめたアイコンについて動く。顔ぶれが変わったら閉じる
      if (pop) {
        const cl = clusters.get(pop.key);
        if (!cl || cl.b.hidden || cl.sig !== pop.sig) closePop();
        else {
          const w = pop.el.offsetWidth;
          const maxX = host.clientWidth - w - 4;
          pop.el.style.transform = `translate(${Math.round(Math.max(4, Math.min(maxX, cl.x - w / 2)))}px, ${Math.round(cl.y + HALF_PX + 6)}px)`;
          for (const [id, r] of pop.rings) {
            const c = byId.get(id);
            if (!c) continue;
            const hp = hpOf(c.body);
            r.ring.style.setProperty('--hp', String(hp / 100));
            r.ring.dataset['lv'] = hpLevel(hp);
            r.b.classList.toggle('dead', !c.body.alive);
          }
        }
      }
    },
    dispose() {
      closePop();
      host.remove();
    },
  };
}

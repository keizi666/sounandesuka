/**
 * 重要な出来事を画面の中央に大きく出す（ユーザーの指定: 「雪崩が発生した！！」のように、効果音つきで。そのあとに選択肢を出す。
 * ログに文が出るだけでは何が起きたのか分かりにくい）。
 * 出すのは事故（雪崩・流された・転倒や転落のけが・落雷・熊・急病・道迷いに気づいた・高地脳浮腫）。亡くなったことは大きく出さない（静かに表す方針）。
 * 1 つずつ順に出し（2.4 秒）、出している間に分岐点が来たら、出し終えてから選択肢を開く（whenIdle）。
 */
import { fill } from '../i18n/format';
import { JA } from '../i18n/ja';
import type { SimEvent, World } from '../sim/types';
import { audio } from './audio';
import { el } from './dom';

const SHOW_MS = 2400;

export interface AlertSpec {
  title: string;
  sub?: string;
  tone: 'danger' | 'warn';
  sound?: string;
}

/** 出来事から、中央に出す見出し（出さないものは null） */
export function alertOf(e: SimEvent, world: World): AlertSpec | null {
  const A = JA.alert;
  const d = e.data ?? {};
  const who = world.climbers.find((c) => c.id === e.climberId)?.def.name ?? '';
  const injury = typeof d['injury'] === 'string' ? (JA.labels.injury[d['injury']] ?? '') : '';
  switch (e.type) {
    case 'SCRIPT_LOG':
      if (typeof d['avalanche'] === 'number' && d['avalanche'] > 0) return { title: A.avalanche, sub: fill(A.avalancheSub, { names: String(d['names'] ?? '') }), tone: 'danger', sound: 'bass-drop' };
      if (typeof d['swept'] === 'string') return { title: fill(A.swept, { who }), sub: String(d['swept']), tone: 'danger', sound: 'water-drop' };
      if (typeof d['bearAttack'] === 'string') return { title: fill(A.bear, { who }), tone: 'danger' };
      if (d['illnessOnset'] || d['anaphylaxisOnset']) return { title: fill(A.illness, { who }), tone: 'danger' };
      if (d['ams'] === 'hace') return { title: fill(A.hace, { who }), sub: A.haceSub, tone: 'danger', sound: 'heartbeat' };
      return null;
    case 'FALL':
    case 'GUST_FALL': {
      const k = d['injury'];
      // けがのない転倒・打ち身は大きく出さない
      if (!k || k === 'none' || k === 'bruise') return null;
      // シナリオの滑落（効果 fall）・落石・渡渉で足を取られた・ふつうの転倒で見出しを分ける
      const title = d['rockfall'] ? A.rockfall : d['slipped'] ? A.slipped : d['event'] ? A.fall : k === 'sprain' ? A.fallLight : A.trip;
      return { title: fill(title, { who }), sub: injury, tone: k === 'sprain' ? 'warn' : 'danger' };
    }
    case 'LIGHTNING_STRIKE':
      return { title: fill(A.lightning, { who }), tone: 'danger' };
    case 'LOST_AWARE':
      return { title: fill(A.lost, { who }), sub: A.lostSub, tone: 'warn', sound: 'heartbeat' };
    default:
      return null;
  }
}

export interface EventAlerts {
  /** 出来事を受け取って、出すものがあれば順番に出す */
  push(e: SimEvent, world: World): void;
  /** いま何か出しているか */
  busy(): boolean;
  /** 出し終えたら cb を呼ぶ（出していなければすぐ） */
  whenIdle(cb: () => void): void;
  dispose(): void;
}

export function createEventAlerts(host: HTMLElement): EventAlerts {
  const queue: AlertSpec[] = [];
  let showing: HTMLElement | null = null;
  let timer = 0;
  let waiters: (() => void)[] = [];
  const next = (): void => {
    showing?.remove();
    showing = null;
    const a = queue.shift();
    if (!a) {
      const w = waiters;
      waiters = [];
      for (const cb of w) cb();
      return;
    }
    showing = el('div', { class: `ev-alert tone-${a.tone}`, role: 'alert' }, [el('strong', {}, a.title), a.sub ? el('small', {}, a.sub) : null]);
    host.append(showing);
    if (a.sound) audio().play(a.sound, 1);
    timer = window.setTimeout(next, SHOW_MS);
  };
  return {
    push(e, world) {
      const a = alertOf(e, world);
      if (!a) return;
      // 同じ見出しが続けて来たら（同じ雪崩で何人も など）1 つにまとめる
      if (queue.some((q) => q.title === a.title)) return;
      queue.push(a);
      if (!showing) next();
    },
    busy: () => showing !== null || queue.length > 0,
    whenIdle(cb) {
      if (showing === null && queue.length === 0) cb();
      else waiters.push(cb);
    },
    dispose() {
      window.clearTimeout(timer);
      showing?.remove();
      queue.length = 0;
      waiters = [];
    },
  };
}

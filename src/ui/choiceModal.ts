/**
 * 分岐点のモーダル（docs/11 §3、FR-20〜22）。状況の文・把握していること・選択肢（無効な理由つき）・
 * 観察者メモ（神の視点だけ）・判断時間制限モードの残り時間。↑↓ と Enter で選べる。
 */
import { icon } from './icons';
import { JA } from '../i18n/ja';
import { fill, formatDateTime, TEXT_LABELS } from '../i18n/format';
import { choiceLeader, evaluateOptions, findChoicePoint } from '../sim/scenario/choices';
import { expandText } from '../sim/scenario/text';
import { resolveVar } from '../sim/scenario/vars';
import type { ClimberState, StaticContext, World } from '../sim/types';
import { effectiveKeyframes, interpolateKeyframes } from '../sim/weather/global';
import { el } from './dom';

export interface ChoiceUi {
  close(): void;
}

/** 汎用分岐点の文は i18n、シナリオの上書きがあればそちら */
function texts(ctx: StaticContext, cpId: string): { title: string; situation: string; label: (id: string, fallback: string) => string } {
  const found = findChoicePoint(ctx, cpId)!;
  if (cpId.startsWith('generic:')) {
    const g = JA.generic[cpId.slice(8)];
    return {
      title: g?.title ?? cpId,
      situation: found.cp.situation || g?.situation || '',
      label: (id, fb) => fb || g?.options[id] || id,
    };
  }
  return { title: found.cp.title, situation: found.cp.situation, label: (_id, fb) => fb };
}

/** 観察者メモ: 今後 1 時間の最大風速など（キーフレームから自動生成） */
function observerNote(world: World, ctx: StaticContext): string {
  const kfs = effectiveKeyframes(world, ctx.scenario);
  let wind = 0;
  let precip = 0;
  let temp = Infinity;
  for (let m = 0; m <= 60; m += 10) {
    const b = interpolateKeyframes(kfs, world.tMin + m);
    wind = Math.max(wind, b.windMs);
    precip = Math.max(precip, b.precipMmH);
    temp = Math.min(temp, b.tempC);
  }
  return `この先 1 時間: 風 最大 ${wind.toFixed(0)} m/s、降水 最大 ${precip.toFixed(1)} mm/h、基準標高の気温 ${temp.toFixed(1)}℃（山頂はさらに低い）`;
}

/** 判断する人: リーダーがけが（頭・骨折・重いけが）・急病の発作・意識なしなら、同じグループで元気な人（判断力のいちばん高い人） */
/** 分岐点で決める人（リーダー。判断できない状態なら、判断力のいちばん高い仲間） */
export function deciderOf(world: World, leader: ClimberState): ClimberState {
  const unable = (c: ClimberState): boolean =>
    !c.body.alive || !c.body.conscious || c.body.illness?.active === true || ['headInjury', 'legFracture', 'severeTrauma'].includes(c.body.injury) || c.state === 'INCAPACITATED' || c.state === 'UNCONSCIOUS';
  if (!unable(leader)) return leader;
  const others = world.climbers.filter((c) => c !== leader && c.groupId === leader.groupId && !unable(c));
  return others.length > 0 ? others.reduce((a, b) => (b.J > a.J ? b : a)) : leader;
}

export function showChoice(
  host: HTMLElement,
  world: World,
  ctx: StaticContext,
  opts: { god: boolean; timeoutSec: number | null; onPick: (optionId: string) => void },
): ChoiceUi {
  const pending = world.pendingChoice!;
  const found = findChoicePoint(ctx, pending.cpId)!;
  const t = texts(ctx, pending.cpId);
  const leader = choiceLeader(world, ctx);
  const scope = { world, map: ctx.map, scenario: ctx.scenario, leader };
  const expand = (s: string): string => expandText(s, (p) => resolveVar(p, scope), TEXT_LABELS);
  const { available, unavailable } = evaluateOptions(world, ctx, found.cp, found.key);
  const avail = new Set(available.map((a) => a.option.id));
  let done = false;
  const buttons: HTMLButtonElement[] = [];
  const pick = (id: string, btn: HTMLButtonElement): void => {
    if (done) return;
    done = true;
    btn.classList.add('chosen');
    setTimeout(() => {
      close();
      opts.onPick(id);
    }, 1000);
  };
  // 史実のシナリオ: 実際の遭難で選ばれた選択（ユーザーの指定）。その選択肢に印を付け、上にも一行で出す
  const recorded = ctx.scenario.historical?.recordedChoices[pending.cpId];
  const recordedOpt = recorded ? found.cp.options.find((o) => o.id === recorded) : undefined;
  const options = found.cp.options
    .filter((o) => avail.has(o.id) || !o.hideIfUnavailable || o.id === recorded)
    .map((o) => {
      const ok = avail.has(o.id);
      const isRec = o.id === recorded;
      const b = el('button', { class: `option${isRec ? ' recorded' : ''}`, disabled: !ok, onclick: () => pick(o.id, b) }, [
        el('span', { class: 'opt-text' }, [
          isRec ? el('span', { class: 'rec-badge' }, [icon('history'), JA.ui.recordedBadge]) : null,
          el('strong', {}, t.label(o.id, o.label)),
          o.detail ? el('span', {}, expand(o.detail)) : null,
          !ok ? el('small', {}, o.unavailableText ?? '今は選べない') : null,
        ]),
        ok ? el('span', { class: 'opt-go' }, icon('chevronRight')) : null,
      ]);
      if (ok) buttons.push(b);
      return b;
    });
  void unavailable;
  const timer = el('div', { class: 'timer' });
  const modal = el('div', { class: 'choice', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title }, [
    // 誰の判断かを見出しに出す（ユーザーの指定）
    el('header', {}, [el('h2', {}, [`◆ `, el('span', { class: 'decider' }, `${deciderOf(world, leader).def.name}: `), t.title]), el('span', {}, formatDateTime(ctx.scenario, world.tMin))]),
    el('p', { class: 'situation' }, expand(t.situation)),
    found.cp.knowledge?.length
      ? el('div', { class: 'knowledge' }, [el('h3', {}, fill(JA.ui.knowledge, { name: deciderOf(world, leader).def.name })), el('ul', {}, found.cp.knowledge.map((k) => el('li', {}, expand(k))))])
      : null,
    recordedOpt ? el('p', { class: 'recorded-line' }, [icon('history'), fill(JA.ui.recordedLine, { label: t.label(recordedOpt.id, recordedOpt.label) })]) : null,
    el('p', { class: 'options-head' }, JA.ui.chooseAction),
    el('div', { class: 'options' }, options),
    opts.timeoutSec !== null ? timer : null,
    opts.god ? el('details', { class: 'observer' }, [el('summary', {}, JA.ui.observerNote), el('p', {}, observerNote(world, ctx))]) : null,
  ]);
  host.append(modal);
  buttons[0]?.focus();
  let focus = 0;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      focus = (focus + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % Math.max(1, buttons.length);
      buttons[focus]?.focus();
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey);
  let interval = 0;
  if (opts.timeoutSec !== null) {
    const end = performance.now() + opts.timeoutSec * 1000;
    interval = window.setInterval(() => {
      const left = Math.max(0, (end - performance.now()) / 1000);
      timer.textContent = fill(JA.ui.remaining, { s: Math.ceil(left) });
      timer.style.setProperty('--frac', String(left / opts.timeoutSec!));
      if (left <= 0 && !done) {
        done = true;
        close();
        opts.onPick('');
      }
    }, 200);
  }
  function close(): void {
    clearInterval(interval);
    document.removeEventListener('keydown', onKey);
    modal.remove();
  }
  return { close };
}

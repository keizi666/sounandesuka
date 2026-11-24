/**
 * 挑戦状（ユーザーの指定: リピーターを増やす）。結果の画面から、同じシナリオ・同じ乱数の種（同じ天気・同じ巡り合わせ）で友だちを誘う。
 * - 送る: 挑戦状を作り（プロフィールが要る。答えが届く先）、?brief=<ID>&ch=<鍵>&seed=<種> の短い URL を共有のボタンで送る
 * - 受ける: そのリンクから遊ぶと、始まりに「〇〇さんからの挑戦状」、結果の画面に「結果を届ける」。押すと結末と選択の要約が送った人に届く
 *   （みんなの遭難記録に載せなくても届けられる。押したときだけ送る）
 * - 届いた答えは、送った人のトップページの「お知らせ」に出る（notices.ts）
 */
import type { LoadedScenario } from '../../app/data';
import { BRIEF_PARAM } from '../../app/shareState';
import { APP_VERSION } from '../../app/version';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ChallengeInfo } from '../../net/communityTypes';
import { runSummary } from '../../net/recordPack';
import { loadProfile } from '../../net/profile';
import { shortTarget } from '../../net/shareLink';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { shareButtons } from '../shareButtons';
import { optionLabel, type SimResult } from '../simCommon';
import { errorText } from './common';
import { openProfileDialog } from './profileDialog';

const infoCache = new Map<string, Promise<ChallengeInfo | null>>();

/** 挑戦状の中身（読めなければ null。同じ鍵は 1 度だけ読む） */
export function challengeInfo(k: string): Promise<ChallengeInfo | null> {
  let p = infoCache.get(k);
  if (!p) {
    p = communityApi
      .challengeInfo(k)
      .then((r) => r.challenge)
      .catch(() => null);
    infoCache.set(k, p);
  }
  return p;
}

/** 挑戦状から始めたときの知らせ（遊ぶ画面の始まりに） */
export function announceChallenge(loaded: LoadedScenario): void {
  if (!loaded.challenge) return;
  void challengeInfo(loaded.challenge).then((c) => {
    if (c) toast(`${fill(JA.social.challengeFrom, { who: c.from.nickname })}${c.text ? `: ${c.text}` : ''}`, 9000);
  });
}

/** 載せる記録と同じ要約（挑戦状の答えに使う） */
function summaryOf(loaded: LoadedScenario, result: SimResult, ending: { kind: string; title: string }) {
  const s = loaded.scenario;
  const w = result.world;
  const rec = result.recorder.record;
  return runSummary({
    scenario: s,
    rec,
    ending,
    startMin: rec.samples[0]?.t ?? w.tMin,
    endMin: w.ended?.atMin ?? w.tMin,
    deaths: w.climbers.filter((c) => !c.body.alive).length,
    conditions: !!loaded.conditions,
    appVersion: APP_VERSION,
    difficulty: result.difficulty,
    week: loaded.week,
    label: (cp, op) => optionLabel(loaded, cp, op),
    title: (cp, fb) => (cp.startsWith('generic:') ? (JA.generic[cp.slice(8)]?.title ?? fb) : (s.choices.find((c) => c.id === cp)?.title ?? fb)),
  });
}

/** 結果の画面の「挑戦状に答える」（挑戦状から遊んだときだけ） */
export function answerCard(loaded: LoadedScenario, result: SimResult, ending: { kind: string; title: string }): HTMLElement | null {
  const k = loaded.challenge;
  if (!k || result.shared) return null;
  const S = JA.social;
  const lead = el('p', { class: 'cm-note' }, '');
  const btn = el('button', { class: 'primary', type: 'button', disabled: true }, [icon('mail'), S.answerBtn]) as HTMLButtonElement;
  const card = el('section', { class: 'bf-card ch-card' }, [el('h2', {}, [icon('mail'), S.answerTitle]), lead, el('div', { class: 'cm-post-actions' }, btn)]);
  void challengeInfo(k).then((c) => {
    if (!c) return card.remove();
    const mine = loadProfile()?.user.id === c.from.id;
    if (mine) return card.remove();
    lead.textContent = fill(S.answerLead, { who: c.from.nickname });
    btn.disabled = false;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await communityApi.answer(k, summaryOf(loaded, result, ending));
        card.replaceChildren(el('h2', {}, [icon('mail'), S.answerTitle]), el('p', { class: 'cm-note' }, fill(S.answered, { who: c.from.nickname })));
      } catch (e) {
        btn.disabled = false;
        toast(errorText(e), 6000);
      }
    });
  });
  return card;
}

/** 結果の画面の「挑戦状を送る」（公開のシナリオだけ） */
export function challengeSendCard(loaded: LoadedScenario, result: SimResult, ending: { kind: string; title: string }): HTMLElement | null {
  if (!loaded.listed || result.shared) return null;
  const S = JA.social;
  const s = loaded.scenario;
  const body = el('div', { class: 'ch-body' });
  const card = el('section', { class: 'bf-card ch-card' }, [el('h2', {}, [icon('mail'), S.challengeTitle]), el('p', { class: 'cm-note' }, S.challengeLead), body]);
  const form = (): void => {
    if (!loadProfile()) {
      body.replaceChildren(el('p', { class: 'cm-note' }, S.challengeNeedProfile), el('button', { type: 'button', class: 'cm-who empty', onclick: () => openProfileDialog(() => form()) }, JA.community.makeProfile));
      return;
    }
    const text = el('input', { type: 'text', class: 'ch-text', maxlength: 140, value: fill(S.challengeText, { scenario: s.title, ending: ending.title }) }) as HTMLInputElement;
    const make = el('button', { class: 'primary', type: 'button' }, [icon('mail'), S.challengeMake]) as HTMLButtonElement;
    make.addEventListener('click', async () => {
      make.disabled = true;
      try {
        const { k } = await communityApi.challenge(s.id, text.value.trim());
        const u = new URL(import.meta.env.BASE_URL, location.origin);
        u.searchParams.set(BRIEF_PARAM, s.id);
        u.searchParams.set('ch', k);
        u.searchParams.set('seed', String(result.world.seed));
        if (loaded.week) u.searchParams.set('week', String(loaded.week));
        body.replaceChildren(el('p', { class: 'cm-note' }, S.challengeMade), shareButtons(shortTarget({ text: text.value.trim(), url: u.href })));
      } catch (e) {
        make.disabled = false;
        toast(errorText(e), 6000);
      }
    });
    body.replaceChildren(text, el('div', { class: 'cm-post-actions' }, make));
  };
  form();
  return card;
}

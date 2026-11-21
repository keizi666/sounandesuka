/**
 * 結果の画面の「みんなの遭難記録に載せる」欄（docs/20_community.md §1）。
 * 載せるのは、ユーザーが押したときだけ。公開しているシナリオ（一覧にあるもの）の結果に限る。
 */
import type { AppContext } from '../../app/App';
import type { LoadedScenario } from '../../app/data';
import { loadIndex } from '../../app/data';
import { APP_VERSION } from '../../app/version';
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import { loadProfile, markPosted, postedRuns } from '../../net/profile';
import { packRecord, runSummary } from '../../net/recordPack';
import { checkComment, COMMENT_MAX } from '../../net/rules';
import { el, toast } from '../dom';
import { optionLabel, type SimResult } from '../simScreen';
import { cIcon, counted, errorText, sexAgeText, userAvatar } from './common';
import { openProfileDialog } from './profileDialog';

export function communityPostCard(app: AppContext, loaded: LoadedScenario, result: SimResult, ending: { kind: string; title: string }): HTMLElement {
  const C = JA.community;
  const s = loaded.scenario;
  const card = el('section', { class: 'bf-card cm-post' }, [el('h2', {}, [cIcon('forum'), C.postTitle])]);
  const body = el('div', { class: 'cm-post-body' }, el('p', { class: 'cm-note' }, C.loading));
  card.append(body);

  const doneView = (id: number): void => {
    body.replaceChildren(
      el('p', { class: 'cm-done' }, C.alreadyPosted),
      el('button', { class: 'cm-go', onclick: () => app.go({ name: 'communityRun', id }) }, [C.viewPosted, cIcon('chevronRight')]),
    );
  };

  const formView = (): void => {
    const prof = loadProfile();
    const text = el('textarea', { rows: 3, maxlength: COMMENT_MAX * 2, placeholder: fill(C.commentPh, { n: COMMENT_MAX }) }) as HTMLTextAreaElement;
    const err = el('p', { class: 'cm-err', role: 'alert' });
    const who = prof
      ? el('button', { class: 'cm-who', type: 'button', title: C.profileTitle, onclick: () => openProfileDialog(() => formView()) }, [
          userAvatar(prof.user, 40),
          el('span', {}, [el('strong', {}, prof.user.nickname), el('small', {}, sexAgeText(prof.user))]),
          cIcon('personEdit'),
        ])
      : el('button', { class: 'cm-who empty', type: 'button', onclick: () => openProfileDialog(() => formView()) }, [cIcon('personEdit'), C.makeProfile]);
    const go = el('button', { class: 'primary', disabled: !prof }, [cIcon('send'), C.postBtn]) as HTMLButtonElement;
    go.addEventListener('click', async () => {
      const ce = checkComment(text.value);
      if (ce) {
        err.textContent = C.errors[ce] ?? '';
        return;
      }
      go.disabled = true;
      go.replaceChildren(C.posting);
      err.textContent = '';
      try {
        const w = result.world;
        const rec = result.recorder.record;
        const summary = runSummary({
          scenario: s,
          rec,
          ending,
          startMin: rec.samples[0]?.t ?? w.tMin,
          endMin: w.ended?.atMin ?? w.tMin,
          deaths: w.climbers.filter((c) => !c.body.alive).length,
          conditions: !!loaded.conditions,
          appVersion: APP_VERSION,
          difficulty: result.difficulty,
          label: (cp, op) => optionLabel(loaded, cp, op),
          title: (cp, fb) => (cp.startsWith('generic:') ? (JA.generic[cp.slice(8)]?.title ?? fb) : (s.choices.find((c) => c.id === cp)?.title ?? fb)),
        });
        const r = await communityApi.post(summary, await packRecord(rec), text.value.trim());
        markPosted(result.runId, r.id);
        toast(C.posted);
        doneView(r.id);
      } catch (x) {
        err.textContent = errorText(x);
        go.disabled = false;
        go.replaceChildren(cIcon('send'), C.postBtn);
      }
    });
    body.replaceChildren(
      el('p', { class: 'cm-note' }, C.postLead),
      el('div', { class: 'cm-post-row' }, [who, prof ? null : el('small', { class: 'cm-note' }, C.needProfile)]),
      el('div', { class: 'cm-text' }, [text, counted(text, COMMENT_MAX)]),
      err,
      el('div', { class: 'cm-post-actions' }, go),
    );
  };

  const posted = postedRuns()[result.runId];
  if (posted) doneView(posted);
  else
    void loadIndex()
      .then((idx) => {
        if (idx.some((e) => e.id === s.id)) formView();
        else body.replaceChildren(el('p', { class: 'cm-note' }, C.notListed));
      })
      .catch(() => body.replaceChildren(el('p', { class: 'cm-note' }, C.notListed)));
  return card;
}

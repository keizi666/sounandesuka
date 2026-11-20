/**
 * 「みんなの遭難記録」のプロフィール（作る・直す・引き継ぐ・消す）。docs/20_community.md §2。
 * アイコンは登山者の顔のイラスト（public/portraits）から選ぶ。
 */
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ProfileInput } from '../../net/communityTypes';
import { formatCode, loadProfile, parseCode, saveProfile, type LocalProfile } from '../../net/profile';
import { AGE_BANDS, checkNickname, NICK_MAX, PROFILE_COLORS, SEXES, type AgeBand, type Sex } from '../../net/rules';
import { parsePortrait, portraitCounts, PORTRAIT_GROUPS, type PortraitGroup } from '../avatar';
import { el, toast } from '../dom';
import { icon } from '../icons';
import { cIcon, counted, errorText, userAvatar } from './common';

const GROUP_LABEL: Record<PortraitGroup, string> = {
  child_m: '子ども・男', child_f: '子ども・女', young_m: '若者・男', young_f: '若者・女',
  mid_m: '中年・男', mid_f: '中年・女', senior_m: '高齢・男', senior_f: '高齢・女',
};

/** 年代と性別から、最初に見せる顔の区分 */
function groupFor(sex: Sex, age: AgeBand): PortraitGroup {
  const a = age === '10' ? 'child' : age === '20' || age === '30' ? 'young' : age === '60' || age === '70' ? 'senior' : 'mid';
  return `${a}_${sex === 'f' ? 'f' : 'm'}` as PortraitGroup;
}

/** 選択肢のボタンの列（ラジオの代わり） */
function segmented<T extends string>(values: readonly T[], label: (v: T) => string, value: T, onPick: (v: T) => void): HTMLElement {
  const box = el('div', { class: 'cm-seg', role: 'radiogroup' });
  const paint = (cur: T): void => {
    for (const b of box.children) b.setAttribute('aria-checked', String((b as HTMLElement).dataset['v'] === cur));
  };
  for (const v of values)
    box.append(el('button', { type: 'button', role: 'radio', 'data-v': v, onclick: () => {
      paint(v);
      onPick(v);
    } }, label(v)));
  paint(value);
  return box;
}

/** プロフィールの画面を開く。閉じたら、そのときのプロフィール（なければ null）で done を呼ぶ */
export function openProfileDialog(done?: (p: LocalProfile | null) => void): void {
  const C = JA.community;
  let current = loadProfile();
  const u = current?.user;
  const form: ProfileInput = {
    nickname: u?.nickname ?? '',
    sex: u?.sex ?? 'x',
    age: u?.age ?? 'x',
    portrait: u?.portrait ?? 'mid_m:1',
    color: u?.color ?? PROFILE_COLORS[0],
  };
  let group: PortraitGroup = parsePortrait(form.portrait)?.group ?? 'mid_m';
  let pickedFace = !!u;

  const preview = el('div', { class: 'cm-preview' });
  const paintPreview = (): void => preview.replaceChildren(userAvatar({ id: u?.id ?? 0, nickname: form.nickname || '?', portrait: form.portrait, color: form.color }, 84));
  const nick = el('input', { type: 'text', maxlength: NICK_MAX * 2, value: form.nickname, placeholder: fill(C.nickPh, { n: NICK_MAX }), autocomplete: 'nickname', oninput: () => {
    form.nickname = nick.value;
    paintPreview();
  } }) as HTMLInputElement;

  // 顔の一覧
  const groups = el('div', { class: 'cm-groups' });
  const faces = el('div', { class: 'cm-faces' });
  const paintFaces = (counts: Partial<Record<PortraitGroup, number>> | null): void => {
    groups.replaceChildren(...PORTRAIT_GROUPS.map((g) => el('button', { type: 'button', class: g === group ? 'on' : '', onclick: () => {
      group = g;
      paintFaces(counts);
    } }, GROUP_LABEL[g])));
    const n = counts?.[group] ?? 8;
    faces.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const v = `${group}:${i + 1}`;
      return el('button', { type: 'button', class: `cm-face${v === form.portrait ? ' on' : ''}`, 'aria-label': `${GROUP_LABEL[group]} ${i + 1}`, onclick: () => {
        form.portrait = v;
        pickedFace = true;
        paintFaces(counts);
        paintPreview();
      } }, userAvatar({ id: 0, nickname: '', portrait: v, color: form.color }, 48));
    }));
  };
  let counts: Partial<Record<PortraitGroup, number>> | null = null;
  void portraitCounts().then((c) => {
    counts = c;
    paintFaces(c);
  });
  paintFaces(null);
  /** 年代・性別を選んだら、まだ顔を選んでいなければ、それに合う区分を見せる */
  const followGroup = (): void => {
    if (pickedFace) return;
    group = groupFor(form.sex, form.age);
    form.portrait = `${group}:1`;
    paintFaces(counts);
    paintPreview();
  };
  const colors = el('div', { class: 'cm-colors' });
  const paintColors = (): void =>
    colors.replaceChildren(...PROFILE_COLORS.map((c) => el('button', { type: 'button', class: `cm-color${c === form.color ? ' on' : ''}`, style: `--sw:${c}`, 'aria-label': c, onclick: () => {
      form.color = c;
      paintColors();
      paintPreview();
      paintFaces(counts);
    } })));
  paintColors();
  paintPreview();

  const err = el('p', { class: 'cm-err', role: 'alert' });
  const busy = (b: boolean): void => {
    dlg.classList.toggle('busy', b);
  };
  const close = (): void => dlg.close();

  const submit = async (): Promise<void> => {
    const e = checkNickname(form.nickname);
    if (e) {
      err.textContent = C.errors[e] ?? '';
      nick.focus();
      return;
    }
    err.textContent = '';
    busy(true);
    try {
      const p: ProfileInput = { ...form, nickname: form.nickname.trim() };
      if (current) {
        const r = await communityApi.updateProfile(p);
        current = { token: current.token, user: r.user };
      } else {
        const r = await communityApi.register(p);
        current = { token: r.token, user: r.user };
      }
      saveProfile(current);
      toast(C.saved);
      close();
    } catch (x) {
      err.textContent = errorText(x);
    } finally {
      busy(false);
    }
  };

  // 引き継ぎコード
  const codeBox = el('section', { class: 'cm-code' });
  if (current) {
    const code = formatCode(current.token);
    const shown = el('code', { class: 'cm-code-text' }, '••••••-••••••-••••••-••••••');
    codeBox.append(
      el('h3', {}, [cIcon('key'), C.codeTitle]),
      el('p', { class: 'cm-note' }, C.codeLead),
      el('div', { class: 'cm-code-row' }, [
        shown,
        el('button', { type: 'button', class: 'small', onclick: () => (shown.textContent = code) }, C.codeShow),
        el('button', { type: 'button', class: 'small', onclick: () => void navigator.clipboard?.writeText(code).then(() => toast(C.copied)) }, [cIcon('contentCopy'), C.copy]),
      ]),
      el('div', { class: 'cm-danger' }, [
        el('button', { type: 'button', class: 'small', onclick: () => {
          if (!confirm(C.signOutConfirm)) return;
          saveProfile(null);
          current = null;
          close();
        } }, C.signOut),
        el('button', { type: 'button', class: 'small danger', onclick: async () => {
          if (!confirm(C.forgetConfirm)) return;
          busy(true);
          try {
            await communityApi.forget();
            saveProfile(null);
            current = null;
            toast(C.forgotten);
            close();
          } catch (x) {
            err.textContent = errorText(x);
          } finally {
            busy(false);
          }
        } }, [cIcon('delete'), C.forget]),
      ]),
    );
  } else {
    const input = el('input', { type: 'text', placeholder: C.codePh, autocomplete: 'off', spellcheck: false }) as HTMLInputElement;
    codeBox.append(
      el('details', {}, [
        el('summary', {}, [cIcon('key'), C.useCode]),
        el('div', { class: 'cm-code-row' }, [
          input,
          el('button', { type: 'button', onclick: async () => {
            const t = parseCode(input.value);
            if (!t) {
              err.textContent = C.codeBad;
              return;
            }
            busy(true);
            try {
              const r = await communityApi.me(t);
              current = { token: t, user: r.user };
              saveProfile(current);
              toast(C.codeOk);
              close();
            } catch (x) {
              err.textContent = errorText(x);
            } finally {
              busy(false);
            }
          } }, C.codeApply),
        ]),
      ]),
    );
  }

  const base = import.meta.env.BASE_URL;
  const field = (label: string, ctrl: HTMLElement | HTMLElement[]): HTMLElement => el('div', { class: 'cm-field' }, [el('span', { class: 'cm-label' }, label), ...(Array.isArray(ctrl) ? ctrl : [ctrl])]);
  const dlg = el('dialog', { class: 'cm-dialog' }, [
    el('header', { class: 'cm-dlg-head' }, [
      el('h2', {}, [cIcon('personEdit'), current ? C.profileTitle : C.profileNew]),
      el('button', { class: 'icon cm-x', type: 'button', title: `${JA.ui.close} (Esc)`, 'aria-label': JA.ui.close, onclick: close }, icon('close')),
    ]),
    el('div', { class: 'cm-dlg-body' }, [
      el('div', { class: 'cm-top' }, [preview, el('div', { class: 'cm-top-fields' }, [field(C.nickname, [nick, counted(nick, NICK_MAX)])])]),
      field(C.sex, segmented(SEXES, (v) => C.sexes[v] ?? v, form.sex, (v) => {
        form.sex = v;
        followGroup();
      })),
      field(C.age, segmented(AGE_BANDS, (v) => C.ages[v] ?? v, form.age, (v) => {
        form.age = v;
        followGroup();
      })),
      field(C.icon, [groups, faces]),
      field(C.color, colors),
      el('p', { class: 'cm-note' }, C.publicNote),
      err,
      el('div', { class: 'cm-dlg-actions' }, [
        el('button', { type: 'button', onclick: close }, C.cancel),
        el('button', { type: 'button', class: 'primary', onclick: () => void submit() }, current ? C.save : C.agree),
      ]),
      current ? null : el('p', { class: 'cm-note center' }, [el('a', { href: `${base}legal/terms.html`, target: '_blank', rel: 'noopener' }, C.termsLink), ' ・ ', el('a', { href: `${base}legal/privacy.html`, target: '_blank', rel: 'noopener' }, C.privacyLink)]),
      codeBox,
    ]),
  ]);
  dlg.addEventListener('close', () => {
    dlg.remove();
    done?.(current);
  });
  document.body.append(dlg);
  dlg.showModal();
}

/**
 * 「みんなの遭難記録」のプロフィール（作る・直す・引き継ぐ・消す）。docs/20_community.md §2。
 * アイコンは、登山者の顔のイラスト・絵文字・アップロードした画像から選ぶ（iconPicker）。
 */
import { JA } from '../../i18n/ja';
import { fill } from '../../i18n/format';
import { communityApi } from '../../net/communityApi';
import type { ProfileInput } from '../../net/communityTypes';
import { formatCode, loadProfile, parseCode, saveProfile, type LocalProfile } from '../../net/profile';
import { AGE_BANDS, checkNickname, NICK_MAX, PROFILE_COLORS, SEXES } from '../../net/rules';
import { el, toast } from '../dom';
import { icon } from '../icons';
import type { CroppedImage } from './avatarCrop';
import { cIcon, counted, errorText, userAvatar } from './common';
import { iconPicker } from './iconPicker';

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
  /** 選んだが、まだ送っていない画像 */
  let pendingImage: CroppedImage | null = null;

  const preview = el('div', { class: 'cm-preview' });
  const paintPreview = (): void =>
    preview.replaceChildren(userAvatar({ id: u?.id ?? 0, nickname: form.nickname || '?', portrait: form.portrait === 'img:new' ? 'mid_m:1' : form.portrait, color: form.color }, 84, form.portrait === 'img:new' ? pendingImage?.url : undefined));
  const nick = el('input', { type: 'text', maxlength: NICK_MAX * 2, value: form.nickname, placeholder: fill(C.nickPh, { n: NICK_MAX }), autocomplete: 'nickname', oninput: () => {
    form.nickname = nick.value;
    paintPreview();
  } }) as HTMLInputElement;

  const picker = iconPicker({
    initial: form.portrait,
    userId: u?.id ?? 0,
    color: () => form.color,
    onChange: (v, img) => {
      form.portrait = v;
      pendingImage = img;
      paintPreview();
    },
  });
  const colors = el('div', { class: 'cm-colors' });
  const paintColors = (): void =>
    colors.replaceChildren(...PROFILE_COLORS.map((c) => el('button', { type: 'button', class: `cm-color${c === form.color ? ' on' : ''}`, style: `--sw:${c}`, 'aria-label': c, onclick: () => {
      form.color = c;
      paintColors();
      paintPreview();
      picker.repaint();
    } })));
  paintColors();
  paintPreview();

  const err = el('p', { class: 'cm-err', role: 'alert' });
  const busy = (b: boolean): void => {
    dlg.classList.toggle('busy', b);
  };
  const busyText = (t: string): void => {
    err.textContent = t;
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
      // 新しい画像は、プロフィールを保存してから送る（それまでは今のアイコンのまま）
      const img = form.portrait === 'img:new' ? pendingImage : null;
      const portrait = form.portrait === 'img:new' ? (current?.user.portrait ?? 'mid_m:1') : form.portrait;
      const p: ProfileInput = { ...form, portrait, nickname: form.nickname.trim() };
      if (current) {
        const r = await communityApi.updateProfile(p);
        current = { token: current.token, user: r.user };
      } else {
        const r = await communityApi.register(p);
        current = { token: r.token, user: r.user };
      }
      saveProfile(current);
      if (img) {
        busyText(C.uploading);
        const r = await communityApi.uploadAvatar(img.b64);
        current = { token: current.token, user: r.user };
        saveProfile(current);
      }
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
        picker.follow(form.sex, form.age);
      })),
      field(C.age, segmented(AGE_BANDS, (v) => C.ages[v] ?? v, form.age, (v) => {
        form.age = v;
        picker.follow(form.sex, form.age);
      })),
      field(C.icon, picker.el),
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

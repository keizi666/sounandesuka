/**
 * 共有の短い URL（ユーザーの指定: 場面の長い URL では X などでリンクのカードが出ない）。
 * 遊ぶ画面の URL（?scenario=…&st=… や ?brief=…）を、みんなの遭難記録の API で短い鍵にして、<base>/api/s.php?k=… にする。
 * s.php はシナリオの題・説明・サムネイルのカードを返し、開いた人を元の URL へ移す。
 * 作れなかった（API がない・通信できない）ときは、元の URL のまま返す。通信先は同じオリジンの API だけ（鉄則 8 の例外）
 */
import { communityApi } from './communityApi';

const made = new Map<string, Promise<string>>();

/** 短い URL にする。遊ぶ画面の URL でなければそのまま */
export function shortLink(url: string, text = ''): Promise<string> {
  let u: URL;
  try {
    u = new URL(url, location.href);
  } catch {
    return Promise.resolve(url);
  }
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  const own = u.origin === base.origin && (u.pathname === base.pathname || u.pathname === `${base.pathname}index.html`);
  if (!own || !(u.searchParams.has('scenario') || u.searchParams.has('brief'))) return Promise.resolve(url);
  const target = u.search;
  const key = `${target}\n${text}`;
  let p = made.get(key);
  if (!p) {
    p = communityApi
      .share(target, text)
      .then((r) => `${base.origin}${base.pathname}api/s.php?k=${encodeURIComponent(r.k)}`)
      .catch(() => {
        made.delete(key);
        return url;
      });
    made.set(key, p);
  }
  return p;
}

/** 共有の宛先（本文と URL）の URL を短くしたもの */
export function shortTarget<T extends { text: string; url: string }>(t: T): Promise<T> {
  return shortLink(t.url, t.text).then((url) => ({ ...t, url }));
}

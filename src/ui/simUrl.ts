/**
 * 場面の URL（リロード・共有で同じ場面から始められる。ユーザーの指定。src/app/shareState.ts）。simScreen.ts から分けた。
 */
import type { LoadedScenario } from '../app/data';
import { encodeState, setAddress, stateOf, stateUrl, type PlayMode } from '../app/shareState';
import { JA } from '../i18n/ja';
import type { World } from '../sim/types';
import { toast } from './dom';
import { shortLink } from '../net/shareLink';
import { fill } from '../i18n/format';
import { openSharePanel } from './sharePanel';
import type { ShareTarget } from './shareButtons';

export interface UrlSync {
  /** いまの場面を URL に入れる（一覧のシナリオだけ。force でなければ 2 秒に 1 回まで、時刻か選択が変わったときだけ） */
  write(force?: boolean): void;
  /** 共有のパネル（短い URL・QR コード・コピー・端末の共有・SNS）を開く。開いている間は hooks で一時停止する（ユーザーの指定） */
  share(hooks?: { onOpen?: () => void; onClose?: () => void }): Promise<void>;
}

export function createUrlSync(o: { world: World; loaded: LoadedScenario; mode: PlayMode; skip: () => boolean; alive: () => boolean; card?: () => Promise<{ image: string; text: string } | null> }): UrlSync {
  const { world, loaded } = o;
  let seq = 0;
  let at = 0;
  let last = '';
  return {
    write(force = false) {
      if (!loaded.listed || o.skip()) return;
      const now = performance.now();
      const key = `${world.decisions.length}|${Math.round(world.tMin)}`;
      if (!force && (key === last || now - at < 2000)) return;
      last = key;
      at = now;
      const mine = (seq += 1);
      void encodeState(stateOf(world, o.mode, loaded.conditions, loaded.scenario.seed)).then((enc) => {
        if (mine === seq && o.alive()) setAddress(stateUrl(loaded.scenario.id, enc));
      });
    },
    async share(hooks) {
      if (!loaded.listed) {
        toast(JA.ui.shareUnavailable, 4000);
        return;
      }
      // パネルはすぐ開き、短い URL ができたら QR コードとリンクを出す（X などでカードが出る。作れなければ元の URL）
      const link = (async (): Promise<ShareTarget> => {
        const url = stateUrl(loaded.scenario.id, await encodeState(stateOf(world, o.mode, loaded.conditions, loaded.scenario.seed)));
        setAddress(url);
        const cd = o.card ? await o.card().catch(() => null) : null;
        const text = cd?.text ?? fill(JA.sharePanel.text, { title: loaded.scenario.title });
        return { text, url: await shortLink(url, text, cd?.image) };
      })();
      openSharePanel(link, hooks);
    },
  };
}

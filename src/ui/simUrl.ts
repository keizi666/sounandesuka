/**
 * 場面の URL（リロード・共有で同じ場面から始められる。ユーザーの指定。src/app/shareState.ts）。simScreen.ts から分けた。
 */
import type { LoadedScenario } from '../app/data';
import { encodeState, setAddress, stateOf, stateUrl, type PlayMode } from '../app/shareState';
import { JA } from '../i18n/ja';
import type { World } from '../sim/types';
import { toast } from './dom';

export interface UrlSync {
  /** いまの場面を URL に入れる（一覧のシナリオだけ。force でなければ 2 秒に 1 回まで、時刻か選択が変わったときだけ） */
  write(force?: boolean): void;
  /** いまの場面の URL をコピーする（共有） */
  share(): Promise<void>;
}

export function createUrlSync(o: { world: World; loaded: LoadedScenario; mode: PlayMode; skip: () => boolean; alive: () => boolean }): UrlSync {
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
      void encodeState(stateOf(world, o.mode, loaded.conditions)).then((enc) => {
        if (mine === seq && o.alive()) setAddress(stateUrl(loaded.scenario.id, enc));
      });
    },
    async share() {
      if (!loaded.listed) {
        toast(JA.ui.shareUnavailable, 4000);
        return;
      }
      const url = stateUrl(loaded.scenario.id, await encodeState(stateOf(world, o.mode, loaded.conditions)));
      setAddress(url);
      try {
        await navigator.clipboard.writeText(url);
        toast(JA.ui.shareCopied, 3500);
      } catch {
        window.prompt(JA.ui.shareCopyManual, url);
      }
    },
  };
}

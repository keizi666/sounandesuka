/**
 * 結末画面（docs/11 §5、FR-30〜31）。レイアウト: 結末の色の見出し（題名と物語）→ 要約の数字 → メンバーの状態 → 分岐での選択 → 下に固定した操作。
 */
import type { AppContext } from '../app/App';
import type { LoadedScenario } from '../app/data';
import { JA } from '../i18n/ja';
import { fill, formatClock, formatDateTime } from '../i18n/format';
import { createStaticContext } from '../sim/core/world';
import { ENDING_SEVERITY, resolveEnding } from '../sim/scenario/endings';
import { recVars } from '../sim/record/recorder';
import type { ClimberState } from '../sim/types';
import { avatar } from './avatar';
import { el, levelOf } from './dom';
import { hpLevel, hpOf } from './hp';
import { icon, type IconName } from './icons';
import { ringGauge } from './logDetail';
import { optionLabel, type SimResult } from './simScreen';
import type { LogLine } from './simHud';
import { audio } from './audio';
import { endingMusic } from './simAudio';
import { openDebriefPanel } from './debrief';
import { historicalSources } from './historicalLinks';
import { communityPostCard } from './community/postCard';
import { shareButtons, siteUrl } from './shareButtons';
import { STATE_PARAM } from '../app/shareState';

export function endingTone(kind: string): 'good' | 'mid' | 'bad' {
  const s = ENDING_SEVERITY[kind as keyof typeof ENDING_SEVERITY] ?? 0;
  return s <= 1 ? 'good' : s <= 3 ? 'mid' : 'bad';
}

function hm(min: number): string {
  const h = Math.floor(min / 60);
  return `${h} 時間 ${Math.round(min - h * 60)} 分`;
}

const DEATH_CAUSE: Record<string, string> = JA.labels.deathCause;

function memberCard(c: ClimberState, outcome: string, minCoreC: number): HTMLElement {
  const b = c.body;
  const hp = hpOf(b);
  const tone = endingTone(outcome);
  const stat = (ic: IconName, label: string, value: string, lv: 'ok' | 'warn' | 'danger' | 'critical'): HTMLElement =>
    el('div', { class: `en-stat lv-${lv}` }, [icon(ic), el('small', {}, label), el('strong', {}, value)]);
  return el('li', { class: `en-member tone-${tone}`, style: `--c:${c.def.color}` }, [
    el('div', { class: 'en-face' }, [avatar(c.def, 72), ringGauge('favorite', hp / 100, hpLevel(hp), `${JA.ui.hp} ${hp}`)]),
    el('div', { class: 'en-info' }, [
      el('div', { class: 'en-name' }, [el('strong', {}, c.def.name), el('span', {}, `${c.def.age}歳`), el('span', { class: `en-badge tone-${tone}` }, JA.endings[outcome]?.title ?? outcome)]),
      el('p', { class: 'en-state' }, [outcome === 'SAFE_SHELTER' && c.state !== 'DEAD' ? '小屋で過ごした' : (JA.labels.state[c.state] ?? c.state), !b.alive && b.deathCause ? `（${DEATH_CAUSE[b.deathCause] ?? b.deathCause}）` : '', b.injury !== 'none' ? ` ・ ${JA.labels.injury[b.injury] ?? b.injury}` : '']),
      el('div', { class: 'en-stats' }, [
        stat('favorite', JA.ui.hp, `${hp}`, hpLevel(hp)),
        stat('thermostat', '最低体温', `${minCoreC.toFixed(1)}℃`, levelOf(minCoreC, 36, 35, 32)),
        stat('bolt', JA.ui.energy, `${Math.round(b.glycogenKcal)}`, levelOf(b.glycogenKcal, 600, 300, 100)),
        stat('waterDrop', JA.ui.water, `-${b.waterDeficitL.toFixed(1)}L`, levelOf(b.waterDeficitL, 1, 2, 4, true)),
        stat('batteryAlert', JA.ui.fatigue, `${Math.round(b.fatigue)}`, levelOf(b.fatigue, 60, 80, 95, true)),
        stat('rainy', JA.ui.wetness, `${Math.round(b.wetness * 100)}%`, levelOf(b.wetness, 0.3, 0.6, 0.85, true)),
      ]),
    ]),
  ]);
}

/** 結果の画面のログ（たたんでおき、開いたら並べる） */
function logCard(lines: readonly LogLine[]): HTMLElement {
  const list = el('ol', { class: 'en-log' });
  const det = el('details', { class: 'bf-card en-log-card' }, [el('summary', {}, [el('h2', {}, [icon('listAlt'), fill(JA.ui.endingLog, { n: lines.length })])]), list]);
  det.addEventListener('toggle', () => {
    if (!det.open || list.childElementCount > 0) return;
    list.replaceChildren(
      ...lines.map((l) => el('li', { class: l.important ? 'imp' : '' }, [el('time', {}, formatClock(l.tMin)), el('span', {}, l.text)])),
    );
  });
  return det;
}

export function showEnding(app: AppContext, loaded: LoadedScenario, result: SimResult): () => void {
  const { scenario: s } = loaded;
  const w = result.world;
  const ctx = createStaticContext(loaded.map, s);
  const e = resolveEnding(w, ctx, recVars(result.recorder, w))!;
  const def = JA.endings[e.kind];
  audio().music(endingMusic(e.kind, s));
  const r = result.recorder.record;
  const start = r.samples[0]?.t ?? w.tMin;
  const endMin = w.ended?.atMin ?? w.tMin;
  const decisions = r.decisions.filter((d) => d.by === 'user' || d.by === 'bias');
  const tone = endingTone(e.kind);
  const minCore = (id: string): number => Math.min(37, ...r.samples.map((sm) => sm.climbers.find((q) => q.id === id)?.coreC ?? 37));
  const fact = (ic: IconName, label: string, value: string): HTMLElement => el('div', { class: 'bf-fact' }, [icon(ic), el('span', {}, [el('small', {}, label), el('strong', {}, value)])]);

  let closeDebrief: (() => void) | null = null;
  // 共有: 一覧のシナリオなら、この経過を再現する URL（アドレス欄に入っている場面の URL）。それ以外はサービスの URL
  const endTitle = e.title ?? def?.title ?? e.kind;
  const resultUrl = loaded.listed && new URL(location.href).searchParams.has(STATE_PARAM) ? location.href : siteUrl();
  const shareCard = el('section', { class: 'bf-card sh-card' }, [
    el('h2', {}, [icon('share'), JA.share.resultTitle]),
    shareButtons(
      { text: fill(JA.share.resultText, { scenario: s.title, ending: endTitle, time: hm(endMin - start), core: r.stats.minCoreC.toFixed(1) }), url: resultUrl },
      { note: resultUrl === siteUrl() ? JA.share.note : JA.share.resultNote },
    ),
  ]);
  const main = el('main', { class: `ending2 tone-${tone}` }, [
      el('header', { class: 'en-hero' }, [
        el('div', { class: 'en-in' }, [
          el('p', { class: 'en-kicker' }, [JA.ui.endingTitle, el('span', {}, s.title), loaded.conditions ? el('span', { class: 'tag' }, JA.conditions.tried) : null]),
          el('h1', {}, e.title ?? def?.title ?? e.kind),
          el('p', { class: 'en-story' }, e.text ?? def?.text ?? ''),
          el('div', { class: 'bf-facts' }, [
            fact('timer', JA.ui.duration, hm(endMin - start)),
            fact('route', JA.ui.distance, `${(r.stats.distanceM / 1000).toFixed(1)} km`),
            fact('thermostat', JA.ui.minCore, `${r.stats.minCoreC.toFixed(1)}℃`),
            fact('flag', '終わった時刻', formatDateTime(s, endMin)),
            r.stats.rescueCalledAt !== null ? fact('mobile', JA.ui.rescueAt, formatDateTime(s, r.stats.rescueCalledAt)) : null,
            r.stats.wasLost ? fact('warning', '道迷い', `${Math.round(r.stats.lostMinutes)} 分`) : null,
          ]),
        ]),
      ]),
      el('div', { class: 'en-body' }, [
        el('section', { class: 'bf-card' }, [
          el('h2', {}, [icon('groups'), JA.ui.perClimber]),
          el('ul', { class: 'en-members' }, e.perClimber.map((p) => memberCard(w.climbers.find((x) => x.id === p.id)!, p.outcome, minCore(p.id)))),
        ]),
        decisions.length > 0
          ? el('section', { class: 'bf-card' }, [
              el('h2', {}, [icon('route'), JA.ui.decisions]),
              el('ol', { class: 'en-decisions' }, decisions.map((d) => el('li', {}, [el('time', {}, formatClock(d.tMin)), el('span', { class: 'dia' }, '◆'), el('span', {}, optionLabel(loaded, d.cpId, d.optionId)), d.by !== 'user' ? el('small', {}, '（自動）') : null]))),
            ])
          : null,
        // みんなの遭難記録に載せる（docs/20_community.md）
        result.shared ? null : communityPostCard(app, loaded, result, { kind: e.kind, title: endTitle }),
        shareCard,
        // ログ（ユーザーの指定: 結果の画面でも見られる）。長いので、開いたときに並べる
        result.log && result.log.length > 0 ? logCard(result.log) : null,
        el('div', { class: 'bf-notes' }, [
          el('p', { class: 'note' }, JA.disclaimer.endingNote),
          s.region?.real ? el('p', { class: 'note' }, JA.disclaimer.realMountain) : null,
          s.historical ? el('p', { class: 'note strong' }, s.historical.disclaimer) : null,
          s.historical ? historicalSources(s.historical) : null,
        ]),
      ]),
      el('footer', { class: 'bf-bar' }, [
        el('div', { class: 'bf-bar-in' }, [
          // 下のバー（ユーザーの指定）: 左端に「もう一度」、右に「振り返る」「トップページへ」。3 つとも同じ黄色の大きなボタン
          el('button', { class: 'primary big', onclick: () => app.go({ name: 'briefing', loaded }) }, [icon('replay'), JA.ui.again]),
          el('div', { class: 'en-bar-btns' }, [
            // 振り返りは、結果画面の上にパネルとして重ねる（ユーザーの指定）
            el('button', {
              class: 'primary big',
              onclick: () => {
                closeDebrief?.();
                closeDebrief = openDebriefPanel(app, loaded, result, main);
              },
            }, [icon('history'), JA.ui.debrief]),
            el('button', { class: 'primary big', onclick: () => app.go({ name: 'select' }) }, [icon('home'), JA.ui.toTop]),
          ]),
        ]),
      ]),
    ]);
  app.root.append(main);
  return () => closeDebrief?.();
}

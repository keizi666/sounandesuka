/**
 * タブ 4 天候（docs/17）: タイムライン、キーフレームのインスペクタ、天気パターンの挿入（プレビュー→適用）、
 * 過去の天気（Open-Meteo）の取り込み、雷雲セル（地図で進路）、確認地点の局地値、予報の表と下書き。
 * sim は天候の解析結果を weather オブジェクトの同一性でキャッシュするので、変更のたびに新しいオブジェクトにする。
 */
import { formatTimeRef, parseHHMM, parseTimeRef, scenarioStartMin } from '../../sim/core/clock';
import { createStaticContext, createWorld } from '../../sim/core/world';
import type { ThunderCellDef, WeatherDef, WeatherKeyframe, WeatherPresetId } from '../../sim/types';
import { activeCells, cellInfluenceAt, interpolateKeyframes, updateGlobal } from '../../sim/weather/global';
import { sampleLocal } from '../../sim/weather/local';
import { el } from '../../ui/dom';
import type { Ed } from '../context';
import { button, fill, num, section, select, text, timeRef } from '../forms/fields';
import { convertOpenMeteo, fetchOpenMeteo, sourceNote, thinKeyframes, type OpenMeteoResponse } from '../geo/openmeteo';
import type { MapTool } from '../map/TileMapView';
import { applyPreset, PRESET_LABELS, type PresetParams } from '../weather/presets';
import { ROWS, Timeline } from '../weather/Timeline';
import { sampleElevAt } from './elev';
import { hhmm, sunTimes } from '../geo/sunrise';
import type { Panel } from './types';
import { draftForecast } from '../weather/forecast';
import { weatherTemplateSection } from './templateUi';

let tl: Timeline | null = null;
let tlOwner: Ed | null = null;
let selected: number[] = [];
let dragging = false;
let preset: WeatherPresetId = 'coldFront';
let pp: PresetParams = { t0Min: 13 * 60, s: 1, side: 'sea', hours: 6, baseM: 1500 };
let ghost: { keyframes: WeatherKeyframe[]; cells: ThunderCellDef[] } | null = null;
let om: { start: string; days: number; wind: number; precip: number; gridElev: number | null; raw: OpenMeteoResponse | null; msg: string } = { start: '', days: 2, wind: 1, precip: 1.3, gridElev: null, raw: null, msg: '' };
let cellDraw: { id: string; path: [number, number][] } | null = null;
let selCell: string | null = null;

/** weather を新しいオブジェクトにして変える */
function setWeather(ed: Ed, label: string, f: (w: WeatherDef) => void): void {
  ed.change(label, () => {
    const w = structuredClone(ed.p.scenario.weather);
    f(w);
    ed.p.scenario.weather = w;
  });
}

function timeline(ed: Ed): Timeline {
  if (tl && tlOwner === ed) return tl;
  tlOwner = ed;
  tl = new Timeline({
    edit(kfs, label, end) {
      if (!end) {
        if (!dragging) {
          ed.checkpoint(label);
          dragging = true;
        }
        ed.p.scenario.weather = { ...ed.p.scenario.weather, keyframes: kfs };
        drawTimeline(ed);
        return;
      }
      if (dragging) {
        dragging = false;
        ed.p.scenario.weather = { ...ed.p.scenario.weather, keyframes: [...kfs] };
        ed.touched(false);
      } else setWeather(ed, label, (w) => (w.keyframes = kfs));
    },
    select(ix) {
      selected = ix;
      ed.refresh();
    },
    cursor(t) {
      ed.cursorMin = t;
      ed.refresh();
    },
  });
  return tl;
}

function drawTimeline(ed: Ed): void {
  const t = timeline(ed);
  const s = ed.p.scenario;
  const start = scenarioStartMin(s);
  const end = parseTimeRef(s.timeLimit);
  const days = Math.ceil(end / 1440) + 1;
  const rise: number[] = [];
  const set: number[] = [];
  for (let d = 0; d < days; d += 1) {
    rise.push(d * 1440 + parseHHMM(s.sun.sunrise));
    set.push(d * 1440 + parseHHMM(s.sun.sunset));
  }
  const rt = ed.runtime();
  const nodeIds = new Set([...s.plan.route, ...ed.p.map.nodes.filter((n) => n.shelter || n.type === 'peak').map((n) => n.id)]);
  const nodeElevs = rt ? [...nodeIds].map((id) => ({ name: rt.nodes[id]?.name || id, elevM: rt.nodes[id]?.elevM ?? 0 })).filter((n, i, a) => n.elevM > 0 && a.findIndex((x) => x.name === n.name) === i).slice(0, 6) : [];
  const rec = ed.lastRun?.record;
  t.ghost = ghost?.keyframes ?? null;
  t.selected = selected;
  t.cursorMin = ed.cursorMin || start;
  t.set(s.weather, [Math.max(0, start - 60), end], {
    sunrise: rise,
    sunset: set,
    choices: (rec?.decisions ?? []).map((d) => ({ tMin: d.tMin, label: d.cpId })),
    events: (rec?.events ?? []).filter((e) => e.important).map((e) => ({ tMin: e.tMin, label: e.type })),
    nodeElevs,
    cells: [...(s.weather.thunderCells ?? []), ...(ghost?.cells ?? [])].map((c) => ({ id: c.id, from: parseTimeRef(c.from), peak: parseTimeRef(c.peakAt), to: parseTimeRef(c.to) })),
  });
}

function kfInspector(ed: Ed): HTMLElement | null {
  const w = ed.p.scenario.weather;
  if (selected.length === 0) return el('p', { class: 'note' }, '下のタイムラインの点か、いちばん上の四角をクリックすると、ここで数値を打ち込んで編集できます。操作のしかたはタイムラインの「？ 操作のしかた」で出せます。');
  if (selected.length > 1) {
    let delta = 1;
    let shift = 30;
    let k = 1.2;
    let key: keyof WeatherKeyframe = 'tempC';
    const keys = ROWS.filter((r) => r.key !== 'cloud' && r.key !== 'windDirDeg').map((r) => [r.key as keyof WeatherKeyframe, r.label] as [keyof WeatherKeyframe, string]);
    return section(`${selected.length} 個のキーフレーム`, [
      select('変数', key, keys, (v) => (key = v)),
      num('± n', delta, (v) => (delta = v), { step: 0.5 }),
      button('値を ±n', () => setWeather(ed, '値を足す', (ww) => selected.forEach((i) => {
        const f = ww.keyframes[i] as unknown as Record<string, number>;
        f[key] = (f[key] ?? 0) + delta;
      }))),
      num('強さ ×k', k, (v) => (k = v), { step: 0.1 }),
      button('基準値からの差を ×k', () => setWeather(ed, '強さを変える', (ww) => {
        const base = (ww.keyframes[selected[0]! - 1] ?? ww.keyframes[0]!) as unknown as Record<string, number>;
        selected.forEach((i) => {
          const f = ww.keyframes[i] as unknown as Record<string, number>;
          f[key] = (base[key] ?? 0) + ((f[key] ?? 0) - (base[key] ?? 0)) * k;
        });
      })),
      num('時間をずらす', shift, (v) => (shift = v), { step: 5, unit: '分' }),
      button('ずらす', () => setWeather(ed, '時間をずらす', (ww) => selected.forEach((i) => (ww.keyframes[i]!.at = formatTimeRef(parseTimeRef(ww.keyframes[i]!.at) + shift))))),
    ]);
  }
  const i = selected[0]!;
  const kf = w.keyframes[i];
  if (!kf) return null;
  const f = (label: string, key: keyof WeatherKeyframe, o: { min?: number; max?: number; step?: number; unit?: string } = {}): HTMLElement =>
    num(label, kf[key] as number | undefined, (v) => setWeather(ed, label, (ww) => ((ww.keyframes[i] as unknown as Record<string, number>)[key] = v)), o);
  return section(`キーフレーム ${kf.at}`, [
    timeRef('時刻', kf.at, (v) => setWeather(ed, '時刻', (ww) => {
      ww.keyframes[i]!.at = v;
      ww.keyframes.sort((a, b) => parseTimeRef(a.at) - parseTimeRef(b.at));
    })),
    f(`気温（基準 ${w.refElevM} m）`, 'tempC', { step: 0.5, unit: '℃' }),
    f('風速', 'windMs', { min: 0, step: 0.5, unit: 'm/s' }),
    f('風向（吹いてくる方位）', 'windDirDeg', { min: 0, max: 359, step: 5, unit: '°' }),
    f('降水', 'precipMmH', { min: 0, step: 0.5, unit: 'mm/h' }),
    f('雲量', 'cloudCover', { min: 0, max: 1, step: 0.05 }),
    f('雲底', 'cloudBaseM', { step: 50, unit: 'm' }),
    f('視程（雲の外）', 'visibilityM', { min: 10, step: 100, unit: 'm' }),
    f('視程（雲の中）', 'inCloudVisibilityM', { min: 10, step: 10, unit: 'm' }),
    f('雷', 'thunder', { min: 0, max: 1, step: 0.05 }),
    f('気圧', 'pressureHpa', { step: 1, unit: 'hPa' }),
    f('突風', 'gustiness', { min: 0, max: 1, step: 0.05 }),
    button('このキーフレームを削除', () => {
      if (w.keyframes.length <= 1) return;
      selected = [];
      setWeather(ed, 'キーフレームの削除', (ww) => ww.keyframes.splice(i, 1));
    }),
  ]);
}

function presetSection(ed: Ed): HTMLElement {
  const s = ed.p.scenario;
  const ids = Object.keys(PRESET_LABELS) as WeatherPresetId[];
  const preview = (): void => {
    pp.sunriseMin = parseHHMM(s.sun.sunrise);
    pp.sunsetMin = parseHHMM(s.sun.sunset);
    ghost = applyPreset(s.weather, preset, pp);
    drawTimeline(ed);
  };
  return section('パターンを挿入', [
    select('種類', preset, ids.map((id) => [id, PRESET_LABELS[id]]), (v) => {
      preset = v;
      ghost = null;
      ed.refresh();
    }),
    timeRef('中心の時刻 t0', formatTimeRef(pp.t0Min), (v) => (pp.t0Min = parseTimeRef(v))),
    num('強さ s', pp.s, (v) => (pp.s = v), { min: 0.5, max: 1.5, step: 0.1 }),
    preset === 'winterMonsoon' ? select('側', pp.side ?? 'sea', [['sea', '日本海側'], ['pacific', '太平洋側']], (v) => (pp.side = v)) : null,
    preset === 'typhoon' ? select('通過', pp.side ?? 'east', [['east', '東側を通過'], ['west', '西側を通過']], (v) => (pp.side = v)) : null,
    preset === 'fog' ? num('雲底', pp.baseM ?? 1500, (v) => (pp.baseM = v), { step: 50, unit: 'm' }) : null,
    preset === 'fog' || preset === 'baiuRain' ? num('持続', pp.hours ?? 6, (v) => (pp.hours = v), { min: 1, unit: '時間' }) : null,
    preset === 'summerThunderstorm' ? el('p', { class: 'note' }, '雷雲の進路は既定でエリアを南東→北西に横切ります。適用後、雷雲セルの欄で地図に描き直せます。') : null,
    el('div', {}, [
      button('プレビュー', preview),
      button('適用', () => {
        preview();
        const g = ghost!;
        ghost = null;
        setWeather(ed, `パターン: ${PRESET_LABELS[preset]}`, (w) => {
          w.keyframes = g.keyframes;
          if (g.cells.length) w.thunderCells = [...(w.thunderCells ?? []), ...g.cells.map((c) => ({ ...c, path: defaultPath(ed) }))];
          w.presetLog = [...(w.presetLog ?? []), { preset, at: formatTimeRef(pp.t0Min), intensity: pp.s }];
        });
      }, 'primary'),
      ghost ? button('プレビューを消す', () => {
        ghost = null;
        drawTimeline(ed);
      }) : null,
    ]),
    el('p', { class: 'note' }, 'パターンは教材用の型です。局地値（下の表）を確認して調整してください。'),
  ]);
}

function defaultPath(ed: Ed): [number, number][] {
  const h = ed.p.map.size / 2;
  return [[h * 0.9, h * 0.9], [-h * 0.9, -h * 0.9]];
}

function openMeteoSection(ed: Ed): HTMLElement | null {
  const g = ed.p.map.geo;
  if (!g) return null;
  const s = ed.p.scenario;
  if (!om.start) om.start = s.startDate;
  // 取得済みの応答があれば使う（同じ期間を再取得しない）
  if (!om.raw && ed.p.raw.weather) {
    om.raw = ed.p.raw.weather as OpenMeteoResponse;
    om.start = om.raw.hourly.time[0]?.slice(0, 10) ?? om.start;
  }
  const endDate = (): string => {
    const d = new Date(`${om.start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + om.days - 1);
    return d.toISOString().slice(0, 10);
  };
  const convert = (): WeatherKeyframe[] =>
    thinKeyframes(convertOpenMeteo(om.raw!, { refElevM: s.weather.refElevM, lapseRateCPer100m: s.weather.lapseRateCPer100m, gridElevM: om.gridElev ?? undefined, windFactor: om.wind, precipFactor: om.precip, startDate: om.start }), parseTimeRef);
  return section('過去の天気を取り込む（Open-Meteo）', [
    el('p', { class: 'note' }, '取り込んだ最初の日がシナリオの開始日（D0）になります。'),
    el('p', { class: 'note' }, '再解析データは数十 km 規模の平均で、山の局地的な天気（稜線の強風、谷の霧、雷雨）は再現されません。下書きとして使い、局地値を確認して調整してください。'),
    text('開始日', om.start, (v) => (om.start = v), { placeholder: '2025-10-12' }),
    num('日数', om.days, (v) => (om.days = v), { min: 1, max: 3 }),
    num('風の補正倍率', om.wind, (v) => (om.wind = v), { min: 0.5, max: 2, step: 0.1 }),
    num('山岳の降水補正', om.precip, (v) => (om.precip = v), { min: 1, max: 2, step: 0.1 }),
    om.raw && om.raw.elevation === undefined ? num('格子の標高', om.gridElev, (v) => (om.gridElev = v), { unit: 'm' }) : null,
    button(om.raw ? '取得し直す' : '取得する', async () => {
      try {
        om.msg = '取得しています…';
        ed.refresh();
        const raw = await fetchOpenMeteo(g.centerLat, g.centerLon, om.start, endDate());
        om.raw = raw;
        // 応答は保存して再取得しない（NFR-11）
        ed.change('過去の天気の取得', () => (ed.p.raw.weather = raw));
        om.msg = `取得しました（格子の標高 ${om.raw.elevation ?? '不明'} m、${om.raw.hourly.time.length} 時間）`;
        ghost = { keyframes: convert(), cells: [] };
      } catch (e) {
        om.msg = String(e instanceof Error ? e.message : e);
      }
      ed.refresh();
    }),
    om.raw ? button('補正を変えてプレビュー', () => {
      ghost = { keyframes: convert(), cells: [] };
      drawTimeline(ed);
    }) : null,
    om.raw ? button('タイムラインに適用', () => {
      const kfs = convert();
      ghost = null;
      ed.change('過去の天気を取り込む', () => {
        ed.p.scenario.weather = { ...structuredClone(ed.p.scenario.weather), keyframes: kfs };
        // 取り込んだ日をシナリオの開始日（D0）にし、日の出・日の入りを計算し直す
        if (ed.p.scenario.startDate !== om.start) {
          ed.p.scenario.startDate = om.start;
          const st = sunTimes(om.start, g.centerLat, g.centerLon);
          ed.p.scenario.sun = { ...ed.p.scenario.sun, sunrise: hhmm(st.sunriseMin), sunset: hhmm(st.sunsetMin) };
          ed.toast(`シナリオの開始日を ${om.start} にしました（日の出 ${hhmm(st.sunriseMin)}・日の入り ${hhmm(st.sunsetMin)}）`, 5000);
        }
        const note = sourceNote(om.start, g.centerLat, g.centerLon);
        ed.p.scenario.sources = [...(ed.p.scenario.sources ?? []).filter((x) => !x.includes('Open-Meteo')), note];
      });
    }, 'primary') : null,
    om.msg ? el('p', { class: 'note' }, om.msg) : null,
    el('p', { class: 'note' }, '出典: Open-Meteo（CC BY 4.0）。取り込むと書き出しの出典に自動で入ります。'),
  ]);
}

function cellTool(ed: Ed): MapTool | null {
  if (!cellDraw) return null;
  return {
    cursor: 'crosshair',
    click(p) {
      cellDraw!.path.push([Math.round(p.x), Math.round(p.z)]);
      ed.view.redraw();
      ed.toast(`進路 ${cellDraw!.path.length} 点（ダブルクリックで終了）`, 1200);
    },
    dblclick() {
      const d = cellDraw!;
      cellDraw = null;
      if (d.path.length < 2) return ed.refresh();
      setWeather(ed, '雷雲の進路', (w) => {
        const c = w.thunderCells?.find((x) => x.id === d.id);
        if (c) c.path = d.path;
      });
    },
  };
}

/** 各地点で雷の強さ（セルの中心からの影響）が最大になる時刻と値 */
function cellTable(ed: Ed, c: ThunderCellDef): HTMLElement {
  const rt = ed.runtime();
  if (!rt) return el('p');
  const s = { ...ed.p.scenario, weather: { ...ed.p.scenario.weather, thunderCells: [c] } };
  const ctx = createStaticContext(rt, s);
  const rows = [...new Set(ed.p.scenario.plan.route)].slice(0, 10).map((id) => {
    const n = rt.nodes[id]!;
    let best = { t: 0, v: 0 };
    for (let t = parseTimeRef(c.from); t <= parseTimeRef(c.to); t += 5) {
      const v = cellInfluenceAt(activeCells(s, t), n.x, n.z, ctx.tuning).core;
      if (v > best.v) best = { t, v };
    }
    return el('tr', {}, [el('td', {}, n.name), el('td', {}, best.v > 0 ? formatTimeRef(best.t) : '—'), el('td', {}, best.v.toFixed(2))]);
  });
  return el('table', { class: 'ed-table' }, [el('tr', {}, ['地点', '最大の時刻', '強さ'].map((x) => el('th', {}, x))), ...rows]);
}

function cellsSection(ed: Ed): HTMLElement {
  const cells = ed.p.scenario.weather.thunderCells ?? [];
  const c = cells.find((x) => x.id === selCell) ?? cells[0];
  const setC = (label: string, f: (x: ThunderCellDef) => void): void => setWeather(ed, label, (w) => f(w.thunderCells!.find((x) => x.id === c!.id)!));
  return section(`雷雲セル（${cells.length}）`, [
    cells.length > 1 ? select('セル', c?.id ?? '', cells.map((x) => [x.id, x.id]), (v) => {
      selCell = v;
      ed.refresh();
    }) : null,
    button('セルを追加', () => setWeather(ed, '雷雲の追加', (w) => {
      const id = `cb${(w.thunderCells?.length ?? 0) + 1}`;
      const t = ed.cursorMin || scenarioStartMin(ed.p.scenario) + 360;
      w.thunderCells = [...(w.thunderCells ?? []), { id, from: formatTimeRef(t - 70), peakAt: formatTimeRef(t), to: formatTimeRef(t + 80), path: defaultPath(ed), radiusM: 1400, peak: 1, heavyRainMmH: 25, hail: true }];
      selCell = id;
    })),
    ...(c
      ? [
          timeRef('発生', c.from, (v) => setC('雷雲の時刻', (x) => (x.from = v))),
          timeRef('最盛', c.peakAt, (v) => setC('雷雲の時刻', (x) => (x.peakAt = v))),
          timeRef('消滅', c.to, (v) => setC('雷雲の時刻', (x) => (x.to = v))),
          num('半径', c.radiusM, (v) => setC('雷雲の半径', (x) => (x.radiusM = v)), { min: 200, step: 100, unit: 'm' }),
          num('最大の強さ', c.peak, (v) => setC('雷雲の強さ', (x) => (x.peak = v)), { min: 0, max: 1, step: 0.05 }),
          num('強い雨', c.heavyRainMmH, (v) => setC('雷雲の雨', (x) => (x.heavyRainMmH = v)), { min: 0, unit: 'mm/h' }),
          button(cellDraw ? '進路を描いています（地図をクリック、ダブルクリックで終了）' : '進路を地図で描く', () => {
            cellDraw = { id: c.id, path: [] };
            ed.refresh();
          }),
          button('このセルを削除', () => setWeather(ed, '雷雲の削除', (w) => (w.thunderCells = w.thunderCells!.filter((x) => x.id !== c.id)))),
          cellTable(ed, c),
        ]
      : []),
  ], cells.length > 0);
}

/** 確認地点の局地値（カーソル時刻） */
function probesSection(ed: Ed): HTMLElement {
  const rt = ed.runtime();
  const s = ed.p.scenario;
  const probes = ed.p.editorState.probePoints;
  const t = ed.cursorMin || scenarioStartMin(s);
  let table: HTMLElement = el('p', { class: 'note' }, '地形がまだありません');
  if (rt) {
    try {
      const w = createWorld(rt, s);
      const ctx = createStaticContext(rt, s);
      w.tMin = t;
      updateGlobal(w, ctx);
      table = el('table', { class: 'ed-table' }, [
        el('tr', {}, ['地点', '標高', '気温', '体感', '風', '降水', '視程', '雲中', '雷'].map((x) => el('th', {}, x))),
        ...probes.map((p) => {
          const e = sampleElevAt(rt, p.x, p.z);
          const l = sampleLocal(w, ctx, p.x, p.z, e);
          return el('tr', {}, [p.label, `${Math.round(e)}`, `${l.tempC.toFixed(1)}℃`, `${l.windChillC.toFixed(1)}℃`, `${l.windMs.toFixed(0)}`, l.precipMmH > 0.05 ? `${l.precipType} ${l.precipMmH.toFixed(1)}` : '—', `${Math.round(l.visibilityM)}`, l.inCloud ? '○' : '', l.thunder > 0.05 ? l.thunder.toFixed(2) : ''].map((x) => el('td', {}, x)));
        }),
      ]);
    } catch (e) {
      table = el('p', { class: 'error' }, String(e));
    }
  }
  return section(`確認地点の局地値（${formatTimeRef(t)}）`, [
    el('p', { class: 'note' }, 'タイムラインをクリックすると時刻が変わります。'),
    table,
    button('既定の確認地点を置く（最高点・ルートの最高地点・小屋・登山口）', () => {
      if (!rt) return;
      let hi = 0;
      for (let i = 1; i < rt.heights.length; i += 1) if (rt.heights[i]! > rt.heights[hi]!) hi = i;
      const pts: { label: string; x: number; z: number }[] = [{ label: '最高点', x: -rt.half + (hi % rt.n) * rt.cell, z: -rt.half + Math.floor(hi / rt.n) * rt.cell }];
      const route = s.plan.route.map((id) => rt.nodes[id]).filter((n): n is NonNullable<typeof n> => Boolean(n));
      const top = route.reduce<(typeof route)[number] | null>((a, b) => (!a || b.elevM > a.elevM ? b : a), null);
      if (top) pts.push({ label: top.name, x: top.x, z: top.z });
      const hut = Object.values(rt.nodes).find((n) => n.shelter);
      if (hut) pts.push({ label: hut.name, x: hut.x, z: hut.z });
      const th = route[0];
      if (th) pts.push({ label: th.name, x: th.x, z: th.z });
      ed.change('確認地点', () => (ed.p.editorState.probePoints = pts.slice(0, 4)));
    }),
  ]);
}

function forecastSection(ed: Ed): HTMLElement {
  const fc = ed.p.scenario.briefing.forecast;
  const set = (f: () => void): void => ed.change('予報', f);
  return section('予報（登山者が見た予報）', [
    el('table', { class: 'ed-table' }, fc.map((x, i) => {
      const l = el('input', { value: x.label, style: 'width:6em' });
      const t = el('input', { value: x.text });
      l.addEventListener('change', () => set(() => (fc[i]!.label = l.value)));
      t.addEventListener('change', () => set(() => (fc[i]!.text = t.value)));
      return el('tr', {}, [el('td', {}, l), el('td', {}, t), el('td', {}, button('✕', () => set(() => fc.splice(i, 1))))]);
    })),
    button('行を追加', () => set(() => fc.push({ label: '', text: '' }))),
    button('タイムラインから下書き', () => set(() => (ed.p.scenario.briefing.forecast = draftForecast(ed.p.scenario)))),
    el('p', { class: 'note' }, '下書きのあと、わざと楽観的に書き換える（実際より遅い雨の予報など）ことを想定しています。'),
  ]);
}

export const weatherPanel: Panel = {
  id: 'weather',
  label: '天候',
  group: '物語を作る',
  tool: (ed) => cellTool(ed),
  render(ed) {
    const w = ed.p.scenario.weather;
    const set = (label: string, f: (x: WeatherDef) => void): void => setWeather(ed, label, f);
    fill(
      ed.inspector,
      el('h2', {}, '天候'),
      kfInspector(ed),
      weatherTemplateSection(ed, (g) => {
        ghost = g;
        drawTimeline(ed);
      }),
      presetSection(ed),
      openMeteoSection(ed),
      cellsSection(ed),
      probesSection(ed),
      forecastSection(ed),
      section('基準', [
        num('基準標高', w.refElevM, (v) => set('基準標高', (x) => (x.refElevM = v)), { unit: 'm' }),
        num('気温減率', w.lapseRateCPer100m, (v) => set('気温減率', (x) => (x.lapseRateCPer100m = v)), { step: 0.05, unit: '℃/100m' }),
        num('雲の厚さ', w.cloudThicknessM, (v) => set('雲の厚さ', (x) => (x.cloudThicknessM = v)), { step: 100, unit: 'm' }),
      ], false),
    );
    const t = timeline(ed);
    if (t.root.parentElement !== ed.bottom) ed.bottom.replaceChildren(t.root);
    requestAnimationFrame(() => drawTimeline(ed));
    drawTimeline(ed);
    void interpolateKeyframes;
  },
};

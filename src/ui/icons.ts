/**
 * アイコン（Google の Material Symbols・Rounded。Apache-2.0）。
 * 使うものだけを SVG の文字列としてアプリに同梱する（外部から読み込まない。NFR-09）。色は文字色に従う。
 */
import arrowBack from '@material-symbols/svg-400/rounded/arrow_back.svg?raw';
import calendarToday from '@material-symbols/svg-400/rounded/calendar_today.svg?raw';
import camping from '@material-symbols/svg-400/rounded/camping.svg?raw';
import flag from '@material-symbols/svg-400/rounded/flag.svg?raw';
import restaurant from '@material-symbols/svg-400/rounded/restaurant.svg?raw';
import route from '@material-symbols/svg-400/rounded/route.svg?raw';
import timer from '@material-symbols/svg-400/rounded/timer.svg?raw';
import trendingUp from '@material-symbols/svg-400/rounded/trending_up.svg?raw';
import warning from '@material-symbols/svg-400/rounded/warning.svg?raw';
import wbSunny from '@material-symbols/svg-400/rounded/wb_sunny.svg?raw';
import acUnit from '@material-symbols/svg-400/rounded/ac_unit.svg?raw';
import air from '@material-symbols/svg-400/rounded/air.svg?raw';
import batteryAlert from '@material-symbols/svg-400/rounded/battery_alert.svg?raw';
import bolt from '@material-symbols/svg-400/rounded/bolt.svg?raw';
import checkroom from '@material-symbols/svg-400/rounded/checkroom.svg?raw';
import cloud from '@material-symbols/svg-400/rounded/cloud.svg?raw';
import deviceThermostat from '@material-symbols/svg-400/rounded/device_thermostat.svg?raw';
import directionsWalk from '@material-symbols/svg-400/rounded/directions_walk.svg?raw';
import favorite from '@material-symbols/svg-400/rounded/favorite.svg?raw';
import keyboardArrowDown from '@material-symbols/svg-400/rounded/keyboard_arrow_down.svg?raw';
import keyboardArrowUp from '@material-symbols/svg-400/rounded/keyboard_arrow_up.svg?raw';
import fastForward from '@material-symbols/svg-400/rounded/fast_forward.svg?raw';
import flashlightOn from '@material-symbols/svg-400/rounded/flashlight_on.svg?raw';
import foggy from '@material-symbols/svg-400/rounded/foggy.svg?raw';
import groups from '@material-symbols/svg-400/rounded/groups.svg?raw';
import healing from '@material-symbols/svg-400/rounded/healing.svg?raw';
import hiking from '@material-symbols/svg-400/rounded/hiking.svg?raw';
import history from '@material-symbols/svg-400/rounded/history.svg?raw';
import home from '@material-symbols/svg-400/rounded/home.svg?raw';
import landscape from '@material-symbols/svg-400/rounded/landscape.svg?raw';
import layers from '@material-symbols/svg-400/rounded/layers.svg?raw';
import listAlt from '@material-symbols/svg-400/rounded/list_alt.svg?raw';
import map from '@material-symbols/svg-400/rounded/map.svg?raw';
import minimize from '@material-symbols/svg-400/rounded/minimize.svg?raw';
import mobile from '@material-symbols/svg-400/rounded/mobile.svg?raw';
import monitorHeart from '@material-symbols/svg-400/rounded/monitor_heart.svg?raw';
import myLocation from '@material-symbols/svg-400/rounded/my_location.svg?raw';
import openInFull from '@material-symbols/svg-400/rounded/open_in_full.svg?raw';
import partlyCloudyDay from '@material-symbols/svg-400/rounded/partly_cloudy_day.svg?raw';
import pause from '@material-symbols/svg-400/rounded/pause.svg?raw';
import playArrow from '@material-symbols/svg-400/rounded/play_arrow.svg?raw';
import playCircle from '@material-symbols/svg-400/rounded/play_circle.svg?raw';
import psychology from '@material-symbols/svg-400/rounded/psychology.svg?raw';
import rainy from '@material-symbols/svg-400/rounded/rainy.svg?raw';
import schedule from '@material-symbols/svg-400/rounded/schedule.svg?raw';
import sentimentWorried from '@material-symbols/svg-400/rounded/sentiment_worried.svg?raw';
import settings from '@material-symbols/svg-400/rounded/settings.svg?raw';
import speed from '@material-symbols/svg-400/rounded/speed.svg?raw';
import thermostat from '@material-symbols/svg-400/rounded/thermostat.svg?raw';
import thunderstorm from '@material-symbols/svg-400/rounded/thunderstorm.svg?raw';
import visibility from '@material-symbols/svg-400/rounded/visibility.svg?raw';
import waterDrop from '@material-symbols/svg-400/rounded/water_drop.svg?raw';

const ICONS = {
  arrowBack, calendarToday, camping, flag, restaurant, route, timer, trendingUp, warning, wbSunny,
  acUnit, air, batteryAlert, bolt, checkroom, cloud, deviceThermostat, directionsWalk, fastForward, favorite, flashlightOn, keyboardArrowDown, keyboardArrowUp, foggy, groups, healing, hiking, history, home,
  landscape, layers, listAlt, map, minimize, mobile, monitorHeart, myLocation, openInFull, partlyCloudyDay, pause, playArrow, playCircle, psychology,
  rainy, schedule, sentimentWorried, settings, speed, thermostat, thunderstorm, visibility, waterDrop,
} as const;

export type IconName = keyof typeof ICONS;

const cache = new Map<IconName, SVGElement>();

/** アイコンの SVG 要素を作る。飾りなので読み上げ対象から外す（意味は隣の文字か aria-label で伝える） */
export function icon(name: IconName, cls = ''): SVGElement {
  let base = cache.get(name);
  if (!base) {
    const t = document.createElement('template');
    t.innerHTML = ICONS[name].trim();
    base = t.content.firstElementChild as SVGElement;
    base.removeAttribute('width');
    base.removeAttribute('height');
    base.setAttribute('fill', 'currentColor');
    base.setAttribute('aria-hidden', 'true');
    base.setAttribute('focusable', 'false');
    cache.set(name, base);
  }
  const svg = base.cloneNode(true) as SVGElement;
  svg.setAttribute('class', `ic${cls ? ` ${cls}` : ''}`);
  return svg;
}

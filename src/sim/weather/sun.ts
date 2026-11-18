/**
 * 太陽と暗さ（docs/05 §4）。雲が多いと暗くなるのが早い: effectiveSunElev = sunElev − 3 × cloudCover。
 */
import { solarElevationDeg, sunParamsOf } from '../core/clock';
import { TUNING, type Tuning } from '../tuning';
import type { ScenarioDef, StaticContext, SunState, World } from '../types';

export function sunStateAt(scenario: ScenarioDef, tMin: number, cloudCover: number, tuning: Tuning = TUNING): SunState {
  const elevDeg = solarElevationDeg(tMin, sunParamsOf(scenario.sun, scenario.season, tuning));
  const eff = elevDeg - tuning.sun.cloudDarkeningDeg * cloudCover;
  return {
    elevDeg,
    isDark: eff < tuning.sun.darkBelowDeg,
    twilight: eff >= tuning.sun.darkBelowDeg && eff < 0,
    moonIllum: scenario.moon?.illumination ?? 0,
  };
}

export function updateSun(world: World, ctx: StaticContext): void {
  world.sun = sunStateAt(ctx.scenario, world.tMin, world.weather.cloudCover, ctx.tuning);
}

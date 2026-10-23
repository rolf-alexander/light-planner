// Combines sun, slope and horizon into "is this spot in direct sunlight?".

import { horizonAt, type HorizonProfile } from './horizon';
import { cosIncidence, sunPosition, type SunPosition } from './sun';

export type LightState =
  | 'sun' // direct sunlight
  | 'self-shadow' // sun is up and clear of the mountains, but behind this slope
  | 'terrain-shadow' // sun is up, but hidden behind surrounding terrain
  | 'night'; // sun is below the horizon

export interface Surface {
  lat: number;
  lng: number;
  slopeDeg: number;
  aspectDeg: number | null;
}

export interface Lighting {
  state: LightState;
  sun: SunPosition;
  /** Fraction of full-strength sun on the slope (cosine of the incidence angle). */
  cosIncidence: number;
  horizonDeg: number;
}

export function lightingAt(time: Date, surface: Surface, horizon: HorizonProfile): Lighting {
  const sun = sunPosition(time, surface.lat, surface.lng);
  const horizonDeg = horizonAt(horizon, sun.azimuthDeg);
  const cosI = cosIncidence(sun, surface.slopeDeg, surface.aspectDeg);

  let state: LightState;
  if (sun.apparentElevationDeg <= horizonDeg) {
    // On a summit the horizon can dip below 0°, so "night" means below the true
    // horizon AND below the ridgeline, not just below 0°.
    state = sun.apparentElevationDeg < 0 ? 'night' : 'terrain-shadow';
  } else {
    state = cosI > 0 ? 'sun' : 'self-shadow';
  }
  return { state, sun, cosIncidence: cosI, horizonDeg };
}

export interface LightRun {
  state: LightState;
  /** Minutes after local midnight. */
  startMin: number;
  endMin: number;
}

const STEP_MIN = 2;

/** Light through one local calendar day, grouped into runs of the same state. */
export function dayLight(midnight: Date, dayLengthMin: number, surface: Surface, horizon: HorizonProfile): LightRun[] {
  const runs: LightRun[] = [];
  for (let m = 0; m < dayLengthMin; m += STEP_MIN) {
    const { state } = lightingAt(new Date(midnight.getTime() + m * 60_000), surface, horizon);
    const last = runs[runs.length - 1];
    if (last?.state === state) last.endMin = m + STEP_MIN;
    else runs.push({ state, startMin: m, endMin: m + STEP_MIN });
  }
  runs[runs.length - 1].endMin = dayLengthMin;
  return runs;
}

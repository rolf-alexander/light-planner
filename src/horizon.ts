// How high the surrounding mountains rise above a spot, in every direction.

import { EARTH_RADIUS_M, elevationAt, loadArea, pixelSizeM, toWorldPixel } from './dem';

// Distant ridges need less detail, so read a coarser zoom: ~53 m pixels in the Alps.
const HORIZON_ZOOM = 11;
const MAX_DISTANCE_M = 20_000; // beyond this, ridges rarely rise above ~1–2°
const AZIMUTH_STEP_DEG = 2; // 180 rays
const FIRST_STEP_M = 50;
const STEP_GROWTH = 0.015; // further out, step 1.5% of the distance so far
const EYE_HEIGHT_M = 2; // look from just above the ground, not from inside it
// Light curves slightly downwards in the atmosphere, so the Earth looks flatter
// than it is. Surveyors model this with a bigger radius: R / (1 − k), k ≈ 0.13.
const EFFECTIVE_RADIUS_M = EARTH_RADIUS_M / (1 - 0.13);

/** Horizon elevation angle in degrees, for each bearing 0°, 2°, 4°, … 358°. */
export type HorizonProfile = Float32Array;

export async function computeHorizon(lng: number, lat: number): Promise<HorizonProfile> {
  const z = HORIZON_ZOOM;
  const { x, y } = toWorldPixel(lng, lat, z);
  const cell = pixelSizeM(lat, z);
  const reachPx = MAX_DISTANCE_M / cell + 2;
  await loadArea(z, x - reachPx, y - reachPx, x + reachPx, y + reachPx);

  const observerM = elevationAt(z, x, y) + EYE_HEIGHT_M;
  const profile = new Float32Array(360 / AZIMUTH_STEP_DEG);

  for (let k = 0; k < profile.length; k++) {
    // A step of 1 m along bearing A moves (sin A, cos A) metres (east, north).
    // Pixel y grows southwards, hence the minus. Mercator is conformal, so the
    // same metres-per-pixel works in both directions.
    const bearing = k * AZIMUTH_STEP_DEG * (Math.PI / 180);
    const dxPerM = Math.sin(bearing) / cell;
    const dyPerM = -Math.cos(bearing) / cell;

    // Walk outwards and keep the steepest line of sight. The angle to a point
    // is arctan(rise / distance), and arctan is increasing, so the largest
    // gradient gives the largest angle: take arctan once at the end.
    let steepest = -Infinity;
    for (let d = FIRST_STEP_M; d <= MAX_DISTANCE_M; d += Math.max(FIRST_STEP_M, d * STEP_GROWTH)) {
      // The ground curves away below a flat line by d²/2R (from Pythagoras,
      // (R + drop)² = R² + d², with drop² tiny), so far peaks sit a little lower.
      const curvatureDrop = (d * d) / (2 * EFFECTIVE_RADIUS_M);
      const rise = elevationAt(z, x + dxPerM * d, y + dyPerM * d) - observerM - curvatureDrop;
      steepest = Math.max(steepest, rise / d);
    }
    profile[k] = Math.atan(steepest) * (180 / Math.PI);
  }
  return profile;
}

/** Horizon angle at any bearing, linearly interpolated between the two nearest rays. */
export function horizonAt(profile: HorizonProfile, azimuthDeg: number): number {
  const position = (((azimuthDeg % 360) + 360) % 360) / AZIMUTH_STEP_DEG;
  const i = Math.floor(position);
  const t = position - i;
  return profile[i % profile.length] * (1 - t) + profile[(i + 1) % profile.length] * t;
}

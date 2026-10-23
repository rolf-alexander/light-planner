// Turns a grid of heights plus a sun position into a lighting overlay tile.
// Pure maths: runs inside the light worker, but has no browser dependencies.

import { EARTH_RADIUS_M } from './dem';
import type { SunPosition } from './sun';

export interface ShadeInput {
  /** Heights in metres, row by row, north at the top. */
  grid: Float32Array;
  width: number;
  height: number;
  /** Where the output tile starts inside the grid (the rest is margin). */
  offsetX: number;
  offsetY: number;
  /** Output tile width and height in pixels. */
  size: number;
  /** Ground distance between neighbouring grid cells, in metres. */
  cellM: number;
  /** The sun as seen from output pixel (col, row). */
  sunAt: (col: number, row: number) => SunPosition;
  /** Sun used for cast shadows, or null to skip them (when pixels are far bigger than shadows). */
  shadowSun: SunPosition | null;
}

// Overlay colours (RGB) and strengths (alpha, 0–1).
const SHADE = [10, 22, 48];
const WARM = [255, 165, 60];
const SHADE_ALPHA = 0.6; // full shadow by day
const NIGHT_ALPHA = 0.75; // once the sun is 6° below the horizon
const WARM_ALPHA = 0.22; // golden light when the sun is low

/** RGBA pixels (size × size) to draw over the map. */
export function shadeTile(input: ShadeInput): Uint8ClampedArray<ArrayBuffer> {
  const { grid, width, offsetX, offsetY, size, cellM, sunAt, shadowSun } = input;
  const out = new Uint8ClampedArray(size * size * 4);
  const inSight = shadowSun ? castShadows(input, shadowSun) : null;

  // Usually every pixel shares one sun, so only redo these when it changes.
  let lastSun: SunPosition | null = null;
  let h = 0, shadeAlpha = 0, warmAlpha = 0;
  let sunVec: [number, number, number] = [0, 0, 1];

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const sun = sunAt(i, j);
      if (sun !== lastSun) {
        lastSun = sun;
        h = sun.apparentElevationDeg;
        // Twilight: shade deepens as the sun sinks further below the horizon.
        shadeAlpha = SHADE_ALPHA + (NIGHT_ALPHA - SHADE_ALPHA) * clamp(-h / 6, 0, 1);
        // Golden hour: warm tint fades out as the sun climbs past 12°.
        warmAlpha = WARM_ALPHA * clamp(1 - h / 12, 0, 1);
        sunVec = sunVector(sun);
      }

      const g = (j + offsetY) * width + (i + offsetX);
      const canSee = (!inSight || inSight[g] === 1) && h > -horizonDipDeg(grid[g]);
      const illumination = canSee ? Math.max(0, cosIncidence(grid, width, g, cellM, sunVec)) : 0;

      // Two see-through layers, "over" each other: warm light, then shade on top.
      const aShade = shadeAlpha * (1 - illumination);
      const aWarm = warmAlpha * illumination * (1 - aShade);
      const alpha = aShade + aWarm;
      const o = (j * size + i) * 4;
      if (alpha > 0) {
        for (let c = 0; c < 3; c++) out[o + c] = (SHADE[c] * aShade + WARM[c] * aWarm) / alpha;
      }
      out[o + 3] = alpha * 255;
    }
  }
  return out;
}

/**
 * Which grid cells can see the sun (1) and which are in a cast shadow (0).
 *
 * Imagine the sun's rays skimming the terrain. Moving one step away from the
 * sun, a ray drops by Δ·tan h. So sweep across the grid starting at the sun's
 * side, carrying a "shadow surface" S: each cell's S is the higher of its own
 * height and the S of its sun-side neighbour minus that drop. A cell is in
 * shadow when the neighbour's surface, minus the drop, is above the ground.
 * Every cell is visited once, instead of tracing a separate ray from each.
 */
function castShadows({ grid, width, height, cellM }: ShadeInput, sun: SunPosition): Uint8Array {
  const azimuth = (sun.azimuthDeg * Math.PI) / 180;
  // Direction towards the sun in grid steps; grid y grows southwards.
  const sx = Math.sin(azimuth);
  const sy = -Math.cos(azimuth);

  // Step one whole cell along whichever axis the sun is more aligned with
  // (the "major" axis) and a fraction of a cell along the other.
  const yMajor = Math.abs(sy) >= Math.abs(sx);
  const majorLen = yMajor ? height : width;
  const minorLen = yMajor ? width : height;
  const majorStride = yMajor ? width : 1;
  const minorStride = yMajor ? 1 : width;
  const majorDir = Math.sign(yMajor ? sy : sx) || 1;
  const minorShift = (yMajor ? sx : sy) / Math.abs(yMajor ? sy : sx);

  const stepM = cellM * Math.hypot(1, minorShift); // Pythagoras: length of one step
  const drop = stepM * Math.tan((sun.apparentElevationDeg * Math.PI) / 180);

  const surface = new Float32Array(grid.length);
  const inSight = new Uint8Array(grid.length);

  // Lines are processed starting from the sun's side, so each line's sun-side
  // neighbour line is always already done.
  const first = majorDir < 0 ? 0 : majorLen - 1;
  for (let k = 0; k < majorLen; k++) {
    const line = first - majorDir * k;
    const prevLine = line + majorDir; // one step towards the sun
    for (let m = 0; m < minorLen; m++) {
      const idx = line * majorStride + m * minorStride;
      const ground = grid[idx];

      // The sun-side neighbour usually falls between two cells: interpolate.
      const pos = m + minorShift;
      const m0 = Math.floor(pos);
      let shadowTop = -Infinity;
      if (k > 0 && m0 >= 0 && m0 + 1 < minorLen) {
        const t = pos - m0;
        const a = surface[prevLine * majorStride + m0 * minorStride];
        const b = surface[prevLine * majorStride + (m0 + 1) * minorStride];
        shadowTop = a + (b - a) * t - drop;
      }

      inSight[idx] = ground >= shadowTop ? 1 : 0;
      surface[idx] = Math.max(ground, shadowTop);
    }
  }
  return inSight;
}

/** Unit vector towards the sun in (east, north, up). */
function sunVector(sun: SunPosition): [number, number, number] {
  const h = (sun.apparentElevationDeg * Math.PI) / 180;
  const a = (sun.azimuthDeg * Math.PI) / 180;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}

/**
 * cos of the angle between the sun and the ground's normal at cell g, using
 * Horn's gradient (as in terrain.ts). A surface z = f(x, y) has normal
 * (−∂z/∂x, −∂z/∂y, 1), which we normalise before the dot product.
 */
function cosIncidence(grid: Float32Array, width: number, g: number, cellM: number, s: [number, number, number]): number {
  const a = grid[g - width - 1], b = grid[g - width], c = grid[g - width + 1];
  const d = grid[g - 1], f = grid[g + 1];
  const p = grid[g + width - 1], q = grid[g + width], r = grid[g + width + 1];
  const dzdx = (c + 2 * f + r - (a + 2 * d + p)) / (8 * cellM);
  const dzdy = (a + 2 * b + c - (p + 2 * q + r)) / (8 * cellM);
  return (-dzdx * s[0] - dzdy * s[1] + s[2]) / Math.hypot(dzdx, dzdy, 1);
}

/**
 * From height e you can see slightly below 0°, because the Earth curves away.
 * The tangent to a circle meets the radius at 90°, so cos(dip) = R / (R + e).
 * This lets summits keep the evening sun after the valleys lose it.
 */
function horizonDipDeg(elevationM: number): number {
  if (elevationM <= 0) return 0;
  return (Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + elevationM)) * 180) / Math.PI;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Pure terrain maths. Nothing in here touches the browser, so it can be
// tested on its own with plain numbers.

/** Decode one Terrarium pixel (R, G, B each 0–255) to metres above sea level. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Bilinear interpolation inside one grid square.
 * z00 is the top-left corner, z10 top-right, z01 bottom-left, z11 bottom-right.
 * tx, ty are how far across (0–1) the point is from the left and top edges.
 */
export function bilinear(z00: number, z10: number, z01: number, z11: number, tx: number, ty: number): number {
  const top = z00 + (z10 - z00) * tx;
  const bottom = z01 + (z11 - z01) * tx;
  return top + (bottom - top) * ty;
}

export interface SlopeAspect {
  /** Angle of the surface from horizontal, 0° (flat) to 90° (vertical). */
  slopeDeg: number;
  /** Compass bearing the slope faces (downhill), 0° = N, 90° = E. null when flat. */
  aspectDeg: number | null;
}

/**
 * Slope and aspect from a 3×3 window of elevations, using Horn's method.
 *
 * The window is given row by row with north at the top:
 *   a b c
 *   d e f
 *   g h i
 * cellSize is the ground distance in metres between neighbouring pixel centres.
 */
export function slopeAspect(window: number[], cellSize: number): SlopeAspect {
  const [a, b, c, d, , f, g, h, i] = window;

  // Partial derivatives ∂z/∂x (eastward) and ∂z/∂y (northward). Each is a
  // weighted average of three central differences across 2 cells, with the
  // middle row/column counted twice: total weight 4, distance 2 → divide by 8.
  const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
  const dzdy = (a + 2 * b + c - (g + 2 * h + i)) / (8 * cellSize);

  // The gradient's magnitude is rise over run in the steepest direction.
  const gradient = Math.hypot(dzdx, dzdy);
  const slopeDeg = toDegrees(Math.atan(gradient));

  // On (near-)flat ground the downhill direction is just noise.
  if (slopeDeg < 0.5) return { slopeDeg, aspectDeg: null };

  // Downhill is the direction of -∇z = (-dzdx, -dzdy). A compass bearing is
  // measured clockwise from north, so it is atan2(east, north), not atan2(y, x).
  const aspectDeg = (toDegrees(Math.atan2(-dzdx, -dzdy)) + 360) % 360;
  return { slopeDeg, aspectDeg };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** 0–360° bearing to the nearest of the 8 compass points. */
export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round(bearingDeg / 45) % 8];
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

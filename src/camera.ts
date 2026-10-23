// Where a direction in the world (like "towards the sun") appears on screen.

export interface ScreenPoint {
  x: number;
  y: number;
}

interface View {
  bearingDeg: number;
  pitchDeg: number;
  /** Vertical field of view: the angle from the bottom of the screen to the top. */
  fovDeg: number;
  width: number;
  height: number;
}

/**
 * Projects a direction d = (east, north, up) through the camera.
 *
 * The camera has three perpendicular unit vectors:
 *   forward f: where it looks (pitch 0 = straight down, 90 = level)
 *   up u:      towards the top of the screen
 *   right r:   towards the right of the screen, r = f × u
 * Dotting d with each gives its coordinates in the camera's own frame. A
 * pinhole camera then divides by depth (similar triangles): something twice
 * as far away appears half as far from the centre of the screen.
 *
 * Returns the screen position, plus whether it lies in front of the camera.
 */
export function projectDirection(d: [number, number, number], view: View): ScreenPoint & { inFront: boolean } {
  const b = (view.bearingDeg * Math.PI) / 180;
  const p = (view.pitchDeg * Math.PI) / 180;
  const f = [Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), -Math.cos(p)];
  const u = [Math.sin(b) * Math.cos(p), Math.cos(b) * Math.cos(p), Math.sin(p)];
  const r = [Math.cos(b), -Math.sin(b), 0];

  const dot = (v: number[]) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  const right = dot(r);
  const up = dot(u);
  const depth = dot(f);

  // Pixels per unit of (sideways ÷ depth): half the screen height matches tan(fov/2).
  const focal = view.height / 2 / Math.tan((view.fovDeg * Math.PI) / 360);
  if (depth <= 0) {
    // Behind the camera, the division would flip it; just report the direction.
    return { x: view.width / 2 + right * view.width, y: view.height / 2 - up * view.height, inFront: false };
  }
  return { x: view.width / 2 + (focal * right) / depth, y: view.height / 2 - (focal * up) / depth, inFront: true };
}

interface CameraPlacement {
  bearingDeg: number;
  pitchDeg: number;
  fovDeg: number;
  /** Screen height in pixels. */
  height: number;
  /** Ground size of one screen pixel at the map centre. */
  metresPerPx: number;
}

/**
 * Where the camera sits, in metres (east, north, up) from the map centre.
 * MapLibre places it so that the centre is mid-screen, at a distance where
 * half the screen height spans half the field of view:
 *   distance = (height / 2) / tan(fov / 2) pixels.
 * The camera sits on a line tilted by the pitch from straight up: cos(pitch)
 * of that distance above the centre and sin(pitch) of it back along the bearing.
 */
export function cameraOffset({ bearingDeg, pitchDeg, fovDeg, height, metresPerPx }: CameraPlacement): [number, number, number] {
  const distance = (height / 2 / Math.tan((fovDeg * Math.PI) / 360)) * metresPerPx;
  const p = (pitchDeg * Math.PI) / 180;
  const b = (bearingDeg * Math.PI) / 180;
  const back = distance * Math.sin(p);
  return [-back * Math.sin(b), -back * Math.cos(b), distance * Math.cos(p)];
}

/**
 * Does a ray from point P in unit direction d hit a sphere of radius R
 * centred on the origin? Points on the ray are P + t·d, so solve
 *   |P + t·d|² = R²  →  t² + 2(P·d)t + (|P|² − R²) = 0.
 * Real roots need the discriminant (P·d)² − (|P|² − R²) ≥ 0. From outside
 * the sphere the roots share a sign, and they're in front (t > 0) only if
 * P·d < 0, i.e. the ray is heading towards the sphere's centre.
 */
export function rayHitsSphere(p: [number, number, number], d: [number, number, number], radius: number): boolean {
  const pd = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const pp = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  return pd < 0 && pd * pd >= pp - radius * radius;
}

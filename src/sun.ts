// Where the sun is in the sky. Pure maths, like terrain.ts.
//
// Uses the low-precision formulae from Astronomy Answers (aa.quae.nl), the
// same ones behind the popular suncalc library. They model the Earth's orbit
// as a near-circle plus a small correction, and are good to roughly 0.1°,
// which is well under a minute of sunrise time.

const RAD = Math.PI / 180;
const MS_PER_DAY = 86_400_000;
const J2000_UNIX_DAYS = 10_957.5; // 2000-01-01 12:00 UTC, counted in days since 1970
const OBLIQUITY = 23.4397 * RAD; // tilt of the Earth's axis

export interface SunPosition {
  /** Compass bearing of the sun, 0° = N, 90° = E. */
  azimuthDeg: number;
  /** Geometric angle above a flat horizon, ignoring the atmosphere. */
  elevationDeg: number;
  /** What you actually see: the atmosphere bends light and lifts the sun slightly. */
  apparentElevationDeg: number;
}

export function sunPosition(date: Date, lat: number, lng: number): SunPosition {
  const d = date.getTime() / MS_PER_DAY - J2000_UNIX_DAYS; // days since J2000

  // 1. Where the sun sits along the ecliptic (its yearly path round the sky).
  // M grows steadily through 360° per year; C corrects for the orbit being an
  // ellipse, so the Earth moves faster near the sun (a Fourier series in M).
  const M = (357.5291 + 0.98560028 * d) * RAD;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const eclipticLng = M + C + (102.9372 + 180) * RAD;

  // 2. Rotate that into equatorial coordinates by the axial tilt:
  // declination δ (like a latitude on the sky), right ascension α (like a longitude).
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(eclipticLng));
  const rightAscension = Math.atan2(Math.sin(eclipticLng) * Math.cos(OBLIQUITY), Math.cos(eclipticLng));

  // 3. The Earth spins once per sidereal day (slightly under 24 h). The hour
  // angle H is how far the sun has turned past your meridian: 0 at solar noon.
  const siderealTime = (280.16 + 360.9856235 * d) * RAD + lng * RAD;
  const H = siderealTime - rightAscension;

  // 4. Spherical trigonometry turns (δ, H) into height and bearing for latitude φ.
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(H));
  // This atan2 measures from south, positive westwards; +180° makes it a compass bearing.
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi));

  const elevationDeg = elevation / RAD;
  return {
    azimuthDeg: (fromSouth / RAD + 180 + 360) % 360,
    elevationDeg,
    apparentElevationDeg: elevationDeg + refractionDeg(elevationDeg),
  };
}

/**
 * Atmospheric refraction (Sæmundsson's formula). About 0.57° at the horizon,
 * which is more than the sun's own width, falling to almost nothing overhead.
 */
function refractionDeg(elevationDeg: number): number {
  if (elevationDeg < -1) return 0;
  const arcMinutes = 1.02 / Math.tan((elevationDeg + 10.3 / (elevationDeg + 5.11)) * RAD);
  return arcMinutes / 60;
}

/**
 * Cosine of the angle between the sun's rays and the slope's normal (the
 * line sticking straight out of the ground). It's the dot product of two unit
 * vectors in (east, north, up):
 *   sun    s = (cos h sin A, cos h cos A, sin h)
 *   normal n = (sin θ sin β, sin θ cos β, cos θ)
 *   s·n = sin h cos θ + cos h sin θ cos(A − β)
 * 1 means the sun hits the slope face-on; 0 or less means it is behind it.
 * It is also the fraction of full-strength sunshine the surface receives.
 */
export function cosIncidence(sun: SunPosition, slopeDeg: number, aspectDeg: number | null): number {
  const h = sun.apparentElevationDeg * RAD;
  const theta = slopeDeg * RAD;
  const beta = (aspectDeg ?? 0) * RAD; // flat ground: aspect doesn't matter as sin θ ≈ 0
  return Math.sin(h) * Math.cos(theta) + Math.cos(h) * Math.sin(theta) * Math.cos(sun.azimuthDeg * RAD - beta);
}

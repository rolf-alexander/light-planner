// Sky colours that follow the sun: night blue, warm at sunrise/sunset, day blue.

interface Palette {
  sky: string;
  horizon: string;
  fog: string;
}

const NIGHT: Palette = { sky: '#0b1530', horizon: '#1d2b4d', fog: '#111c33' };
const GOLDEN: Palette = { sky: '#6f8fc4', horizon: '#ffbe85', fog: '#f3d7b8' };
const DAY: Palette = { sky: '#5ea3e8', horizon: '#cfe6fa', fog: '#e6f0f8' };

export function skyFor(sunElevationDeg: number) {
  // Piecewise linear: night → golden as the sun rises from −6° to 0°,
  // then golden → day from 0° to 10°.
  const p =
    sunElevationDeg < 0
      ? mix(NIGHT, GOLDEN, (sunElevationDeg + 6) / 6)
      : mix(GOLDEN, DAY, sunElevationDeg / 10);
  return {
    'sky-color': p.sky,
    'horizon-color': p.horizon,
    'fog-color': p.fog,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.9,
  };
}

function mix(a: Palette, b: Palette, t: number): Palette {
  t = Math.min(Math.max(t, 0), 1);
  return { sky: mixHex(a.sky, b.sky, t), horizon: mixHex(a.horizon, b.horizon, t), fog: mixHex(a.fog, b.fog, t) };
}

/** Linear interpolation of each colour channel: a + (b − a)·t. */
function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t));
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

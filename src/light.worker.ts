// Runs in a Web Worker: a separate thread, so the heavy sums never make the
// map stutter. Receives tile requests, replies with finished images.

import { latitudeOfWorldY, loadArea, pixelSizeM, readGrid, TILE_SIZE } from './dem';
import { shadeTile } from './shading';
import { sunAt, sunSeenFrom } from './sun';

export interface TileRequest {
  type: 'tile';
  id: number;
  z: number;
  x: number;
  y: number;
  time: number;
}

export type WorkerMessage = TileRequest | { type: 'cancel'; id: number };

export type WorkerReply = { id: number; bitmap: ImageBitmap } | { id: number; error: string };

// Shadows can't be longer than the tallest relief divided by tan(sun elevation)
// (the shadow of a height H on flat ground has length H / tan h). Cap at 15 km.
const MAX_RELIEF_M = 4000;
const MAX_SHADOW_M = 15_000;
// Below this zoom a pixel is over ~400 m wide, bigger than most shadows.
const SHADOW_MIN_ZOOM = 8;

const cancelled = new Set<number>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  try {
    const pixels = await renderTile(msg);
    if (cancelled.delete(msg.id)) return;
    const bitmap = await createImageBitmap(new ImageData(pixels, TILE_SIZE, TILE_SIZE));
    reply({ id: msg.id, bitmap }, [bitmap]);
  } catch (err) {
    if (!cancelled.delete(msg.id)) reply({ id: msg.id, error: String(err) });
  }
};

function reply(message: WorkerReply, transfer: Transferable[] = []) {
  // Transferring hands the image over without copying it.
  self.postMessage(message, { transfer });
}

async function renderTile({ z, x, y, time }: TileRequest): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const sunNow = sunAt(new Date(time)); // the half of the sum that only depends on time
  const lat = latitudeOfWorldY((y + 0.5) * TILE_SIZE, z);
  const lng = ((x + 0.5) / 2 ** z) * 360 - 180;
  const cellM = pixelSizeM(lat, z);
  const size = TILE_SIZE;

  if (z < SHADOW_MIN_ZOOM) {
    // Zoomed out, a tile can span a continent, so work the sun out for every
    // pixel. Shadows are far smaller than a pixel here, so skip them.
    const rowLat = Array.from({ length: size }, (_, j) => latitudeOfWorldY(y * size + j + 0.5, z));
    const colLng = Array.from({ length: size }, (_, i) => ((x * size + i + 0.5) / (size * 2 ** z)) * 360 - 180);
    await loadArea(z, x * size - 1, y * size - 1, x * size + size, y * size + size);
    const grid = readGrid(z, x * size - 1, y * size - 1, size + 2, size + 2);
    return shadeTile({
      grid, width: size + 2, height: size + 2, offsetX: 1, offsetY: 1, size, cellM,
      sunAt: (i, j) => sunSeenFrom(sunNow, rowLat[j], colLng[i]),
      shadowSun: null,
    });
  }

  // Zoom 8+: a tile is under ~150 km across, so one sun position, taken at
  // its centre, is good enough for the whole tile.
  const sun = sunSeenFrom(sunNow, lat, lng);

  // Margin: only on the sun's side, since only terrain between a point and
  // the sun can shade it. Plus one cell all round for the slope calculation.
  const h = Math.max(sun.apparentElevationDeg, 0.5);
  const reachM = Math.min(MAX_SHADOW_M, MAX_RELIEF_M / Math.tan((h * Math.PI) / 180));
  const reachPx = Math.min(Math.ceil(reachM / cellM), 2 * TILE_SIZE);
  const a = (sun.azimuthDeg * Math.PI) / 180;
  const east = Math.sin(a);
  const south = -Math.cos(a);
  const left = 1 + Math.ceil(reachPx * Math.max(0, -east));
  const right = 1 + Math.ceil(reachPx * Math.max(0, east));
  const top = 1 + Math.ceil(reachPx * Math.max(0, -south));
  const bottom = 1 + Math.ceil(reachPx * Math.max(0, south));

  const x0 = x * TILE_SIZE - left;
  const y0 = y * TILE_SIZE - top;
  const width = TILE_SIZE + left + right;
  const height = TILE_SIZE + top + bottom;
  await loadArea(z, x0, y0, x0 + width - 1, y0 + height - 1);

  const grid = readGrid(z, x0, y0, width, height);
  return shadeTile({ grid, width, height, offsetX: left, offsetY: top, size, cellM, sunAt: () => sun, shadowSun: sun });
}

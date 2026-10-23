// Fetches Terrarium elevation tiles and reads heights from them.
//
// Positions are handled as "world pixels": at zoom z the whole Mercator map is
// a square 256·2^z pixels wide, and every place has an (x, y) on it.

import { bilinear, decodeTerrarium, slopeAspect, type SlopeAspect } from './terrain';

export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const TILE_SIZE = 256;
// Zoom level we read slope at. Higher = smaller pixels, but the source data in
// most places is ~30 m, so going much finer just reads interpolated values.
// At z13 a pixel is ~13 m across in the Alps.
const SAMPLE_ZOOM = 13;
// Web Mercator treats the Earth as a sphere with the WGS84 equatorial radius.
export const EARTH_RADIUS_M = 6378137;

export interface TerrainSample extends SlopeAspect {
  elevationM: number;
  /** Ground size of one DEM pixel, for context. */
  cellSizeM: number;
}

/** Longitude/latitude to world-pixel coordinates at zoom z. */
export function toWorldPixel(lng: number, lat: number, z: number): { x: number; y: number } {
  const worldPx = TILE_SIZE * 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  // Longitude maps linearly to x; latitude is stretched by y = ln(tan φ + sec φ),
  // which is what keeps small shapes undistorted.
  return {
    x: ((lng + 180) / 360) * worldPx,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldPx,
  };
}

/**
 * Ground size of one pixel in metres. Mercator stretches everything by sec φ,
 * so it is the equator's pixel size times cos φ. Being conformal, the stretch
 * is the same east–west and north–south, so one number covers both.
 */
export function pixelSizeM(lat: number, z: number): number {
  return (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** z);
}

export async function sampleTerrain(lng: number, lat: number): Promise<TerrainSample> {
  const z = SAMPLE_ZOOM;
  const { x, y } = toWorldPixel(lng, lat, z);

  // 3×3 window centred on the nearest pixel centre (centres sit at n + 0.5).
  const nx = Math.round(x - 0.5);
  const ny = Math.round(y - 0.5);
  await loadArea(z, nx - 1, ny - 1, nx + 1, ny + 1);
  const window = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => pixelElevation(z, nx + dx, ny + dy)));

  const cellSizeM = pixelSizeM(lat, z);
  return { elevationM: elevationAt(z, x, y), cellSizeM, ...slopeAspect(window, cellSizeM) };
}

/** Download every tile touching a rectangle of world pixels at zoom z. */
export async function loadArea(z: number, minX: number, minY: number, maxX: number, maxY: number): Promise<void> {
  const n = 2 ** z;
  const firstRow = Math.max(0, Math.floor(minY / TILE_SIZE));
  const lastRow = Math.min(n - 1, Math.floor(maxY / TILE_SIZE));
  const jobs: Promise<unknown>[] = [];
  for (let ty = firstRow; ty <= lastRow; ty++) {
    for (let tx = Math.floor(minX / TILE_SIZE); tx <= Math.floor(maxX / TILE_SIZE); tx++) {
      jobs.push(loadTile(z, ((tx % n) + n) % n, ty));
    }
  }
  await Promise.all(jobs);
}

/**
 * Height at any world-pixel position, bilinearly interpolated between the 4
 * nearest pixel centres. The area must already be loaded with loadArea.
 */
export function elevationAt(z: number, x: number, y: number): number {
  // Pixel n covers [n, n+1), so its centre is at n + 0.5. Shifting by 0.5
  // puts us in "pixel-centre" coordinates where centres sit on integers.
  const cx = x - 0.5;
  const cy = y - 0.5;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  return bilinear(
    pixelElevation(z, x0, y0),
    pixelElevation(z, x0 + 1, y0),
    pixelElevation(z, x0, y0 + 1),
    pixelElevation(z, x0 + 1, y0 + 1),
    cx - x0,
    cy - y0,
  );
}

/** Elevation of one whole pixel. Its tile must already be loaded. */
function pixelElevation(z: number, px: number, py: number): number {
  const worldPx = TILE_SIZE * 2 ** z;
  px = ((px % worldPx) + worldPx) % worldPx; // wrap around the antimeridian
  py = Math.min(Math.max(py, 0), worldPx - 1); // clamp at the map's top/bottom edge

  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const tile = loadedTiles.get(`${z}/${tx}/${ty}`);
  if (!tile) throw new Error(`Elevation tile ${z}/${tx}/${ty} used before it was loaded`);
  return tile[(py - ty * TILE_SIZE) * TILE_SIZE + (px - tx * TILE_SIZE)];
}

// Downloads in progress or done, so overlapping requests share one fetch...
const tileRequests = new Map<string, Promise<Float32Array>>();
// ...and finished tiles, so reading a height needs no await at all.
const loadedTiles = new Map<string, Float32Array>();

function loadTile(z: number, x: number, y: number): Promise<Float32Array> {
  const key = `${z}/${x}/${y}`;
  let request = tileRequests.get(key);
  if (!request) {
    request = fetchTile(z, x, y).then((tile) => {
      loadedTiles.set(key, tile);
      return tile;
    });
    request.catch(() => tileRequests.delete(key)); // allow a retry after a failure
    tileRequests.set(key, request);
  }
  return request;
}

async function fetchTile(z: number, x: number, y: number): Promise<Float32Array> {
  const url = DEM_TILES.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Elevation tile ${z}/${x}/${y} failed (${res.status})`);

  // The colours are data, not a picture: stop the browser "correcting" them.
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;

  const elevations = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let k = 0; k < elevations.length; k++) {
    elevations[k] = decodeTerrarium(rgba[4 * k], rgba[4 * k + 1], rgba[4 * k + 2]);
  }
  return elevations;
}

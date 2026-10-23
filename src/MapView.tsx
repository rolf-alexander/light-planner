import { useEffect, useRef } from 'react';
import {
  Map,
  Marker,
  NavigationControl,
  ScaleControl,
  TerrainControl,
  setWorkerUrl,
  type LngLat,
  type RasterTileSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre decodes tiles in a Web Worker loaded from a separate file. "?url"
// makes Vite copy that file into the build and give us its final address.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { cameraOffset, projectDirection, rayHitsSphere } from './camera';
import { DEM_TILES, EARTH_RADIUS_M } from './dem';
import { registerSunlightProtocol, sunlightTiles } from './lightTiles';
import { skyFor } from './sky';
import { sunPosition, type SunPosition } from './sun';

setWorkerUrl(workerUrl);

const DEM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles</a>';
const RAD = Math.PI / 180;
// From about this zoom the camera is low enough for nearby ridges to hide the sun.
const TERRAIN_CHECK_ZOOM = 9;

interface Props {
  time: Date;
  onTap: (lngLat: LngLat) => void;
  /** Called whenever the map has finished loading and drawing everything. */
  onIdle: () => void;
}

export function MapView({ time, onTap, onIdle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const sunDisc = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const loaded = useRef(false); // has the map's first load finished?
  const timeMs = time.getTime();
  const timeRef = useRef(timeMs);

  // The map is created once, but the callbacks may change between renders.
  // Reading them through a ref means the map always calls the latest version.
  const callbacks = useRef({ onTap, onIdle });
  useEffect(() => {
    callbacks.current = { onTap, onIdle };
  });

  useEffect(() => {
    registerSunlightProtocol();
    const start = new Date(timeRef.current);
    const map = new Map({
      container: container.current!,
      center: [7.6586, 45.9763], // the Matterhorn
      zoom: 12.5,
      pitch: 60,
      bearing: -30,
      maxPitch: 85,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
          terrain: {
            type: 'raster-dem',
            tiles: [DEM_TILES],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: DEM_ATTRIBUTION,
          },
          // Computed by our light worker. Above zoom 12, MapLibre enlarges
          // the z12 tiles rather than asking for finer ones.
          sunlight: {
            type: 'raster',
            tiles: sunlightTiles(start),
            tileSize: 256,
            maxzoom: 12,
          },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm' },
          {
            id: 'sunlight',
            type: 'raster',
            source: 'sunlight',
            paint: { 'raster-fade-duration': 150, 'raster-resampling': 'linear' },
          },
        ],
        terrain: { source: 'terrain', exaggeration: 1 },
        // A globe when zoomed out, easing into the flat map by about zoom 12.
        projection: { type: 'globe' },
        sky: skyFor(sunPosition(start, 45.9763, 7.6586).apparentElevationDeg),
      },
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ visualizePitch: true }));
    map.addControl(new TerrainControl({ source: 'terrain', exaggeration: 1 }));
    map.addControl(new ScaleControl(), 'bottom-left');

    const marker = new Marker({ color: '#e8590c' });
    // With terrain on, e.lngLat is where the tap ray hits the 3D surface,
    // not the flat map underneath it.
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat).addTo(map);
      callbacks.current.onTap(e.lngLat);
    });
    map.on('render', () => placeSun(map, sunDisc.current!, new Date(timeRef.current)));
    map.on('idle', () => callbacks.current.onIdle());
    // 'load' fires once, when the style is first ready. Catch up on any time
    // change made before then.
    map.once('load', () => {
      loaded.current = true;
      showTime(map, sunDisc.current!, new Date(timeRef.current));
    });

    return () => {
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
  }, []);

  // A new time means new lighting tiles and a new sky colour. (Not gated on
  // map.isStyleLoaded(): that is also false whenever any tile is loading.)
  useEffect(() => {
    timeRef.current = timeMs;
    const map = mapRef.current;
    if (map && loaded.current) showTime(map, sunDisc.current!, new Date(timeMs));
  }, [timeMs]);

  function faceTheSun() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const sun = sunPosition(new Date(timeRef.current), c.lat, c.lng);
    // Pitch 90° looks level, so pitch 90 + h looks straight at the sun. Aim a
    // little lower so the sun sits in the upper part of the screen.
    const pitch = Math.min(85, Math.max(30, 90 + sun.apparentElevationDeg - 0.3 * map.getVerticalFieldOfView()));
    map.easeTo({ bearing: sun.azimuthDeg, pitch, duration: 1500 });
  }

  return (
    <div className="map">
      <div ref={container} className="map-canvas" />
      <div ref={sunDisc} className="sun-disc" aria-hidden="true" />
      <button type="button" className="face-sun" onClick={faceTheSun} title="Turn the view towards the sun">
        ☀
      </button>
    </div>
  );
}

function showTime(map: Map, sunDisc: HTMLDivElement, time: Date) {
  map.getSource<RasterTileSource>('sunlight')?.setTiles(sunlightTiles(time));
  const c = map.getCenter();
  map.setSky(skyFor(sunPosition(time, c.lat, c.lng).apparentElevationDeg));
  placeSun(map, sunDisc, time);
}

/**
 * Moves the sun element to where the sun is on screen, or to the edge pointing at it.
 *
 * Works for the globe too: the sun is so far away that its rays are parallel,
 * so only its direction matters, and on a globe MapLibre still measures
 * bearing and pitch from the ground at the map centre.
 */
function placeSun(map: Map, el: HTMLDivElement, time: Date) {
  const c = map.getCenter();
  const sun = sunPosition(time, c.lat, c.lng);
  const h = sun.apparentElevationDeg * RAD;
  const a = sun.azimuthDeg * RAD;
  const dir: [number, number, number] = [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];

  // Hidden behind the Earth itself? Measure from the Earth's centre, which
  // is R + (centre elevation) straight below the map centre.
  const camera = cameraOffset(cameraPlacement(map));
  const fromEarthCentre: [number, number, number] = [
    camera[0],
    camera[1],
    camera[2] + EARTH_RADIUS_M + map.getCenterElevation(),
  ];
  if (rayHitsSphere(fromEarthCentre, dir, EARTH_RADIUS_M)) {
    el.dataset.state = 'down';
    return;
  }

  const width = map.getCanvas().clientWidth;
  const height = map.getCanvas().clientHeight;
  const p = projectDirection(dir, {
    bearingDeg: map.getBearing(),
    pitchDeg: map.getPitch(),
    fovDeg: map.getVerticalFieldOfView(),
    width,
    height,
  });

  const onScreen = p.inFront && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height;
  let { x, y } = p;
  if (onScreen) {
    // Mountains only matter once the camera is down among them.
    const nearGround = map.getZoom() >= TERRAIN_CHECK_ZOOM;
    el.dataset.state = nearGround && sunBlocked(map, sun) ? 'behind' : 'visible';
  } else {
    // Off screen: slide it along the line from the centre until it meets the
    // edge, so it points the way to turn.
    el.dataset.state = 'edge';
    const vx = x - width / 2;
    const vy = y - height / 2;
    const margin = 24;
    const t = Math.min((width / 2 - margin) / Math.abs(vx || 1e-9), (height / 2 - margin) / Math.abs(vy || 1e-9));
    x = width / 2 + vx * t;
    y = height / 2 + vy * t;
  }
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/**
 * Is a mountain between the camera and the sun? Walks along the line of
 * sight from the camera, which climbs at tan h per metre, and checks the
 * terrain MapLibre has loaded underneath it.
 */
function sunBlocked(map: Map, sun: SunPosition): boolean {
  const camera = cameraPosition(map);
  const tanH = Math.tan(sun.apparentElevationDeg * RAD);
  const a = sun.azimuthDeg * RAD;

  for (let s = 50; s < 40_000; s *= 1.1) {
    const ground = map.queryTerrainElevation(offset(camera, s * Math.sin(a), s * Math.cos(a)));
    if (ground !== null && ground > camera.altitude + s * tanH) return true;
  }
  return false;
}

/** Camera longitude, latitude and altitude, for when it is close to the ground. */
function cameraPosition(map: Map) {
  const [east, north, up] = cameraOffset(cameraPlacement(map));
  return { ...offset(map.getCenter(), east, north), altitude: map.getCenterElevation() + up };
}

function cameraPlacement(map: Map) {
  // MapLibre's zoom counts 512 px world tiles, and its globe is scaled so the
  // map centre matches the flat map's scale there.
  const zoomScale = 512 * 2 ** map.getZoom();
  return {
    bearingDeg: map.getBearing(),
    pitchDeg: map.getPitch(),
    fovDeg: map.getVerticalFieldOfView(),
    height: map.getCanvas().clientHeight,
    metresPerPx: (2 * Math.PI * EARTH_RADIUS_M * Math.cos(map.getCenter().lat * RAD)) / zoomScale,
  };
}

/**
 * Moves a position by some metres east and north. Over short distances the
 * sphere is nearly flat: 1 m north is 1/R radians of latitude, and 1 m east
 * is 1/(R cos φ) radians of longitude, as circles of latitude shrink by cos φ.
 */
function offset(from: { lng: number; lat: number }, eastM: number, northM: number) {
  return {
    lng: from.lng + eastM / (EARTH_RADIUS_M * Math.cos(from.lat * RAD)) / RAD,
    lat: from.lat + northM / EARTH_RADIUS_M / RAD,
  };
}

import { useEffect, useRef } from 'react';
import { Map, Marker, NavigationControl, ScaleControl, TerrainControl, setWorkerUrl, type LngLat } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre decodes tiles in a Web Worker loaded from a separate file. "?url"
// makes Vite copy that file into the build and give us its final address.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { DEM_TILES } from './dem';

setWorkerUrl(workerUrl);

const DEM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles</a>';

interface Props {
  onTap: (lngLat: LngLat) => void;
}

export function MapView({ onTap }: Props) {
  const container = useRef<HTMLDivElement>(null);

  // The map is created once, but onTap may change between renders. Reading it
  // through a ref means the click handler always calls the latest version.
  const onTapRef = useRef(onTap);
  useEffect(() => {
    onTapRef.current = onTap;
  });

  useEffect(() => {
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
          // Two sources from the same tiles: one bends the map into 3D, the
          // other draws shading. MapLibre recommends keeping them separate.
          terrain: {
            type: 'raster-dem',
            tiles: [DEM_TILES],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
            attribution: DEM_ATTRIBUTION,
          },
          hillshade: {
            type: 'raster-dem',
            tiles: [DEM_TILES],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
          },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm' },
          { id: 'hillshade', type: 'hillshade', source: 'hillshade', paint: { 'hillshade-exaggeration': 0.35 } },
        ],
        terrain: { source: 'terrain', exaggeration: 1 },
      },
    });

    map.addControl(new NavigationControl({ visualizePitch: true }));
    map.addControl(new TerrainControl({ source: 'terrain', exaggeration: 1 }));
    map.addControl(new ScaleControl(), 'bottom-left');

    const marker = new Marker({ color: '#e8590c' });
    // With terrain on, e.lngLat is where the tap ray hits the 3D surface,
    // not the flat map underneath it.
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat).addTo(map);
      onTapRef.current(e.lngLat);
    });

    return () => map.remove();
  }, []);

  return <div ref={container} className="map" />;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from 'maplibre-gl';
import { MapView } from './MapView';
import { Panel, type Spot } from './Panel';
import { sampleTerrain } from './dem';
import { computeHorizon } from './horizon';
import { dayLight, lightingAt } from './light';
import { sunPosition } from './sun';

const PLAY_STEP_MIN = 10;
const PLAY_PAUSE_MS = 80;

export function App() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [day, setDay] = useState(todayString);
  const [minutes, setMinutes] = useState(minutesNow);
  // Taps can overlap if tiles load slowly; only the newest tap may update the panel.
  const latestTap = useRef(0);

  function handleTap({ lng, lat }: LngLat) {
    const tap = ++latestTap.current;
    const update = (patch: Partial<Spot>) => {
      if (tap === latestTap.current) setSpot((s) => s && { ...s, ...patch });
    };
    setSpot({ lng, lat });
    // Slope needs a few nearby pixels and arrives fast; the horizon needs
    // ~20 km of terrain, so it follows a moment later.
    sampleTerrain(lng, lat).then((sample) => update({ sample }), (err) => update({ error: String(err) }));
    computeHorizon(lng, lat).then((horizon) => update({ horizon }), (err) => update({ error: String(err) }));
  }

  // Clocks change on two days a year, so a "day" can be 23, 24 or 25 hours long.
  const midnight = useMemo(() => parseDay(day), [day]);
  const dayLengthMin = Math.round((nextMidnight(midnight).getTime() - midnight.getTime()) / 60_000);
  const minute = Math.min(minutes, dayLengthMin - 1);
  const time = new Date(midnight.getTime() + minute * 60_000);

  const { sample, horizon } = spot ?? {};
  const surface = spot && sample && { lat: spot.lat, lng: spot.lng, slopeDeg: sample.slopeDeg, aspectDeg: sample.aspectDeg };
  const sun = spot && sunPosition(time, spot.lat, spot.lng);
  const lighting = surface && horizon ? lightingAt(time, surface, horizon) : null;
  // Re-scanning the day is only needed when the place or date changes, not on
  // every slider move. (surface is rebuilt each render, but only from sample.)
  const runs = useMemo(
    () => (surface && horizon ? dayLight(midnight, dayLengthMin, surface, horizon) : null),
    [sample, horizon, midnight, dayLengthMin],
  );

  function showNow() {
    setDay(todayString());
    setMinutes(minutesNow());
  }

  // Playing steps the clock forward, but only once the map has finished
  // drawing the previous step, so a slow phone simply plays more slowly.
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  });
  const step = () => setMinutes((m) => (Math.min(m, dayLengthMin - 1) + PLAY_STEP_MIN) % dayLengthMin);

  function togglePlay() {
    if (!playing) step();
    setPlaying(!playing);
  }

  function handleMapIdle() {
    if (playingRef.current) setTimeout(() => playingRef.current && step(), PLAY_PAUSE_MS);
  }

  return (
    <>
      <MapView time={time} onTap={handleTap} onIdle={handleMapIdle} />
      <aside className="panel">
        <Panel
          spot={spot}
          sun={sun}
          lighting={lighting}
          runs={runs}
          day={day}
          midnight={midnight}
          minute={minute}
          dayLengthMin={dayLengthMin}
          time={time}
          playing={playing}
          onDayChange={setDay}
          onMinuteChange={setMinutes}
          onNow={showNow}
          onTogglePlay={togglePlay}
        />
      </aside>
    </>
  );
}

// Dates are handled in this device's time zone.

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function nextMidnight(midnight: Date): Date {
  return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

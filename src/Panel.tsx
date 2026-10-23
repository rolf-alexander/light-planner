import type { TerrainSample } from './dem';
import type { HorizonProfile } from './horizon';
import type { Lighting, LightRun, LightState } from './light';
import type { SunPosition } from './sun';
import { compassPoint } from './terrain';

export interface Spot {
  lng: number;
  lat: number;
  sample?: TerrainSample;
  horizon?: HorizonProfile;
  error?: string;
}

interface Props {
  spot: Spot | null;
  sun: SunPosition | null;
  lighting: Lighting | null;
  runs: LightRun[] | null;
  day: string;
  midnight: Date;
  minute: number;
  dayLengthMin: number;
  time: Date;
  playing: boolean;
  onDayChange: (day: string) => void;
  onMinuteChange: (minute: number) => void;
  onNow: () => void;
  onTogglePlay: () => void;
}

const STATE_TEXT: Record<LightState, string> = {
  sun: 'Direct sun',
  'self-shadow': 'In shade: sun is behind this slope',
  'terrain-shadow': 'In shade: sun is behind the mountains',
  night: 'Sun is down',
};

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Panel(props: Props) {
  const { spot } = props;
  return (
    <>
      {spot ? <SpotReadout {...props} spot={spot} /> : <p className="hint">Tap the map to read the terrain and light.</p>}
      <TimeControls {...props} />
    </>
  );
}

function SpotReadout({ spot, sun, lighting, runs, midnight, minute, dayLengthMin }: Props & { spot: Spot }) {
  const coords = `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`;
  if (spot.error) return <p className="error">{spot.error}</p>;
  if (!spot.sample) return <p className="hint">Reading terrain at {coords}…</p>;

  const { elevationM, slopeDeg, aspectDeg, cellSizeM } = spot.sample;
  return (
    <>
      <dl>
        <div>
          <dt>Elevation</dt>
          <dd>{Math.round(elevationM)} m</dd>
        </div>
        <div>
          <dt>Slope</dt>
          <dd>{slopeDeg.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>Aspect</dt>
          <dd>{aspectDeg === null ? 'flat' : `${Math.round(aspectDeg)}° ${compassPoint(aspectDeg)}`}</dd>
        </div>
      </dl>

      {sun && (
        <p className="sun">
          Sun {Math.round(sun.azimuthDeg)}° {compassPoint(sun.azimuthDeg)}, {sun.apparentElevationDeg.toFixed(1)}° up
          {lighting && <> · ridge {lighting.horizonDeg.toFixed(1)}°</>}
        </p>
      )}

      {lighting ? (
        <p className={`light light-${lighting.state}`}>
          {STATE_TEXT[lighting.state]}
          {lighting.state === 'sun' && (
            <>
              {' '}
              · {Math.round(lighting.cosIncidence * 100)}% strength (hits at{' '}
              {Math.round((Math.acos(lighting.cosIncidence) * 180) / Math.PI)}° to face-on)
            </>
          )}
        </p>
      ) : (
        <p className="hint">Tracing the horizon…</p>
      )}

      {runs && <DaySummary runs={runs} midnight={midnight} minute={minute} dayLengthMin={dayLengthMin} />}

      <p className="meta">
        {coords} · DEM cell ≈ {cellSizeM.toFixed(0)} m
      </p>
    </>
  );
}

interface DaySummaryProps {
  runs: LightRun[];
  midnight: Date;
  minute: number;
  dayLengthMin: number;
}

function DaySummary({ runs, midnight, minute, dayLengthMin }: DaySummaryProps) {
  const sunny = runs.filter((r) => r.state === 'sun');
  const total = sunny.reduce((sum, r) => sum + r.endMin - r.startMin, 0);
  const pct = (m: number) => `${(m / dayLengthMin) * 100}%`;
  const clock = (m: number) => formatTime(new Date(midnight.getTime() + m * 60_000));

  return (
    <div className="day">
      <div className="timeline" role="img" aria-label="Light through the day">
        {runs.map((r) => (
          <span
            key={r.startMin}
            className={`run run-${r.state}`}
            style={{ left: pct(r.startMin), width: pct(r.endMin - r.startMin) }}
          />
        ))}
        <span className="now" style={{ left: pct(minute) }} />
      </div>
      <div className="ticks">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
      <p className="summary">
        {sunny.length === 0
          ? 'No direct sun on this spot today.'
          : `Direct sun ${sunny.map((r) => `${clock(r.startMin)}–${clock(r.endMin)}`).join(', ')} · ${duration(total)}`}
      </p>
    </div>
  );
}

function TimeControls(props: Props) {
  const { day, minute, dayLengthMin, time, playing, onDayChange, onMinuteChange, onNow, onTogglePlay } = props;
  return (
    <div className="controls">
      <input type="date" value={day} onChange={(e) => e.target.value && onDayChange(e.target.value)} aria-label="Date" />
      <button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play the day'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={dayLengthMin - 1}
        step={5}
        value={minute}
        onChange={(e) => onMinuteChange(Number(e.target.value))}
        aria-label="Time of day"
      />
      <output title={`Times are in ${TIME_ZONE}`}>{formatTime(time)}</output>
      <button type="button" onClick={onNow}>
        Now
      </button>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function duration(m: number): string {
  return `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;
}

import type {
  CollisionInterval,
  OutOfBoundsInterval,
  SessionTrajectory,
} from '@pathblender/core';
import { activeEndT } from '@pathblender/core';
import { useI18n } from '../i18n';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

interface Playback {
  t: number;
  setT: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
}

interface Props {
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  duration: number;
  playback: Playback;
}

export function Timeline({
  robots,
  conflicts,
  bounds,
  duration,
  playback,
}: Props) {
  const { t: tr } = useI18n();
  const { t, setT, playing, setPlaying, speed, setSpeed } = playback;
  const axisMax = Math.max(15, Math.ceil(duration));

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          className="btn icon transport"
          onClick={() => setPlaying(!playing)}
          disabled={duration === 0}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="seg speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={s === speed ? 'on' : ''}
              onClick={() => setSpeed(s)}
            >
              {tr('timeline.speed', { n: s })}
            </button>
          ))}
        </div>
        <span className="clock">
          {tr('timeline.clock', { t: t.toFixed(2), d: duration.toFixed(2) })}
        </span>
      </div>

      <div className="timeline-track">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.01}
          value={Math.min(t, duration)}
          disabled={duration === 0}
          onChange={(e) => setT(Number(e.target.value))}
        />
        <div className="ticks">
          {Array.from({ length: axisMax + 1 }, (_, i) => (
            <span key={i} className="tick" style={{ left: `${(i / axisMax) * 100}%` }}>
              {i}
            </span>
          ))}
        </div>
      </div>

      <div className="per-robot-bands">
        {robots.map((r) => {
          const span = Math.max(axisMax, duration) || 1;
          const eventDots = r.trajectory.events.map((ev, i) => (
            <div
              key={`ev-${i}`}
              className="band-event"
              style={{ left: `${(ev.t / span) * 100}%` }}
              title={`${ev.name} @ ${ev.t.toFixed(2)}s`}
            />
          ));
          const oobBands = bounds
            .filter((b) => b.robotId === r.trajectory.id)
            .map((b) => (
              <div
                key={`oob-${b.robotId}-${b.startT}`}
                className="band-oob"
                style={{
                  left: `${(b.startT / span) * 100}%`,
                  width: `${((b.endT - b.startT) / span) * 100}%`,
                }}
                title={tr('timeline.band', {
                  start: b.startT.toFixed(2),
                  end: b.endT.toFixed(2),
                })}
              />
            ));
          const bands = conflicts
            .filter((c) => c.aId === r.trajectory.id || c.bId === r.trajectory.id)
            .map((c) => (
              <div
                key={`${c.aId}-${c.bId}-${c.startT}`}
                className="band-conflict"
                style={{
                  left: `${(c.startT / span) * 100}%`,
                  width: `${((c.endT - c.startT) / span) * 100}%`,
                }}
                title={tr('timeline.band', { start: c.startT.toFixed(2), end: c.endT.toFixed(2) })}
              />
            ));
          const endPct = `${Math.min(100, (activeEndT(r) / span) * 100)}%`;
          return (
            <div key={r.trajectory.id} className="band-row">
              <span className="band-dot" style={{ background: r.color }} />
              <span className="band-name" title={r.trajectory.name}>
                {r.trajectory.name}
              </span>
              <div className="band-track">
                <div className="band-active" style={{ width: endPct, background: hexAlpha(r.color, 0.5) }} />
                {oobBands}
                {bands}
                {eventDots}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

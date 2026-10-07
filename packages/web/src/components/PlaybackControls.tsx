import { useI18n } from '../i18n';

const SPEEDS = [0.25, 0.5, 1];
/** The speed steps, shared with the keyboard stepper (Shift+, / Shift+.) —
 * one source so the buttons and the keys always agree. */
export const PLAYBACK_SPEEDS = SPEEDS;
export interface Playback {
  t: number;
  setT: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
}

function TransportIcon({ kind }: { kind: 'rewind' | 'back' | 'play' | 'pause' | 'forward' }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
      {kind === 'rewind' && <path d="M4 4h2v12H4zm12 .5v11L7 10z" />}
      {kind === 'back' && <path d="M9.5 5v10l-7-5zm8 0v10l-7-5z" />}
      {kind === 'forward' && <path d="M2.5 5v10l7-5zm8 0v10l7-5z" />}
      {kind === 'play' && <path d="M6 3.5v13L16 10z" />}
      {kind === 'pause' && <path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z" />}
    </svg>
  );
}

export function PlaybackControls({ playback, end }: { playback: Playback; end: number }) {
  const { t: tr, n } = useI18n();
  const { t, setT, playing, setPlaying, speed, setSpeed } = playback;
  const currentT = Math.min(end, Math.max(0, t));
  const seek = (time: number) => { setPlaying(false); setT(Math.min(end, Math.max(0, time))); };
  return (      <div className="timeline-playback-bar">
        <span className="clock timeline-clock">
          {tr('timeline.clock', { t: n(currentT, 2), d: n(end, 2) })}
        </span>
        <div className="timeline-transport">
          <button type="button" onClick={() => seek(0)} disabled={end === 0} aria-label={tr('timeline.rewind')} title={tr('timeline.rewind')}>
            <TransportIcon kind="rewind" />
          </button>
          <button type="button" onClick={() => seek(currentT - 0.5)} disabled={end === 0 || currentT === 0} aria-label={tr('timeline.stepBack')} title={tr('timeline.stepBack')}>
            <TransportIcon kind="back" />
          </button>
          <button
            type="button"
            className="timeline-play"
            onClick={() => setPlaying(!playing)}
            disabled={end === 0}
            aria-label={tr(playing ? 'timeline.pause' : 'timeline.play')}
            title={tr(playing ? 'timeline.pause' : 'timeline.play')}
          >
            <TransportIcon kind={playing ? 'pause' : 'play'} />
          </button>
          <button type="button" onClick={() => seek(currentT + 0.5)} disabled={end === 0 || currentT === end} aria-label={tr('timeline.stepForward')} title={tr('timeline.stepForward')}>
            <TransportIcon kind="forward" />
          </button>
        </div>
        <div className="timeline-speeds" role="group" aria-label={tr('timeline.playbackSpeed')}>
          {SPEEDS.map((s) => (
            <button type="button" key={s} aria-pressed={s === speed} onClick={() => setSpeed(s)}>
              {tr('timeline.speed', { n: n(s) })}
            </button>
          ))}
        </div>
      </div>
  );
}

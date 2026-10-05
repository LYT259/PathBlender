import type { CSSProperties, ReactNode } from 'react';
import type {
  CollisionInterval,
  OutOfBoundsInterval,
  SessionTrajectory,
} from '@pathblender/core';
import { activeEndT, activeStartT, sequenceEventTimes } from '@pathblender/core';
import { useI18n } from '../i18n';
import './Timeline.css';
import { robotIdentity } from '../robot-identity';
import { playbackEnd, timelineScale, type PlaybackRange } from '../playback-range';

const SPEEDS = [0.25, 0.5, 1];

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
  /** Current season's Autonomous Period (FieldPackage.autoPeriodS) — the
   *  ruler's floor so an empty/short session still spans the whole auto. */
  autoPeriodS: number;
  duration: number;
  /**
   * Duration of the VISIBLE robots only (bug report 2026-10-05): the
   * 'Current paths' range follows what is on the field right now, so hiding
   * the longest robot shortens the loop to the longest visible one. 'Full
   * timeline' keeps the whole session's extent, and the ruler never shrinks
   * mid-session; collision checks always run on the visible set
   * independently of either range.
   */
  visibleDuration?: number;
  playback: Playback;
  playbackRange?: PlaybackRange;
  onPlaybackRangeChange?: (range: PlaybackRange) => void;
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Double-clicking a team's row opens that team's arrange editor. */
  onEditTeam?: (id: string) => void;
  onJump?: (time: number, robotIds: string[]) => void;
  guide?: ReactNode;
  composeAction?: ReactNode;
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

export function Timeline({ robots, conflicts, bounds, autoPeriodS, duration, visibleDuration, playback, playbackRange = 'full', onPlaybackRangeChange, selectedId, onSelect, onEditTeam, onJump, guide, composeAction }: Props) {
  const { t: tr } = useI18n();
  const { t, setT, playing, setPlaying, speed, setSpeed } = playback;
  const rangeDuration = playbackRange === 'paths' && visibleDuration !== undefined ? visibleDuration : duration;
  const end = playbackEnd(rangeDuration, autoPeriodS, playbackRange);
  const currentT = Math.min(end, Math.max(0, t));
  // Ruler, range, activity, markers, and playhead all share this domain.
  const { axisMax, tickStep } = timelineScale(duration, autoPeriodS);
  const ticks = Array.from({ length: Math.floor(axisMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const percent = (time: number) => `${(Math.min(axisMax, Math.max(0, time)) / axisMax) * 100}%`;
  const intervalStyle = (start: number, finish: number): CSSProperties => ({
    left: percent(start),
    width: `${(Math.max(0, Math.min(axisMax, finish) - Math.max(0, start)) / axisMax) * 100}%`,
  });
  const seek = (time: number, robotId?: string) => {
    setPlaying(false);
    setT(Math.min(end, Math.max(0, time)));
    if (robotId) onSelect?.(robotId);
  };
  const jump = (time: number, robotIds: string[], selectedRobotId = robotIds[0]) => {
    // The workspace can reveal every participant, including hidden paths.
    if (onJump) onJump(Math.min(end, Math.max(0, time)), robotIds);
    else seek(time, selectedRobotId);
  };
  // The option label always names the current 'paths' end — visible robots only.
  const pathsEnd = playbackEnd(visibleDuration ?? duration, autoPeriodS, 'paths');

  return (
    <section className="timeline timeline-workspace" aria-label={tr('timeline.title')}>
      <div className="timeline-toolbar">
        <h2>{tr('timeline.title')}</h2>
        {composeAction}
        {onPlaybackRangeChange && <select
          className="timeline-range"
          aria-label={tr('timeline.range')}
          value={playbackRange}
          onChange={(event) => onPlaybackRangeChange(event.target.value as PlaybackRange)}
        >
          <option value="full">{tr('timeline.rangeFull')}</option>
          <option value="paths">{tr('timeline.rangePaths', { seconds: Number(pathsEnd.toFixed(2)) })}</option>
        </select>}
        {robots.length > 0 && (
          <div className="timeline-legend">
            <span><i className="timeline-legend-collision" />{tr('timeline.collision')}</span>
            <span><i className="timeline-legend-bounds" />{tr('timeline.outOfBounds')}</span>
            <span><i className="timeline-legend-event" />{tr('timeline.event')}</span>
          </div>
        )}
      </div>

      {robots.length === 0 ? <p className="timeline-empty">{tr('timeline.empty')}</p> : (
        <div className="timeline-scroller">
          <div className="timeline-surface">
            <div className="timeline-rows">
              {robots.map((robot) => {
                const { trajectory } = robot;
                const robotConflicts = conflicts.filter((c) => c.aId === trajectory.id || c.bId === trajectory.id);
                const robotBounds = bounds.filter((b) => b.robotId === trajectory.id);
                const activityLabel = tr('timeline.activity', {
                  name: robotIdentity(trajectory),
                  start: activeStartT(robot).toFixed(2),
                  end: activeEndT(robot).toFixed(2),
                });
                return (
                  <div
                    className={`timeline-row${selectedId === trajectory.id ? ' is-selected' : ''}`}
                    key={trajectory.id}
                    onDoubleClick={onEditTeam ? (event) => {
                      // Issue and event markers jump on click; a double-click
                      // there stays a jump, not an editor.
                      if ((event.target as Element).closest('.timeline-issue, .timeline-event')) return;
                      onEditTeam(trajectory.id);
                    } : undefined}
                  >
                    <button
                      type="button"
                      className="timeline-robot"
                      onClick={() => onSelect?.(trajectory.id)}
                      aria-label={tr('timeline.selectRobot', { name: robotIdentity(trajectory) })}
                      aria-pressed={selectedId === trajectory.id}
                      title={robotIdentity(trajectory)}
                    >
                      <span className="timeline-robot-dot" style={{ background: robot.color }} />
                      <span>{robotIdentity(trajectory)}</span>
                    </button>
                    <div className="timeline-lane">
                      <div
                        className="timeline-activity"
                        style={{ ...intervalStyle(activeStartT(robot), activeEndT(robot)), background: robot.color }}
                        role="img"
                        aria-label={activityLabel}
                        title={activityLabel}
                      />
                      {robotBounds.map((issue, index) => {
                        const label = tr('timeline.issue', {
                          kind: tr('timeline.outOfBounds'), name: robotIdentity(trajectory),
                          start: issue.startT.toFixed(2), end: issue.endT.toFixed(2),
                        });
                        return <button key={`bounds-${index}`} type="button" className="timeline-issue timeline-bounds" style={intervalStyle(issue.startT, issue.endT)} aria-label={label} title={label} onClick={() => jump(issue.startT, [trajectory.id])} />;
                      })}
                      {robotConflicts.map((issue, index) => {
                        const otherId = issue.aId === trajectory.id ? issue.bId : issue.aId;
                        const other = robots.find((r) => r.trajectory.id === otherId);
                        const label = tr('timeline.issue', {
                          kind: tr('timeline.collision'), name: `${robotIdentity(trajectory)} × ${other ? robotIdentity(other.trajectory) : otherId}`,
                          start: issue.startT.toFixed(2), end: issue.endT.toFixed(2),
                        });
                        return <button key={`collision-${index}`} type="button" className="timeline-issue timeline-collision" style={intervalStyle(issue.startT, issue.endT)} aria-label={label} title={label} onClick={() => jump(issue.startT, [issue.aId, issue.bId], trajectory.id)} />;
                      })}
                      {sequenceEventTimes(robot).map((event, index) => {
                        const label = tr('timeline.eventAt', { name: event.name, t: event.t.toFixed(2) });
                        return <button key={`event-${index}`} type="button" className="timeline-event" style={{ left: percent(event.t) }} title={label} aria-label={label} onClick={() => jump(event.t, [trajectory.id])} />;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="timeline-axis">
              <span className="timeline-unit">{tr('timeline.seconds')}</span>
              <div className="timeline-ruler">
                <div className="timeline-ticks" aria-hidden="true">
                  {ticks.map((tick) => (
                    <span key={tick} className="timeline-tick" style={{ left: percent(tick) }}>
                      {tick}
                    </span>
                  ))}
                </div>
                <input
                  className="timeline-scrubber"
                  type="range"
                  min={0}
                  max={axisMax}
                  step={0.01}
                  value={currentT}
                  disabled={end === 0}
                  aria-label={tr('timeline.position')}
                  aria-valuetext={tr('timeline.clock', { t: currentT.toFixed(2), d: end.toFixed(2) })}
                  onChange={(e) => seek(Number(e.target.value))}
                  onKeyDown={(e) => {
                    // End follows the chosen playback range.
                    if (e.key === 'End') {
                      e.preventDefault();
                      seek(end);
                    }
                  }}
                />
              </div>
            </div>
            <div className="timeline-playhead-plane" aria-hidden="true">
              <div className="timeline-playhead" style={{ left: percent(currentT) }} />
            </div>
          </div>
        </div>
      )}

      {guide}
      <div className="timeline-playback-bar">
        <span className="clock timeline-clock">
          {tr('timeline.clock', { t: currentT.toFixed(2), d: end.toFixed(2) })}
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
              {tr('timeline.speed', { n: s })}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

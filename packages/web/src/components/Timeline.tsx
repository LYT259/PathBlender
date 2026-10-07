import type { CSSProperties, ReactNode } from 'react';
import type { SessionTrajectory } from '@pathblender/core';
import { activeEndT, activeStartT, sequenceEventTimes } from '@pathblender/core';
import { useI18n } from '../i18n';
import './Timeline.css';
import { robotIdentity } from '../robot-identity';
import { playbackEnd, timelineScale, type PlaybackRange } from '../playback-range';

import { PlaybackControls, type Playback } from './PlaybackControls';


interface Props {
  robots: SessionTrajectory[];
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


export function Timeline({ robots, autoPeriodS, duration, visibleDuration, playback, playbackRange = 'full', onPlaybackRangeChange, selectedId, onSelect, onEditTeam, onJump, guide, composeAction }: Props) {
  const { t: tr, n } = useI18n();
  const { t, setT, setPlaying } = playback;
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

  return (
    <section className="timeline timeline-workspace" aria-label={tr('timeline.title')}>
      <div className="timeline-toolbar">
        {onPlaybackRangeChange && <select
          className="timeline-range"
          aria-label={tr('timeline.range')}
          value={playbackRange}
          onChange={(event) => onPlaybackRangeChange(event.target.value as PlaybackRange)}
        >
          <option value="full">{tr('timeline.rangeFull')}</option>
          <option value="paths">{tr('timeline.rangePaths')}</option>
        </select>}
        {composeAction}
        {robots.length > 0 && (
          <div className="timeline-legend">
            {/* Collision/out-of-bounds legend entries went with the lane
                markers (user 2026-10-07) — events are the only lane dot. */}
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
                const activityLabel = tr('timeline.activity', {
                  name: robotIdentity(trajectory),
                  start: n(activeStartT(robot), 2),
                  end: n(activeEndT(robot), 2),
                });
                return (
                  <div
                    className={`timeline-row${selectedId === trajectory.id ? ' is-selected' : ''}`}
                    key={trajectory.id}
                    onDoubleClick={onEditTeam ? () => onEditTeam(trajectory.id) : undefined}
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
                      {/* Conflict/out-of-bounds markers removed (user 2026-10-07):
                          the checks panel owns conflict jumps; the lane keeps only
                          the robot's activity tape and its route events. */}
                      {sequenceEventTimes(robot).map((event, index) => {
                        const label = tr('timeline.eventAt', { name: event.name, t: n(event.t, 2) });
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
                  aria-valuetext={tr('timeline.clock', { t: n(currentT, 2), d: n(end, 2) })}
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
      <PlaybackControls playback={playback} end={end} />
    </section>
  );
}

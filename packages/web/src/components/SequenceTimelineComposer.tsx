import { useRef, useState, type CSSProperties, type DragEvent } from 'react';
import type { SequenceJoinIssue, SequenceTimingIssue, SessionTrajectory } from '@pathblender/core';
import { sequenceViewFor, type AutoSequenceSegment } from '../auto-sequence-state';
import { canPlaceClip, clipsFor, placeClip, segmentsFromClips, snapClipStart, type TimelineClip } from '../sequence-timeline-clips';
import { robotIdentity } from '../robot-identity';
import { routeLabel } from '../route-library';
import { formatLength, useLengthUnit } from '../length-units';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './SequenceTimelineComposer.css';

interface Props {
  robots: SessionTrajectory[];
  selectedId?: string;
  onSelect: (id: string) => void;
  autoPeriodS: number;
  open: boolean;
  onClose: () => void;
  /** Commit the active robot's arrangement. Upstream this is one history step. */
  onChange: (segments: AutoSequenceSegment[]) => void;
  /** Join measurements for the active robot (grading display, not an executability verdict). */
  joins?: SequenceJoinIssue[];
  /** Finish-time warning when the composition outruns the auto period. */
  timing?: SequenceTimingIssue;
  /** Seek the playback head to a seam (pauses playback). */
  onJump: (time: number) => void;
}

interface Ghost { robotId: string; clip: TimelineClip }
const DRAG_TYPE = 'application/x-pathblender-timeline-route';
const finish = (clips: TimelineClip[]) => Math.max(0, ...clips.map((c) => c.startS + c.durationS));

/**
 * Bottom arrangement surface (red book v1.38/v1.39): one robot expanded, the
 * others as compact reference tracks. Every drop, move, removal and reset is
 * an intentional commit onto the robot's real sequence — playback, collision
 * checks, undo/redo, autosave and session files all consume it through the
 * ordinary robot store. A drag commits exactly once, on release.
 */
export function SequenceTimelineComposer({ robots, selectedId, onSelect, autoPeriodS, open, onClose, onChange, joins = [], timing, onJump }: Props) {
  const { t } = useI18n();
  const [unit] = useLengthUnit();
  const [selected, setSelected] = useState<{ robotId: string; clipId: string } | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const laneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ robotId: string; clip: TimelineClip; x: number; width: number; axis: number; moved: boolean } | null>(null);
  const candidateRef = useRef<{ robotId: string; routeId: string } | null>(null);
  const tracks = robots.map((robot) => {
    const view = sequenceViewFor(robot);
    return { robot, routes: view.routes, clips: clipsFor(view.segments, view.routes) };
  });
  const active = tracks.find((track) => track.robot.trajectory.id === selectedId) ?? tracks[0];
  const axis = Math.ceil(Math.max(autoPeriodS, ...tracks.map((track) => finish(track.clips) + 3)) / 5) * 5;
  const percent = (time: number) => `${time / axis * 100}%`;
  const styleFor = (clip: TimelineClip): CSSProperties => ({ left: percent(clip.startS), width: percent(clip.durationS) });
  const chosen = active && selected?.robotId === active.robot.trajectory.id ? active.clips.find((c) => c.id === selected.clipId) : undefined;
  const joinDetail = (issue: SequenceJoinIssue) => issue.kind === 'position'
    ? t('sequence.joinPosition', { d: formatLength(issue.delta, unit) })
    : issue.kind === 'heading'
      ? t('sequence.joinHeading', { d: issue.delta.toFixed(1) })
      : t('sequence.joinVelocity', { d: issue.delta.toFixed(2) });

  if (!open || !active) return null;
  const activeId = active.robot.trajectory.id;
  const activeGhost = ghost?.robotId === activeId ? ghost.clip : undefined;
  const validGhost = !activeGhost || canPlaceClip(active.clips, activeGhost);
  const composed = !!active.robot.sequence && active.robot.sequence.segments.length > 0;
  const ticks = Array.from({ length: Math.floor(axis / 2) + 1 }, (_, i) => i * 2);
  function commit(clip: TimelineClip): boolean {
    const next = placeClip(active!.clips, clip);
    if (!next) { setError(t('sequence.overlap')); setMessage(null); return false; }
    onChange(segmentsFromClips(next));
    setSelected({ robotId: activeId, clipId: clip.id });
    setError(null);
    setMessage(`${t('sequence.moved')}: ${clip.startS.toFixed(2)} s`);
    return true;
  }
  function append(routeId: string, durationS: number) {
    const ok = commit({ id: crypto.randomUUID(), routeId, startS: finish(active!.clips), durationS });
    if (ok) setMessage(t('sequence.added'));
  }
  function removeChosen() {
    if (!chosen) return;
    const next = active!.clips.filter((clip) => clip.id !== chosen.id);
    onChange(segmentsFromClips(next));
    setSelected(null);
    setError(null);
    setMessage(null);
    laneRef.current?.focus();
  }
  function resetArrangement() {
    onChange([]);
    setSelected(null);
    setError(null);
    setMessage(null);
  }
  function candidate(event: DragEvent): TimelineClip | undefined {
    const source = candidateRef.current;
    if (!source || source.robotId !== activeId || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    const route = active!.routes.find((r) => r.id === source.routeId);
    const rect = laneRef.current?.getBoundingClientRect();
    if (!route || !rect?.width) return;
    const clip = { id: 'drop-preview', routeId: route.id, startS: 0, durationS: route.trajectory.durationS };
    return { ...clip, startS: snapClipStart((event.clientX - rect.left) / rect.width * axis, active!.clips, clip, 8 / rect.width * axis) };
  }
  function switchRobot(id: string) { setGhost(null); setMessage(null); setError(null); onSelect(id); }
  return <section className="sequence-composer" aria-label={t('sequence.arrange')}>
    <header className="sequence-composer-header">
      <div className="sequence-composer-heading"><h2>{t('sequence.arrange')}</h2><span className="sequence-active-name"><i style={{ background: active.robot.color }} />{robotIdentity(active.robot.trajectory)}</span></div>
      <div className="sequence-composer-actions"><button className="btn small" type="button" disabled={!composed} title={composed ? undefined : t('sequence.lastRoute')} onClick={resetArrangement}>{t('sequence.reset')}</button><button className="btn small" type="button" onClick={() => { setGhost(null); onClose(); }}>{t('sequence.back')} ↑</button></div>
    </header>
    <div className="sequence-route-library">
      <div className="sequence-library-label"><strong>{t('sequence.routes')}</strong><span>{t('sequence.routesHint')}</span>{active.routes.length < 2 && <span>{t('sequence.oneRoute')}</span>}</div>
      <div className="sequence-route-options">
        {active.routes.map((route) => <button type="button" key={route.id} className="sequence-route-source" draggable={route.trajectory.durationS > 0} disabled={route.trajectory.durationS <= 0}
          title={`${route.relPath} · ${route.trajectory.durationS.toFixed(2)} s`} aria-label={`${t('sequence.routes')}: ${routeLabel(route, active.routes)}`}
          onDragStart={(event) => { candidateRef.current = { robotId: activeId, routeId: route.id }; event.dataTransfer.setData(DRAG_TYPE, route.id); event.dataTransfer.effectAllowed = 'copy'; }}
          onDragEnd={() => { candidateRef.current = null; setGhost(null); }}
          onClick={() => append(route.id, route.trajectory.durationS)}>
          <span aria-hidden="true" className="sequence-grip">⠿</span><span>{routeLabel(route, active.routes)}</span><small>{route.trajectory.durationS.toFixed(2)} s</small>
        </button>)}
      </div>
    </div>
    <div className="sequence-timeline-scroll" dir="ltr">
      <div className="sequence-timeline-surface" style={{ width: `${zoom * 100}%` }}>
        <div className="sequence-axis"><span>s</span><div>{ticks.map((tick) => <span key={tick} style={{ left: percent(tick) }}>{tick}</span>)}</div></div>
        {tracks.map(({ robot, routes, clips }) => {
          const id = robot.trajectory.id;
          const editing = id === activeId;
          const laneGhost = editing ? activeGhost : undefined;
          return <div className={`sequence-track${editing ? ' is-editing' : ''}`} key={id} style={{ '--robot-color': robot.color } as CSSProperties}>
            <button type="button" className="sequence-track-name" aria-pressed={editing} onClick={() => switchRobot(id)}><span><i />{robotIdentity(robot.trajectory)}</span><small>{editing ? t('sequence.editing') : t('sequence.reference')}</small></button>
            <div className="sequence-track-lane" ref={editing ? laneRef : undefined} tabIndex={editing ? -1 : undefined} aria-label={`${robotIdentity(robot.trajectory)} ${t('sequence.arrange')}`}
              style={{ backgroundSize: `${2 / axis * 100}% 100%` }}
              onDragOver={editing ? (event) => { const clip = candidate(event); if (!clip) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = canPlaceClip(clips, clip) ? 'copy' : 'none'; setGhost({ robotId: id, clip }); } : undefined}
              onDragLeave={editing ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGhost(null); } : undefined}
              onDrop={editing ? (event) => { const clip = candidate(event); if (!clip) return; event.preventDefault(); event.stopPropagation(); commit({ ...clip, id: crypto.randomUUID() }); setGhost(null); candidateRef.current = null; } : undefined}>
              <span className={`sequence-auto-end${timing ? ' is-over' : ''}`} style={{ left: percent(autoPeriodS) }} title={`${t('sequence.autoEnd')}: ${autoPeriodS} s`} />
              {clips.map((clip, index) => {
                const route = routes.find((r) => r.id === clip.routeId);
                const label = route ? routeLabel(route, routes) : clip.routeId;
                const previousEnd = index ? clips[index - 1]!.startS + clips[index - 1]!.durationS : 0;
                const gap = clip.startS - previousEnd;
                const chosenClip = editing && selected?.robotId === id && selected.clipId === clip.id;
                const seamIssues = joins.filter((issue) => issue.fromIndex === index - 1);
                return <div key={clip.id}>
                  {editing && index > 0 && <button type="button" className={`sequence-seam${seamIssues.length ? ' is-bad' : ''}`} style={{ left: percent(previousEnd) }}
                    title={seamIssues.length ? seamIssues.map(joinDetail).join(' · ') : t('sequence.joinOk')}
                    aria-label={seamIssues.length ? `${t('sequence.joinOk')}: ${seamIssues.map(joinDetail).join(' · ')}` : t('sequence.joinOk')}
                    onClick={() => onJump(previousEnd)}>
                    <Icon name={seamIssues.length ? 'warning' : 'check'} size={11} />{seamIssues.length > 0 && <span>{seamIssues.map(joinDetail).join(' · ')}</span>}
                  </button>}
                  {editing && gap > 0 && <span className="sequence-wait" style={{ left: percent(previousEnd), width: percent(gap) }} title={`${index ? t('sequence.wait') : t('sequence.delay')}: ${gap.toFixed(2)} s`}><span>{gap.toFixed(2)} s</span></span>}
                  <button type="button" className={`sequence-clip${chosenClip ? ' is-chosen' : ''}${laneGhost?.id === clip.id ? ' is-moving' : ''}`} style={styleFor(clip)}
                    aria-label={`${label}, ${clip.startS.toFixed(2)}–${(clip.startS + clip.durationS).toFixed(2)} s`} aria-pressed={chosenClip}
                    title={`${label}\n${clip.startS.toFixed(2)}–${(clip.startS + clip.durationS).toFixed(2)} s`}
                    onClick={() => { if (!editing) switchRobot(id); setSelected({ robotId: id, clipId: clip.id }); setError(null); setMessage(null); }}
                    onPointerDown={editing ? (event) => { if (event.button !== 0) return; const rect = laneRef.current!.getBoundingClientRect(); dragRef.current = { robotId: id, clip, x: event.clientX, width: rect.width, axis, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); setSelected({ robotId: id, clipId: clip.id }); setError(null); setMessage(null); } : undefined}
                    onPointerMove={editing ? (event) => { const drag = dragRef.current; if (!drag || drag.robotId !== id || drag.width <= 0) return; if (Math.abs(event.clientX - drag.x) < 3 && !drag.moved) return; drag.moved = true; const startS = snapClipStart(drag.clip.startS + (event.clientX - drag.x) / drag.width * drag.axis, clips, clip, 8 / drag.width * drag.axis); setGhost({ robotId: id, clip: { ...clip, startS } }); } : undefined}
                    onPointerUp={editing ? () => { if (dragRef.current?.moved && laneGhost) commit(laneGhost); dragRef.current = null; setGhost(null); } : undefined}
                    onPointerCancel={() => { dragRef.current = null; setGhost(null); }}
                    onLostPointerCapture={() => { dragRef.current = null; setGhost(null); }}
                    onKeyDown={editing ? (event) => { if (event.key === 'Escape') { dragRef.current = null; setGhost(null); return; } if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const delta = (event.shiftKey ? 1 : .1) * (event.key === 'ArrowLeft' ? -1 : 1); commit({ ...clip, startS: Math.round((clip.startS + delta) * 1e9) / 1e9 }); } : undefined}>
                    <strong>{editing && <span className="sequence-clip-number">{index + 1}</span>}{label}</strong>{editing && <small>{clip.startS.toFixed(2)}–{(clip.startS + clip.durationS).toFixed(2)} s</small>}
                  </button>
                </div>;
              })}
              {editing && clips.length === 0 && !laneGhost && <span className="sequence-empty-lane">{t('sequence.empty')}</span>}
              {laneGhost && <div className={`sequence-ghost${validGhost ? '' : ' is-invalid'}`} style={styleFor(laneGhost)}><strong>{laneGhost.startS.toFixed(2)}–{(laneGhost.startS + laneGhost.durationS).toFixed(2)} s</strong><small>{validGhost ? t('sequence.editing') : t('sequence.overlap')}</small></div>}
            </div>
          </div>;
        })}
      </div>
    </div>
    {timing && <p className="sequence-timing-warning"><Icon name="warning" size={13} /><span>{t('sequence.overAuto', { t: timing.finishS.toFixed(2), auto: timing.autoPeriodS })}</span></p>}
    <div className="sequence-selection-bar">
      {chosen ? <><span className="sequence-selected-route">{routeLabel(active.routes.find((r) => r.id === chosen.routeId)!, active.routes)}</span><label>{t('sequence.start')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min="0" step="any" defaultValue={chosen.startS} aria-label={t('sequence.start')} aria-invalid={!!error} onBlur={(event) => {
        const raw = event.currentTarget.value.trim();
        const parsed = raw === '' ? NaN : Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) { setError(t('sequence.invalid')); event.currentTarget.value = String(chosen.startS); return; }
        if (parsed === chosen.startS) { setError(null); return; }
        if (!commit({ ...chosen, startS: parsed })) event.currentTarget.value = String(chosen.startS);
      }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = String(chosen.startS); setError(null); event.currentTarget.blur(); } }} /> s</label><span>{t('sequence.end')} <b>{(chosen.startS + chosen.durationS).toFixed(2)} s</b></span><button type="button" className="sequence-remove" disabled={active.clips.length <= 1} title={active.clips.length <= 1 ? t('sequence.lastRoute') : undefined} onClick={removeChosen}>{t('sequence.removeRoute')}</button></> : <span>{t('sequence.select')}</span>}
      <label className="sequence-zoom">{t('sequence.zoom')} <select aria-label={t('sequence.zoom')} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    </div>
    <div className="sequence-composer-footnote"><span role="status" className={error ? 'sequence-error' : ''}>{error ?? message ?? t('sequence.hint')}</span><span>{t('sequence.geometryNote')}</span></div>
  </section>;
}

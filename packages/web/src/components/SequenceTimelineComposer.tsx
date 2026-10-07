import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { RouteContinuity, SequenceJoinIssue, SessionRouteOption, SessionTrajectory } from '@pathblender/core';
import { routeConnectsAfter } from '@pathblender/core';
import { sequenceViewFor, type AutoSequenceSegment } from '../auto-sequence-state';
import { boundedClipStart, canPlaceClip, clipGaps, clipsFor, placeClip, segmentsFromClips, type TimelineClip } from '../sequence-timeline-clips';
import { robotIdentity } from '../robot-identity';
import { routeLabel } from '../route-library';
import { formatLength, useLengthUnit } from '../length-units';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { SequenceComposerToolbar } from './SequenceComposerToolbar';
import { PlaybackControls, type Playback } from './PlaybackControls';
import './SequenceTimelineComposer.css';

interface Props {
  robots: SessionTrajectory[];
  selectedId?: string;
  onSelect: (id: string) => void;
  autoPeriodS: number;
  open: boolean;
  onClose: () => void;
  /** Each completed edit commits to the same store used by playback and autosave. */
  onChange: (segments: AutoSequenceSegment[]) => void;
  onPreviewRoute?: (routeId: string | null) => void;
  joins?: SequenceJoinIssue[];
  playback?: Playback;
  onJump: (time: number) => void;
}
interface Drag {
  robotId: string;
  /** 'scrub' drags the playhead from empty lane space; no clip rides along. */
  kind: 'add' | 'move' | 'scrub';
  clip?: TimelineClip;
  x: number;
  y: number;
  moved: boolean;
  candidate?: TimelineClip;
}
const formatStart = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);
const finish = (clips: TimelineClip[]) => Math.max(0, ...clips.map((clip) => clip.startS + clip.durationS));
const clampToAxis = (t: number, axisS: number) => Math.min(axisS, Math.max(0, t));

/** Pointer capture works across WebKit and mouse/touch/pen, without relying
 * on custom HTML drag payloads. A gesture is one undoable operation. */
export function SequenceTimelineComposer({ robots, selectedId, onSelect, autoPeriodS, open, onClose, onChange, onPreviewRoute, joins = [], playback, onJump }: Props) {
  const { t } = useI18n();
  const [unit] = useLengthUnit();
  const [selected, setSelected] = useState<{ robotId: string; clipId: string } | null>(null);
  const [ghost, setGhost] = useState<{ robotId: string; clip: TimelineClip } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ robotId: string; clipId: string; x: number; y: number } | null>(null);
  // Screen point of a running library drag — drives the follow-along badge
  // so the dragged route stays identified even outside the lane.
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const tracks = robots.map((robot) => {
    const view = sequenceViewFor(robot);
    return { robot, routes: view.routes, clips: clipsFor(view.segments, view.routes) };
  });
  const active = tracks.find((track) => track.robot.trajectory.id === selectedId) ?? tracks[0];
  const activeId = active?.robot.trajectory.id;
  const activeClips = active?.clips ?? [];
  const activeGhost = ghost && ghost.robotId === activeId ? ghost.clip : undefined;
  const chosen = selected && selected.robotId === activeId ? activeClips.find((clip) => clip.id === selected.clipId) : undefined;
  const axis = autoPeriodS;
  const percent = (time: number) => `${time / axis * 100}%`;
  const styleFor = (clip: TimelineClip): CSSProperties => ({ left: percent(clip.startS), width: percent(clip.durationS) });
  const validGhost = !activeGhost || canPlaceClip(activeClips, activeGhost, autoPeriodS);
  const limitMessage = `${t('sequence.autoEnd')}: ${autoPeriodS.toFixed(2)}s`;
  const joinDetail = (issue: SequenceJoinIssue) => issue.kind === 'position'
    ? t('sequence.joinPosition', { d: formatLength(issue.delta, unit) })
    : issue.kind === 'heading' ? t('sequence.joinHeading', { d: issue.delta.toFixed(1) })
      : t('sequence.joinVelocity', { d: issue.delta.toFixed(2) });
  // Route-library continuity gating (2026-10-07): with the playhead on or
  // past a segment — the same "last segment started at or before t" the
  // playback sampler uses — a route dragged in continues from that
  // segment's end pose. Routes that start elsewhere stay listed but gray,
  // disabled and after the draggable ones: a composition must not teleport
  // the robot, and the user asked to see what can actually come next.
  // Before the first segment (or with no playback) nothing precedes the
  // playhead and every route stays available.
  const playheadT = playback?.t;
  // Occupancy gating (2026-10-07): the playhead marks where a dragged-in
  // route would go. On a stretch a placed segment already occupies there is
  // nowhere to drop, so the whole library grays out; an empty stretch (or a
  // segment boundary, where the next leg butts on seamlessly) restores it.
  const occupied = playheadT !== undefined
    && activeClips.some((clip) => clip.startS <= playheadT && playheadT < clip.startS + clip.durationS);
  const anchorClip = playheadT === undefined ? undefined
    : [...activeClips].sort((a, b) => a.startS - b.startS).filter((clip) => clip.startS <= playheadT).at(-1);
  const anchorRoute = anchorClip ? active?.routes.find((route) => route.id === anchorClip.routeId) : undefined;
  const anchorLabel = anchorRoute && active ? routeLabel(anchorRoute, active.routes) : '';
  const library: { route: SessionRouteOption; blocked: boolean; continuity?: RouteContinuity }[] = [];
  for (const route of active?.routes ?? []) {
    const overAuto = route.trajectory.durationS > autoPeriodS;
    const continuity = anchorRoute ? routeConnectsAfter(anchorRoute.trajectory, route.trajectory) : undefined;
    library.push({
      route,
      blocked: occupied || route.trajectory.durationS <= 0 || overAuto || (continuity ? !continuity.connects : false),
      continuity,
    });
  }
  // Draggable first (stable within each group), grayed after — the picker
  // answers "what can follow the playhead" in one glance.
  library.sort((a, b) => Number(a.blocked) - Number(b.blocked));

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || rootRef.current?.contains(target) || target.closest('[data-session-history]')) return;
      // Functional controls keep the composer open (user 2026-10-07):
      // hiding another robot, switching selection or opening a menu must not
      // exit edit mode — only a pointerdown on blank page/field area does.
      // Focusable widgets stand in for "functional" (buttons, inputs, the
      // tabbable robot rows); inert chrome around them counts as blank.
      if (target.closest('button, input, select, textarea, a, label, summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && rootRef.current?.contains(focused)) focused.blur();
      onClose();
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onClose]);
  useEffect(() => {
    dragRef.current = null;
    setGhost(null); setMenu(null); setError(null);
  }, [open, activeId]);
  // Keyboard entry (2026-10-06 keyboard pass): opening the composer moves
  // focus onto the editing lane, so Tab reaches the segments and Escape has
  // an owner from the first keystroke. Switching robots re-lands focus on
  // the new lane the same way.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => laneRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, activeId]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const outside = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); };
  }, [menu]);

  if (!open || !active || !activeId) return null;
  const ticks = [...new Set([...Array.from({ length: Math.floor(axis / 2) + 1 }, (_, i) => i * 2), axis])];
  function commit(clip: TimelineClip): boolean {
    const next = placeClip(activeClips, clip, autoPeriodS);
    if (!next) { setError(clip.startS + clip.durationS > autoPeriodS ? limitMessage : t('sequence.overlap')); return false; }
    onChange(segmentsFromClips(next));
    setSelected({ robotId: activeId!, clipId: clip.id }); setError(null);
    return true;
  }
  function append(routeId: string, durationS: number) {
    const startS = finish(activeClips);
    // The playhead IS the insertion point: once the appended route lands,
    // advance it to the new end so the library (gated by playhead occupancy
    // and continuity) immediately answers "what can come next" — chaining
    // several routes needs no scrub between appends.
    if (commit({ id: crypto.randomUUID(), routeId, startS, durationS })) {
      playback?.setT(Math.min(autoPeriodS, startS + durationS));
    }
  }
  function remove(clipId: string) {
    onChange(segmentsFromClips(activeClips.filter((clip) => clip.id !== clipId)));
    setSelected(null); setMenu(null); setError(null);
    laneRef.current?.focus();
  }
  function begin(event: PointerEvent<HTMLButtonElement>, kind: Drag['kind'], clip: TimelineClip) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    dragRef.current = { robotId: activeId!, kind, clip, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'move') setSelected({ robotId: activeId!, clipId: clip.id });
    setMenu(null); setError(null);
  }
  /** Scrub the playhead from inert timeline surfaces (user 2026-10-07):
   * empty lane space on ANY track and the second-ruler above them — a press
   * jumps there at once, dragging scrubs continuously. Clips and seam pills
   * are buttons and keep their own gestures. Window-level drivers keep the
   * drag alive even where pointer capture is unreliable (WKWebView) or the
   * pointer leaves the composer; they only act while the scrub still owns
   * dragRef, so Escape cancels through the normal path. */
  function beginScrub(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !playback) return;
    if (event.target !== event.currentTarget && (event.target as Element).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    suppressClick.current = false;
    dragRef.current = { robotId: activeId!, kind: 'scrub', x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    const scrubTo = (clientX: number) => playback.setT(clampToAxis((clientX - rect.left) / rect.width * axis, axis));
    playback.setPlaying(false);
    scrubTo(event.clientX);
    const onMove = (e: globalThis.PointerEvent) => {
      if (dragRef.current?.kind === 'scrub') scrubTo(e.clientX);
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    setMenu(null); setError(null);
  }
  function move(event: PointerEvent) {
    const drag = dragRef.current;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!drag || drag.robotId !== activeId || !rect?.width) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
    drag.moved = true; suppressClick.current = true; event.preventDefault();
    if (drag.kind === 'scrub') {
      playback?.setT(clampToAxis((event.clientX - rect.left) / rect.width * axis, axis));
      return;
    }
    // The follow-along badge rides the pointer for library drags — the user
    // must see WHICH route is being dragged, inside the lane or out of it.
    if (drag.kind === 'add') setDragPoint({ x: event.clientX, y: event.clientY });
    if (drag.kind === 'add' && (event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left || event.clientX > rect.right)) {
      drag.candidate = undefined; setGhost(null); return;
    }
    const clip = drag.clip!;
    const raw = drag.kind === 'add' ? (event.clientX - rect.left) / rect.width * axis
      : clip.startS + (event.clientX - drag.x) / rect.width * axis;
    const startS = boundedClipStart(raw, activeClips, clip, 8 / rect.width * axis, autoPeriodS);
    drag.candidate = { ...clip, startS };
    setGhost({ robotId: activeId!, clip: drag.candidate });
  }
  function cancelDrag() { dragRef.current = null; setGhost(null); setDragPoint(null); onPreviewRoute?.(null); }
  function switchRobot(id: string) { cancelDrag(); setMenu(null); setError(null); onSelect(id); }
  const ghostRoute = active.routes.find((route) => route.id === activeGhost?.routeId);
  return <section ref={rootRef} className="sequence-composer" aria-label={t('sequence.arrange')}
    onPointerMove={move} onPointerUp={() => {
      const drag = dragRef.current;
      if (drag?.moved && drag.robotId === activeId && drag.candidate) commit(drag.candidate);
      cancelDrag();
    }} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
    onKeyDown={(event) => {
      const native = event.nativeEvent;
      // IME composition owns Escape — never exit while it is running.
      if (native.isComposing || native.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Escape cancels exactly one layer, topmost first: an open clip menu,
      // then a running drag, then the composer itself. Consuming here stops
      // the document-level fallback from closing the composer underneath.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (menu) { setMenu(null); laneRef.current?.focus(); return; }
        if (dragRef.current) { cancelDrag(); laneRef.current?.focus(); return; }
        onClose();
        return;
      }
      // Delete also serves a CLICKED (chosen) segment — not only a focused
      // one (user 2026-10-07): desktop WebKit does not focus buttons on
      // click, so the clip-level handler never saw the key. One shot per
      // press; the clip-level handler stays authoritative when a clip holds
      // focus (it stops propagation first).
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat && !menu && chosen) {
        event.preventDefault(); event.stopPropagation();
        remove(chosen.id);
      }
    }}>
    <SequenceComposerToolbar name={robotIdentity(active.robot.trajectory)} color={active.robot.color} onBack={onClose} />
    <div className="sequence-route-library"><div className="sequence-route-options">
      {library.map(({ route, blocked, continuity }) => {
        // Gray-reason precedence: occupancy (nowhere to drop at all) over
        // the auto-period limit over the pose mismatch.
        const reason = !blocked ? null
          : occupied ? t('sequence.libraryOccupied')
          : route.trajectory.durationS > autoPeriodS ? limitMessage
          : continuity ? t('sequence.libraryBlocked', {
            name: anchorLabel,
            p: formatLength(continuity.positionGapM, unit),
            h: `${continuity.headingGapDeg.toFixed(1)}°`,
          }) : null;
        return <button type="button" key={route.id} className="sequence-route-source" draggable={false}
        disabled={blocked}
        title={reason ? `${route.relPath} · ${route.trajectory.durationS.toFixed(2)}s · ${reason}` : `${route.relPath} · ${route.trajectory.durationS.toFixed(2)}s`}
        aria-label={`${routeLabel(route, active.routes)}: ${route.trajectory.durationS.toFixed(2)} s${reason ? ` · ${reason}` : ''}`}
        onPointerEnter={() => { if (blocked || dragRef.current) return; onPreviewRoute?.(route.id); }}
        onPointerLeave={() => { if (dragRef.current) return; onPreviewRoute?.(null); }}
        // Keyboard parity for the hover preview: focus shows the route on
        // the field exactly like a pointer enter, blur clears it.
        onFocus={() => { if (blocked || dragRef.current) return; onPreviewRoute?.(route.id); }}
        onBlur={() => { if (dragRef.current) return; onPreviewRoute?.(null); }}
        onPointerDown={(event) => { if (blocked) return; begin(event, 'add', { id: crypto.randomUUID(), routeId: route.id, startS: 0, durationS: route.trajectory.durationS }); }}
        onClick={(event) => { if (blocked || (event.detail !== 0 && suppressClick.current)) return; append(route.id, route.trajectory.durationS); }}>
        <span aria-hidden="true" className="sequence-grip">⠿</span><span>{routeLabel(route, active.routes)}</span><small>{route.trajectory.durationS.toFixed(2)}s</small>
      </button>; })}
    </div></div>
    <div className="sequence-timeline-scroll" dir="ltr"><div className="sequence-timeline-surface">
      <div className="sequence-axis"><span>s</span><div onPointerDown={beginScrub}>{ticks.map((tick) => <span key={tick} style={{ left: percent(tick) }}>{tick}</span>)}</div></div>
      {tracks.map(({ robot, routes, clips }) => {
        const id = robot.trajectory.id;
        const editing = id === activeId;
        return <div className={`sequence-track${editing ? ' is-editing' : ''}`} key={id} style={{ '--robot-color': robot.color } as CSSProperties}>
          <button type="button" className="sequence-track-name" aria-pressed={editing} onClick={() => switchRobot(id)}><span><i />{robotIdentity(robot.trajectory)}</span><small>{t(editing ? 'sequence.editing' : 'sequence.reference')}</small></button>
          <div className="sequence-track-lane" ref={editing ? laneRef : undefined} tabIndex={editing ? -1 : undefined} onPointerDown={beginScrub}
            aria-label={`${robotIdentity(robot.trajectory)} ${t('sequence.arrange')}`} style={{ backgroundSize: `${2 / axis * 100}% 100%` }}>
            <span className="sequence-auto-end" style={{ left: '100%' }} title={limitMessage} />
            {clips.map((clip, index) => {
              const route = routes.find((r) => r.id === clip.routeId);
              const label = route ? routeLabel(route, routes) : clip.routeId;
              const previousEnd = index ? clips[index - 1]!.startS + clips[index - 1]!.durationS : 0;
              const gap = clip.startS - previousEnd;
              const seamIssues = joins.filter((issue) => issue.fromIndex === index - 1);
              const chosenClip = editing && selected?.robotId === id && selected.clipId === clip.id;
              return <div key={clip.id}>
                {editing && index > 0 && !activeGhost && <button type="button" className={`sequence-seam${seamIssues.length ? ' is-bad' : ''}`} style={{ left: percent(previousEnd) }}
                  title={seamIssues.length ? seamIssues.map(joinDetail).join(' · ') : t('sequence.joinOk')}
                  aria-label={seamIssues.length ? seamIssues.map(joinDetail).join(' · ') : t('sequence.joinOk')} onClick={() => onJump(previousEnd)}>
                  <Icon name={seamIssues.length ? 'warning' : 'check'} size={11} />
                </button>}
                {editing && gap > 0 && !activeGhost && <span className="sequence-wait" style={{ left: percent(previousEnd), width: percent(gap) }}><span>{gap.toFixed(2)}s</span></span>}
                <button type="button" className={`sequence-clip${chosenClip ? ' is-chosen' : ''}${editing && activeGhost?.id === clip.id ? ' is-moving' : ''}`}
                  style={styleFor(clip)} aria-label={`${label}, ${clip.startS.toFixed(2)}–${(clip.startS + clip.durationS).toFixed(2)} s`} aria-pressed={chosenClip}
                  title={`${label}\n${clip.startS.toFixed(2)}–${(clip.startS + clip.durationS).toFixed(2)} s`}
                  // Hovering a placed leg previews that route on the field
                  // exactly like the library buttons (user 2026-10-07) —
                  // editing lane only: the preview resolves through the
                  // selected robot's own library. Keyboard parity via focus.
                  onPointerEnter={editing ? () => { if (!dragRef.current) onPreviewRoute?.(clip.routeId); } : undefined}
                  onPointerLeave={editing ? () => { if (!dragRef.current) onPreviewRoute?.(null); } : undefined}
                  onFocus={editing ? () => { if (!dragRef.current) onPreviewRoute?.(clip.routeId); } : undefined}
                  onBlur={editing ? () => { if (!dragRef.current) onPreviewRoute?.(null); } : undefined}
                  onClick={(event) => { if (event.detail !== 0 && suppressClick.current) return; if (!editing) switchRobot(id); setSelected({ robotId: id, clipId: clip.id }); setError(null); }}
                  onPointerDown={editing ? (event) => begin(event, 'move', clip) : () => { suppressClick.current = false; }}
                  onContextMenu={editing ? (event) => { event.preventDefault(); setSelected({ robotId: id, clipId: clip.id }); setMenu({ robotId: id, clipId: clip.id, x: event.clientX, y: event.clientY }); } : undefined}
                  onKeyDown={editing ? (event) => {
                    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
                      setSelected({ robotId: id, clipId: clip.id }); setMenu({ robotId: id, clipId: clip.id, x: rect.left, y: rect.bottom });
                    }
                    // Delete on a FOCUSED clip is handled here (authoritative
                    // — stops propagation); the section-level handler covers
                    // the CLICKED-chosen case, since desktop WebKit does not
                    // focus buttons on click. One shot per press either way.
                    if ((event.key === 'Delete' || event.key === 'Backspace') && !event.repeat) {
                      event.preventDefault(); event.stopPropagation();
                      remove(clip.id);
                      return;
                    }
                    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    event.preventDefault();
                    const raw = clip.startS + (event.shiftKey ? 1 : .1) * (event.key === 'ArrowLeft' ? -1 : 1);
                    commit({ ...clip, startS: Math.min(Math.max(0, autoPeriodS - clip.durationS), Math.max(0, Math.round(raw * 1e9) / 1e9)) });
                  } : undefined}>
                  <strong>{label}<small>{clip.durationS.toFixed(2)}s</small></strong>
                </button>
              </div>;
            })}
            {editing && clips.length === 0 && !activeGhost && <span className="sequence-empty-lane">{t('sequence.empty')}</span>}
            {editing && activeGhost && <>
              <div className={`sequence-ghost${validGhost ? '' : ' is-invalid'}`} style={styleFor(activeGhost)}>
                <strong>{ghostRoute ? routeLabel(ghostRoute, active.routes) : activeGhost.routeId}<small>{activeGhost.durationS.toFixed(2)}s</small></strong>
              </div>
              {clipGaps(clips, activeGhost).map((gap) => <div key={gap.side} className={`sequence-gap-guide ${gap.side}${gap.toS < gap.fromS ? ' is-overlap' : ''}`}
                style={{ left: percent(Math.min(gap.fromS, gap.toS)), width: percent(Math.abs(gap.toS - gap.fromS)) }}>
                <span>{(gap.toS - gap.fromS).toFixed(2)}s</span>
              </div>)}
            </>}
            {playback && <span className="sequence-playhead" style={{ left: percent(Math.min(autoPeriodS, playback.t)) }} />}
          </div>
        </div>;
      })}
    </div></div>
    {chosen && <div className="sequence-selection-bar">
      <span className="sequence-selected-route">{active.routes.find((route) => route.id === chosen.routeId)?.relPath}</span>
      <label>{t('sequence.start')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min="0" max={Math.max(0, autoPeriodS - chosen.durationS)} step="any" defaultValue={formatStart(chosen.startS)}
        aria-label={t('sequence.start')} onBlur={(event) => {
          const raw = event.currentTarget.value.trim(); const value = raw === '' ? NaN : Number(raw);
          if (value === Number(formatStart(chosen.startS))) return;
          if (!Number.isFinite(value) || !commit({ ...chosen, startS: value })) event.currentTarget.value = formatStart(chosen.startS);
        }} onKeyDown={(event) => {
          if (event.key === 'Enter') { event.currentTarget.blur(); return; }
          // Escape cancels the pending edit first: revert the value and
          // leave the field; a second Escape (focus now on the lane) then
          // leaves the composer.
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation();
            event.currentTarget.value = formatStart(chosen.startS);
            event.currentTarget.blur();
          }
        }} /> s</label>
      <span>{t('sequence.end')} <b>{(chosen.startS + chosen.durationS).toFixed(2)}s</b></span>
    </div>}
    {menu?.robotId === activeId && <div ref={menuRef} className="sequence-clip-menu" role="menu" aria-label={t('sequence.arrange')}
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 188)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 54)) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); laneRef.current?.focus(); } if (event.key === 'Tab') { event.stopPropagation(); setMenu(null); } }}>
      <button type="button" role="menuitem" onClick={() => remove(menu.clipId)}><Icon name="trash" size={14} />{t('sequence.removeRoute')}</button>
    </div>}
    <div className="sequence-composer-footnote"><span role="status" className="sequence-error">{error ?? ''}</span></div>
    {dragPoint && dragRef.current?.kind === 'add' && dragRef.current.clip && (() => {
      // Follow-along copy of the dragged library route (user 2026-10-07):
      // visible inside the lane and out of it, so the gesture always says
      // WHICH route is being carried. Dropping in the lane records it;
      // dropping elsewhere discards it.
      const source = active.routes.find((route) => route.id === dragRef.current!.clip!.routeId);
      return <div className="sequence-drag-badge" aria-hidden="true" style={{ left: dragPoint.x, top: dragPoint.y }}>
        <span>{source ? routeLabel(source, active.routes) : dragRef.current.clip.routeId}</span><small>{source ? `${source.trajectory.durationS.toFixed(2)}s` : ''}</small>
      </div>;
    })()}
    {playback && <div className="timeline-workspace sequence-playback-controls">
      <input type="range" min="0" max={autoPeriodS} step="0.01" value={Math.min(autoPeriodS, playback.t)} aria-label={t('timeline.position')}
        onChange={(event) => { playback.setPlaying(false); playback.setT(Number(event.target.value)); }} />
      <PlaybackControls playback={playback} end={autoPeriodS} />
    </div>}
  </section>;
}

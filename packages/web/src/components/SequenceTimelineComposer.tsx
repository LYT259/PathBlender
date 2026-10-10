import { SelectControl } from './SelectControl';
import { Fragment, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { routeConnectsAfter, routeStartRegion, LIBRARY_CHAIN_TOLERANCES, startsInAllianceZone, type RouteContinuity, type SequenceJoinIssue, type SessionRouteOption, type SessionTrajectory, type StartRegionClass, type StartZoneRect } from '@pathblender/core';
import { sequenceViewFor, type AutoSequenceSegment } from '../auto-sequence-state';
import { boundedClipStart, canPlaceClip, clipGaps, clipsFor, placeClip, segmentsFromClips, type TimelineClip } from '../sequence-timeline-clips';
import { robotIdentity } from '../robot-identity';
import { routeLabel } from '../route-library';
import { formatLength, useLengthUnit } from '../length-units';
import type { PlaybackRange } from '../playback-range';
import { useRouteOrder, type RouteOrder } from '../route-order';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
/** Start-class id → caption key. Every FieldPackage.startRegions id must
 *  register here (the type system keeps new keys honest). */
const START_GROUP_KEYS: Record<string, MessageKey> = {
  trench: 'sequence.startGroupTrench',
  hub: 'sequence.startGroupHub',
};
import { Icon } from './Icon';
import { SequenceComposerToolbar } from './SequenceComposerToolbar';
import { PlaybackControls, type Playback } from './PlaybackControls';
import './SequenceTimelineComposer.css';

interface Props {
  robots: SessionTrajectory[];
  selectedId?: string;
  onSelect: (id: string) => void;
  autoPeriodS: number;
  /** The season's legal starting region (user 2026-10-08): with nothing
   * placed yet, only routes starting inside it are addable — every later
   * leg is pose-gated instead. Undefined = the season defines no region
   * and the first route stays ungated (2022 today). */
  startZone?: StartZoneRect[];
  /** Named start-position classes for the "group by start" library order;
   *  seasons without them hide the toggle (always alphabetical). */
  startRegions?: readonly StartRegionClass[];
  open: boolean;
  onClose: () => void;
  /** Each completed edit commits to the same store used by playback and autosave. */
  onChange: (segments: AutoSequenceSegment[]) => void;
  /** Hover/focus route preview: `routeId` resolves through the robot being
   * edited unless `robotId` names another track's team (2026-10-08). */
  onPreviewRoute?: (routeId: string | null, robotId?: string) => void;
  joins?: SequenceJoinIssue[];
  playback?: Playback;
  /** Transport end honoring the playback-range choice — shared with the
   * main timeline so playing inside the composer matches it (2026-10-07). */
  playbackEndS?: number;
  playbackRange?: PlaybackRange;
  onPlaybackRangeChange?: (value: PlaybackRange) => void;
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
  /** A 'move' drag currently flies OUTSIDE the lane (user 2026-10-10): no
   *  in-lane candidate exists; releasing over the library removes the clip,
   *  releasing anywhere else off-lane puts it back where it came from. */
  offLane?: boolean;
}
const formatStart = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);
const finish = (clips: TimelineClip[]) => Math.max(0, ...clips.map((clip) => clip.startS + clip.durationS));
const clampToAxis = (t: number, axisS: number) => Math.min(axisS, Math.max(0, t));

/** Pointer capture works across WebKit and mouse/touch/pen, without relying
 * on custom HTML drag payloads. A gesture is one undoable operation. */
export function SequenceTimelineComposer({ robots, selectedId, onSelect, autoPeriodS, startZone, startRegions, open, onClose, onChange, onPreviewRoute, joins = [], playback, playbackEndS, playbackRange = 'full', onPlaybackRangeChange, onJump }: Props) {
  const { t, n, lang } = useI18n();
  const [unit] = useLengthUnit();
  const [selected, setSelected] = useState<{ robotId: string; clipId: string } | null>(null);
  const [ghost, setGhost] = useState<{ robotId: string; clip: TimelineClip } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ robotId: string; clipId: string; x: number; y: number } | null>(null);
  // Screen point of a running library drag — drives the follow-along badge
  // so the dragged route stays identified wherever the pointer is. Over the
  // lane the in-lane ghost takes over (user 2026-10-08) and the badge yields.
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  // The route library is the delete target for drag-out (user 2026-10-10):
  // releasing a flying placed clip over it removes the clip.
  const libraryRef = useRef<HTMLDivElement>(null);
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
  const limitMessage = `${t('sequence.autoEnd')}: ${n(autoPeriodS, 2)}s`;
  const joinDetail = (issue: SequenceJoinIssue) => issue.kind === 'position'
    ? t('sequence.joinPosition', { d: formatLength(issue.delta, unit) })
    : issue.kind === 'heading' ? t('sequence.joinHeading', { d: n(issue.delta, 1) })
      : t('sequence.joinVelocity', { d: n(issue.delta, 2) });
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
  const library: { route: SessionRouteOption; blocked: boolean; outOfZone?: boolean; continuity?: RouteContinuity; region?: string }[] = [];
  // First-leg zoning (user 2026-10-08): with nothing placed yet the route
  // library answers "what may legally START the auto" — only routes whose
  // first sample sits in the season's legal starting region are addable.
  // The source robots stay blue-frame and the red view's region mirrors the
  // blue one, so the same rects serve both alliances. Once a first leg
  // exists, pose continuity takes the gate over.
  const zone = startZone !== undefined && activeClips.length === 0
    ? startZone
    : undefined;
  for (const route of active?.routes ?? []) {
    const overAuto = route.trajectory.durationS > autoPeriodS;
    const outOfZone = zone !== undefined
      && !startsInAllianceZone(route.trajectory, zone);
    // Driveable-chain gate (user 2026-10-08): LIBRARY_CHAIN_TOLERANCES
    // answers "can the robot drive there"; the seam badges still grade the
    // join itself at the strict SEQUENCE_JOIN_TOLERANCES.
    const continuity = anchorRoute ? routeConnectsAfter(anchorRoute.trajectory, route.trajectory, LIBRARY_CHAIN_TOLERANCES) : undefined;
    library.push({
      route,
      blocked: occupied || route.trajectory.durationS <= 0 || overAuto || outOfZone || (continuity ? !continuity.connects : false),
      outOfZone: outOfZone || undefined,
      continuity,
      region: startZone !== undefined && startsInAllianceZone(route.trajectory, startZone)
        ? routeStartRegion(route.trajectory, startRegions) || undefined
        : undefined,
    });
  }
  // Draggable first (stable within each group), grayed after — the picker
  // answers "what can follow the playhead" in one glance.
  library.sort((a, b) => Number(a.blocked) - Number(b.blocked));
  // "Group by start" order (user 2026-10-09, refined 2026-10-10):
  // FIRST-LEG PICKING ONLY — the grouping answers "where may the auto
  // legally start", exactly the state the zone gate below is live in, so
  // once any leg exists continuity owns the library and the grouping (and
  // its toggle) step aside. Only starts inside the legal zone carry a
  // named class (region coupling above): everything else — mid-field
  // starts, the far-side hub approach, the under-arm trench spots past the
  // line — reads as one "Other" bucket. Within the draggable/blocked
  // partition routes cluster under their class, declaration order first,
  // unmatched last, filename order inside each; the functional partition
  // stays primary so gating never hides behind cosmetics.
  const groupOrder = startRegions ? [...new Set(startRegions.map((region) => region.id))] : [];
  const [routeOrder, setRouteOrder] = useRouteOrder();
  // The grouping answers "where may the auto START", so it lives exactly
  // while the insertion point is still the start — the playhead precedes
  // every placed leg (or none exist). Once the playhead reaches the first
  // route, continuity owns the library and the grouping (and its toggle)
  // step aside (user refinement 2026-10-10: a placed leg with the playhead
  // still before it keeps the grouping).
  const grouped = routeOrder === 'start' && startRegions !== undefined && startRegions.length > 0
    && anchorClip === undefined;
  const groupRank = (region: string | undefined) => {
    const index = groupOrder.indexOf(region ?? '');
    return index === -1 ? groupOrder.length : index; // unmatched bucket last
  };
  if (grouped) {
    library.sort((a, b) => groupRank(a.region) - groupRank(b.region));
  }
  const groupLabel = (region: string | undefined) => {
    const key = region !== undefined ? START_GROUP_KEYS[region] : undefined;
    return key !== undefined ? t(key) : t('sequence.startGroupOther');
  };
  // One caption per group across the WHOLE list (user 2026-10-10: the
  // Other caption must not print twice when the blocked partition re-opens
  // the same bucket) — first appearance only, recomputed every render.
  const captionedGroups = new Set<string | undefined>();
  const captionFlags = library.map(({ region }) => {
    const first = !captionedGroups.has(region);
    captionedGroups.add(region);
    return first;
  });

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
    const remaining = autoPeriodS - startS;
    if (remaining <= 1e-9) { setError(limitMessage); return; }
    // Partial execution (user 2026-10-08): a leg appended where less auto
    // time remains than the route needs plays "as far as it can" — the
    // first `playS` seconds — instead of being refused.
    const clip: TimelineClip = { id: crypto.randomUUID(), routeId, startS, durationS };
    const fitted = remaining < durationS
      ? { ...clip, durationS: remaining, playS: remaining }
      : clip;
    // The playhead IS the insertion point: once the appended route lands,
    // advance it to the new end so the library (gated by playhead occupancy
    // and continuity) immediately answers "what can come next" — chaining
    // several routes needs no scrub between appends.
    if (commit(fitted)) {
      playback?.setT(Math.min(autoPeriodS, startS + fitted.durationS));
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
    // Drag-OUT (user 2026-10-10): a placed clip dragged off its row band
    // flies under the pointer as the SAME free-flight badge as dragging in —
    // no in-lane candidate, no ghost. Releasing over the library removes the
    // clip (handled on release); anywhere else off-lane puts it back where it
    // came from. Re-entering the row resumes the normal sliding ghost.
    if (drag.kind === 'move' && (event.clientY < rect.top || event.clientY > rect.bottom)) {
      drag.offLane = true; drag.candidate = undefined;
      setDragPoint({ x: event.clientX, y: event.clientY });
      setGhost(null); return;
    }
    if (drag.kind === 'move') drag.offLane = false;
    const clip = drag.clip!;
    // Free flight, snap on release (user 2026-10-10): the drag carries the
    // EDITING robot's own library, so the drop target is never in question,
    // and a drop NEVER fails. Off the lane the dragged route flies under the
    // pointer — both axes free. Overshooting an edge horizontally snaps to
    // the NEARER one: left → the route starts at 0 s; right → it butts
    // against the auto end (latest legal start) — the same clamps a placed
    // clip gets from boundedClipStart, so both gestures now agree. Inside
    // the lane the pointer time rules as before.
    const snappedRight = drag.kind === 'add' && event.clientX > rect.right;
    const raw = drag.kind === 'add' ? (Math.max(rect.left, event.clientX) - rect.left) / rect.width * axis
      : clip.startS + (event.clientX - drag.x) / rect.width * axis;
    // A new drop lands where the pointer is — no whole-route reservation.
    // Partial execution (user 2026-10-08): when less auto time remains than
    // the route needs (including a route longer than the whole auto, which
    // a right snap parks at 0), the candidate is cut to the remaining
    // seconds (playS); a placed leg being MOVED still keeps its full length
    // and slides instead, as before.
    const startS = drag.kind === 'add'
      ? snappedRight ? Math.max(0, autoPeriodS - clip.durationS)
        : Math.min(axis, Math.max(0, raw))
      : boundedClipStart(raw, activeClips, clip, 8 / rect.width * axis, autoPeriodS);
    const candidate: TimelineClip = drag.kind === 'add'
      ? autoPeriodS - startS < clip.durationS
        ? { ...clip, startS, durationS: autoPeriodS - startS, playS: autoPeriodS - startS }
        : { ...clip, startS }
      : { ...clip, startS };
    drag.candidate = candidate;
    // Off the lane's row the ghost steps aside and the flying badge becomes
    // the drag UI — the route visibly follows the pointer, up and down at
    // will, until the release snaps it back into the lane.
    if (drag.kind === 'add' && (event.clientY < rect.top || event.clientY > rect.bottom)) {
      setGhost(null); return;
    }
    setGhost({ robotId: activeId!, clip: candidate });
  }
  function cancelDrag() { dragRef.current = null; setGhost(null); setDragPoint(null); onPreviewRoute?.(null); }
  /** Hit-test the route library — the "home" drop zone: a dragged-OUT clip
   *  released there is removed, and a freshly dragged library route released
   *  there cancels its add instead of placing anything (user 2026-10-10). */
  function overLibrary(x: number, y: number): boolean {
    const r = libraryRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  function switchRobot(id: string) { cancelDrag(); setMenu(null); setError(null); onSelect(id); }
  const ghostRoute = active.routes.find((route) => route.id === activeGhost?.routeId);
  // Neighbour context for the selection bar (user 2026-10-10): the four
  // fields — after-previous wait, start, end, before-next wait — are linked
  // views of ONE placement; editing any repositions the same leg and every
  // other field follows. The imported duration itself never stretches.
  const chosenIndex = chosen ? activeClips.findIndex((clip) => clip.id === chosen.id) : -1;
  const previousClip = chosenIndex > 0 ? activeClips[chosenIndex - 1] : undefined;
  const nextClip = chosenIndex >= 0 && chosenIndex < activeClips.length - 1 ? activeClips[chosenIndex + 1] : undefined;
  const round9 = (value: number) => Math.round(value * 1e9) / 1e9;
  const previousEndS = previousClip ? round9(previousClip.startS + previousClip.durationS) : undefined;
  const nextStartS = nextClip ? nextClip.startS : undefined;
  const chosenEndS = chosen ? round9(chosen.startS + chosen.durationS) : undefined;
  const gapBeforeS = chosen && previousEndS !== undefined ? round9(chosen.startS - previousEndS) : undefined;
  const gapAfterS = chosen && nextStartS !== undefined && chosenEndS !== undefined ? round9(nextStartS - chosenEndS) : undefined;
  /** One editable placement field: blur (or Enter) commits the derived
   *  start — parse and placement failures revert the box, Escape cancels
   *  the pending edit and leaves the field (same contract the Start input
   *  always had; it now rides this factory too). Derived starts round to
   *  the nanosecond like the keyboard nudge, killing float tails. */
  function placeField(current: number, derive: (value: number) => number) {
    const revert = (event: { currentTarget: HTMLInputElement }) => { event.currentTarget.value = formatStart(current); };
    return {
      onBlur: (event: FocusEvent<HTMLInputElement>) => {
        const raw = event.currentTarget.value.trim(); const value = raw === '' ? NaN : Number(raw);
        if (value === Number(formatStart(current))) return;
        if (!Number.isFinite(value) || !commit({ ...chosen!, startS: round9(derive(value)) })) revert(event);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') { event.currentTarget.blur(); return; }
        // Escape cancels the pending edit first: revert the value and
        // leave the field; a second Escape (focus now on the lane) then
        // leaves the composer.
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation();
          revert(event);
          event.currentTarget.blur();
        }
      },
    };
  }
  return <section ref={rootRef} className="sequence-composer" aria-label={t('sequence.arrange')}
    onPointerMove={move} onPointerUp={(event) => {
      const drag = dragRef.current;
      if (drag?.moved && drag.robotId === activeId) {
        // The library is "home": dropping a dragged-out placed clip there
        // removes it, and dropping a freshly dragged library route back
        // there cancels the add — nothing lands on the timeline (user
        // 2026-10-10).
        const home = overLibrary(event.clientX, event.clientY);
        if (drag.kind === 'move' && drag.offLane && drag.clip && home) remove(drag.clip.id);
        else if (drag.candidate && !(drag.kind === 'add' && home)) commit(drag.candidate);
      }
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
    <SequenceComposerToolbar name={robotIdentity(active.robot.trajectory)} color={active.robot.color} onBack={onClose}
      trailing={onPlaybackRangeChange && <SelectControl className="timeline-range" aria-label={t('timeline.range')} value={playbackRange}
        onValueChange={(value) => onPlaybackRangeChange(value as PlaybackRange)}>
        <option value="full">{t('timeline.rangeFull')}</option>
        <option value="paths">{t('timeline.rangePaths')}</option>
      </SelectControl>} />
    <div className="sequence-route-library" ref={libraryRef}>
      {startRegions !== undefined && startRegions.length > 0 && anchorClip === undefined && <SelectControl className="timeline-range sequence-order" aria-label={t('sequence.orderLabel')} value={routeOrder}
        onValueChange={(value) => setRouteOrder(value as RouteOrder)}>
        <option value="name">{t('sequence.orderName')}</option>
        <option value="start">{t('sequence.orderStart')}</option>
      </SelectControl>}
      <div className="sequence-route-options">
      {library.map(({ route, blocked, outOfZone, continuity, region }, index) => {
        // A caption chip opens each start group (and the trailing unmatched
        // bucket) — only in "group by start" order, and only where the
        // group actually changes, so the flat alphabetical look stays
        // byte-identical for users who never switch.
        const groupChanged = grouped && captionFlags[index];
        // Gray-reason precedence: occupancy (nowhere to drop at all) over
        // the auto-period limit over a start outside the ALLIANCE ZONE over
        // the pose mismatch.
        const reason = !blocked ? null
          : occupied ? t('sequence.libraryOccupied')
          : route.trajectory.durationS > autoPeriodS ? limitMessage
          : outOfZone ? t('sequence.libraryStartZone')
          : continuity ? t('sequence.libraryBlocked', {
            name: anchorLabel,
            p: formatLength(continuity.positionGapM, unit, lang),
            h: `${n(continuity.headingGapDeg, 1)}°`,
          }) : null;
        return <Fragment key={route.id}>
        {groupChanged && <span aria-hidden="true" className="sequence-group-tag">{groupLabel(region)}</span>}
        <button type="button" className="sequence-route-source" draggable={false}
        // aria-disabled, not the disabled attribute (user 2026-10-07): a
        // disabled button receives no pointer/focus events, so a grayed
        // route could never be hovered for its preview. The button stays
        // interactive for hover/focus/keyboard reading; the ADD gestures
        // below refuse blocked routes themselves.
        aria-disabled={blocked ? 'true' : undefined}
        title={reason ? `${route.relPath} · ${n(route.trajectory.durationS, 2)}s · ${reason}` : `${route.relPath} · ${n(route.trajectory.durationS, 2)}s`}
        aria-label={`${routeLabel(route, active.routes)}: ${n(route.trajectory.durationS, 2)} s${reason ? ` · ${reason}` : ''}`}
        // Every route previews on hover or focus — grayed ones too (user
        // 2026-10-07): seeing where a blocked route goes is part of
        // planning. Only a running drag suspends the preview swap.
        onPointerEnter={() => { if (dragRef.current) return; onPreviewRoute?.(route.id); }}
        onPointerLeave={() => { if (dragRef.current) return; onPreviewRoute?.(null); }}
        onFocus={() => { if (dragRef.current) return; onPreviewRoute?.(route.id); }}
        onBlur={() => { if (dragRef.current) return; onPreviewRoute?.(null); }}
        onPointerDown={(event) => { if (blocked) return; begin(event, 'add', { id: crypto.randomUUID(), routeId: route.id, startS: 0, durationS: route.trajectory.durationS }); }}
        onClick={(event) => { if (blocked || (event.detail !== 0 && suppressClick.current)) return; append(route.id, route.trajectory.durationS); }}>
        <span aria-hidden="true" className="sequence-grip">⠿</span><span>{routeLabel(route, active.routes)}</span><small>{n(route.trajectory.durationS, 2)}s</small>
      </button></Fragment>; })}
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
                {editing && gap > 0 && !activeGhost && <span className="sequence-wait" style={{ left: percent(previousEnd), width: percent(gap) }}><span>{n(gap, 2)}s</span></span>}
                <button type="button" className={`sequence-clip${chosenClip ? ' is-chosen' : ''}${editing && activeGhost?.id === clip.id ? ' is-moving' : ''}`}
                  style={styleFor(clip)} aria-label={`${label}, ${n(clip.startS, 2)}–${n(clip.startS + clip.durationS, 2)} s`} aria-pressed={chosenClip}
                  title={`${label}\n${n(clip.startS, 2)}–${n(clip.startS + clip.durationS, 2)} s`}
                  // Hovering a placed leg previews that route on the field
                  // exactly like the library buttons (user 2026-10-07) —
                  // in ANY lane (user 2026-10-08): another team's leg
                  // resolves through that team's own library. Keyboard
                  // parity via focus.
                  onPointerEnter={() => { if (!dragRef.current) onPreviewRoute?.(clip.routeId, id); }}
                  onPointerLeave={() => { if (!dragRef.current) onPreviewRoute?.(null); }}
                  onFocus={() => { if (!dragRef.current) onPreviewRoute?.(clip.routeId, id); }}
                  onBlur={() => { if (!dragRef.current) onPreviewRoute?.(null); }}
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
                  <strong>{label}<small>{n(clip.durationS, 2)}s</small></strong>
                </button>
              </div>;
            })}
            {editing && clips.length === 0 && !activeGhost && <span className="sequence-empty-lane">{t('sequence.empty')}</span>}
            {editing && activeGhost && <>
              <div className={`sequence-ghost${validGhost ? '' : ' is-invalid'}`} style={styleFor(activeGhost)}>
                <strong>{ghostRoute ? routeLabel(ghostRoute, active.routes) : activeGhost.routeId}<small>{n(activeGhost.durationS, 2)}s</small></strong>
              </div>
              {clipGaps(clips, activeGhost).map((gap) => <div key={gap.side} className={`sequence-gap-guide ${gap.side}${gap.toS < gap.fromS ? ' is-overlap' : ''}`}
                style={{ left: percent(Math.min(gap.fromS, gap.toS)), width: percent(Math.abs(gap.toS - gap.fromS)) }}>
                <span>{n(gap.toS - gap.fromS, 2)}s</span>
              </div>)}
            </>}
            {playback && <span className="sequence-playhead" style={{ left: percent(Math.min(autoPeriodS, playback.t)) }} />}
          </div>
        </div>;
      })}
    </div></div>
    {chosen && <div className="sequence-selection-bar">
      <span className="sequence-selected-route">{active.routes.find((route) => route.id === chosen.routeId)?.relPath.split('/').at(-1)}</span>
      {/* Four linked editable views of one placement (user 2026-10-10):
          change any field and the others follow on the shared remount key
          (startS). First/last legs show only the neighbour side that
          exists; the imported duration is never stretched. */}
      {gapBeforeS !== undefined && previousEndS !== undefined && <label>{t('sequence.afterPrev')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min="0" step="any"
        defaultValue={formatStart(gapBeforeS)} aria-label={t('sequence.afterPrev')}
        {...placeField(gapBeforeS, (value) => previousEndS + value)} /> s</label>}
      <label>{t('sequence.start')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min="0" max={Math.max(0, autoPeriodS - chosen.durationS)} step="any"
        defaultValue={formatStart(chosen.startS)} aria-label={t('sequence.start')}
        {...placeField(chosen.startS, (value) => value)} /> s</label>
      <label>{t('sequence.end')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min={chosen.durationS} max={autoPeriodS} step="any"
        defaultValue={formatStart(chosenEndS!)} aria-label={t('sequence.end')}
        {...placeField(chosenEndS!, (value) => value - chosen.durationS)} /> s</label>
      {gapAfterS !== undefined && nextStartS !== undefined && <label>{t('sequence.beforeNext')} <input key={`${activeId}:${chosen.id}:${chosen.startS}`} type="number" min="0" step="any"
        defaultValue={formatStart(gapAfterS)} aria-label={t('sequence.beforeNext')}
        {...placeField(gapAfterS, (value) => nextStartS - value - chosen.durationS)} /> s</label>}
    </div>}
    {menu?.robotId === activeId && <div ref={menuRef} className="sequence-clip-menu" role="menu" aria-label={t('sequence.arrange')}
      style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 188)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 54)) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); laneRef.current?.focus(); } if (event.key === 'Tab') { event.stopPropagation(); setMenu(null); } }}>
      <button type="button" role="menuitem" onClick={() => remove(menu.clipId)}><Icon name="trash" size={14} />{t('sequence.removeRoute')}</button>
    </div>}
    <div className="sequence-composer-footnote"><span role="status" className="sequence-error">{error ?? ''}</span></div>
    {dragPoint && dragRef.current?.clip && !activeGhost && (() => {
      // Follow-along copy of the dragged route — the free-flight drag UI
      // (user 2026-10-10), shared by BOTH directions: a route dragged FROM
      // the library and a placed clip dragged OUT of the lane. Off the lane
      // the route rides the pointer itself, both axes free; releasing snaps
      // a library route into the editing lane (never a failed drop — edge
      // overshoots snap to the nearer edge) and removes a dragged-out clip
      // when it lands back on the library. Inside the lane the ghost takes
      // over and the badge hides — ghost + badge together would read as two
      // copies of the same path (user 2026-10-08).
      const source = active.routes.find((route) => route.id === dragRef.current!.clip!.routeId);
      return <div className="sequence-drag-badge" aria-hidden="true" style={{ left: dragPoint.x, top: dragPoint.y }}>
        <span>{source ? routeLabel(source, active.routes) : dragRef.current.clip.routeId}</span><small>{source ? `${n(source.trajectory.durationS, 2)}s` : ''}</small>
      </div>;
    })()}
    {playback && <div className="timeline-workspace sequence-playback-controls">
      <input type="range" min="0" max={autoPeriodS} step="0.01" value={Math.min(autoPeriodS, playback.t)} aria-label={t('timeline.position')}
        onChange={(event) => { playback.setPlaying(false); playback.setT(Number(event.target.value)); }} />
      <PlaybackControls playback={playback} end={playbackEndS ?? autoPeriodS} />
    </div>}
  </section>;
}

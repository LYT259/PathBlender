import { SelectControl } from './components/SelectControl';
import { moveTeamOrder } from './team-order';
import { previewRouteFor, useRoutePreviewClock } from './route-preview';
import { dimmedPathRobotIds, previewDimsPath } from './start-zone-view';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionHistory } from './session-history';
import { robotsForAlliance, restoreSessionAlliance } from './session-alliance';
import { isExampleRobot, refreshExampleRobots } from './example-robot';
import { EXAMPLE_RELOADING, consumeExampleRetryFlag, loadWelcomeExample, prefetchWelcomeExample } from './example-loader';
import { compareScenarios, remapColorblind } from '@pathblender/core';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import type { TeamOrderUI } from './components/TeamOrderUI';
import { GuideDialog } from './components/GuideDialog';
import { PreferencesPanel } from './components/PreferencesPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { UsageTip, useUsageTip } from './components/UsageTip';
import { OnboardingTasks, useTourProgress, type TourTaskId } from './components/OnboardingTasks';
import {
  applyProfileToTrajectory,
  CUSTOM_FIELD_ID,
  detectCollisions,
  detectFieldBounds,
  deserializeSession,
  FIELDS,
  fieldById,
  parsePathFile,
  parseRobotProfile,
  ParseError,
  REBUILT_2026,
  serializeSession,
  sessionDuration,
  hasEmptyArrangement,
  withFieldVariant,
  type FieldArtStyle,
  withSeasonGeometry,
} from '@pathblender/core';
import type { FieldPackage, RobotGeometry, RobotProfile, SessionTrajectory } from '@pathblender/core';
import { filesFromDataTransfer, toIncoming, type IncomingFile } from './dropped-files';
import { displayName, robotsFromImport, type LibraryProfile, type LibraryRoute } from './route-library';
import { withTeamPlaceholders } from './team-placeholder';
import { withColorblindPalette } from './session-colors';
import { loadAutosave, readSessionUi, saveAutosave } from './autosave';
import { saveText, saveBytes } from './download';
import { buildSolutionPackage } from './solution-package';
import { buildMenuSpec, menuCommandIds, menuSpecPayload } from './menu-spec';
import { MenuBar } from './components/MenuBar';
import { APP_VERSION } from './version-info';
import { fieldImageFor } from './field-images';
import { FIELD3D_MODELS } from './field3d-models';
import { FieldCanvas, type FieldCanvasHandle } from './components/FieldCanvas';
import type { FieldCanvas3DHandle } from './components/FieldCanvas3D';
const FieldCanvas3D = lazy(() => import('./components/FieldCanvas3D').then((module) => ({ default: module.FieldCanvas3D })));
import { Timeline } from './components/Timeline';
import { SequenceTimelineComposer } from './components/SequenceTimelineComposer';
import { RobotList, RobotInspector } from './components/RobotList';
import { applySequenceSegments, sequenceViewFor, type AutoSequenceSegment } from './auto-sequence-state';
import { clipsFor, sameClipLayout } from './sequence-timeline-clips';
import { applyUploadedProfile } from './robot-profile-ui';
import { checkSequenceJoins } from '@pathblender/core';
import { ConflictPanel } from './components/ConflictPanel';
import { ImportBanner } from './components/ImportBanner';
import { usePlayback } from './playback';
import { playbackEnd, usePlaybackRange } from './playback-range';
import { I18nProvider, useI18n } from './i18n';
import { CustomFieldPanel } from './components/CustomFieldPanel';
import { useUpdateChannel, type UpdateChannel } from './update-channel';
import { runUpdateCheck } from './update-check';
import { listenPrefs, readColorblind } from './pref-sync';
import { effectiveReverseScroll, useMouseControls, useReverseScrollZoom } from './mouse-controls';
import { setReverseScrollZoom } from './zoom';
import { VIEWER_ONLY } from './viewer';

const SESSION_EXT = '.pb';
// Sessions saved before the 2026-10-03 rename carry the legacy double
// extension; they must keep opening (naming-is-contract: files on disk).
const LEGACY_SESSION_EXT = '.ghpb.json';
const isSessionFileName = (name: string) => name.endsWith(SESSION_EXT) || name.endsWith(LEGACY_SESSION_EXT);
// The project's public home — the repo is private today; the link simply
// starts resolving once it goes public.
const GITHUB_URL = 'https://github.com/LYT259/pathblender';

// The field + variant survive refreshes (a custom field is not persisted —
// its definition lives only in the session payload).
const FIELD_PREF_KEY = 'pb.field';
type FieldPref = { id: string; variant: 'welded' | 'andymark'; style: FieldArtStyle };
function loadFieldPref(): FieldPref {
  // First-run defaults (user directive 2026-10-02): the current season,
  // welded construction, schematic artwork, 2D view.
  const fallback: FieldPref = { id: REBUILT_2026.id, variant: 'welded', style: 'schematic' };
  try {
    const raw = localStorage.getItem(FIELD_PREF_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<FieldPref>;
    const f = p.id ? fieldById(p.id) : undefined;
    if (!f) return fallback;
    return {
      id: f.id,
      variant: p.variant === 'andymark' && f.aprilTagsAndyMark ? 'andymark' : 'welded',
      style: p.style === 'rendered' ? 'rendered' : 'schematic',
    };
  } catch {
    return fallback;
  }
}
function rememberFieldPrefs(id: string, variant: 'welded' | 'andymark', style: FieldArtStyle) {
  if (id === CUSTOM_FIELD_ID) return;
  try {
    localStorage.setItem(FIELD_PREF_KEY, JSON.stringify({ id, variant, style }));
  } catch {
    /* private browsing — stickiness is best-effort */
  }
}

// The 2D/3D choice survives app restarts too (user directive 2026-10-02):
// leaving in 3D means the next launch opens in 3D. Only the user's own
// toggles are written — the model-less-season auto-fallback must not erase
// the stored preference.
const VIEW3D_KEY = 'pb.view3d';
function loadView3D(): boolean {
  try {
    return localStorage.getItem(VIEW3D_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberView3D(on: boolean) {
  try {
    localStorage.setItem(VIEW3D_KEY, on ? '1' : '0');
  } catch {
    /* best-effort */
  }
}

// Native menus supplement the same visible workspace actions.
const IS_DESKTOP = '__TAURI_INTERNALS__' in window || location.protocol === 'tauri:' || location.protocol === 'asset:';

export function App() {
  return (
    <I18nProvider>
      <AppBody />
    </I18nProvider>
  );
}

function AppBody() {
  const { lang, t: tr, n } = useI18n();
  // Reverse-scroll lives in the zoom module both canvases read — keep it
  // in sync here so 2D also flips while no 3D scene is mounted. The saved
  // checkbox reverses each scheme's own factory direction (Onshape scroll
  // up = zoom in, SOLIDWORKS scroll up = zoom out), so what the zoom
  // module receives is the EFFECTIVE flag.
  const [reverseScroll] = useReverseScrollZoom();
  const [mouseControlsScheme] = useMouseControls();
  useEffect(() => {
    setReverseScrollZoom(effectiveReverseScroll(mouseControlsScheme, reverseScroll));
  }, [mouseControlsScheme, reverseScroll]);
  const { channel: updateChannel } = useUpdateChannel();
  const [initialFieldPref] = useState(loadFieldPref);
  const { robots: sourceRobots, alliance, setRobots, setScene, setComposerOpen, change, composerOpen, fieldId, fieldVariant, fieldStyle, customField, customImageUrl, undo, redo, canUndo, canRedo } = useSessionHistory(initialFieldPref);
  const [previewRouteId, setPreviewRouteId] = useState<string | null>(null);
  // Which robot's library a hovered route resolves through (user 2026-10-08):
  // while editing one team, hovering another team's placed leg previews that
  // team's route. Undefined = the robot being edited (library hover/keys).
  const [previewRobotId, setPreviewRobotId] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped by Edit ▸ Rename Selected Team — RobotList opens the inline editor.
  const [renameSignal, setRenameSignal] = useState(0);
  const [inspectorMode, setInspectorMode] = useState<'checks' | 'robot'>('checks');
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [view3D, setView3D] = useState(loadView3D);
  // Once the user has entered 3D this session, the 3D canvas stays mounted
  // (hidden while 2D shows): remounting it rebuilds the whole WebGL scene
  // and re-uploads the field model, which showed "loading 3D view…" on every
  // 2D→3D switch. With it parked, the switch is instant (user request
  // 2026-10-06). First entry still lazy-loads the chunk behind Suspense.
  const [ever3D, setEver3D] = useState(loadView3D);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // In-app quick guide (onboarding plan §5): Help menu, welcome screen link.
  const [showGuide, setShowGuide] = useState(false);
  // Composer focus round trip (2026-10-06 keyboard pass): entering stores
  // the element that opened it, leaving puts focus back there — or on the
  // timeline's arrange button when the trigger is gone — so Escape never
  // strands the keyboard on <body>.
  const composerTriggerRef = useRef<HTMLElement | null>(null);
  const composeButtonRef = useRef<HTMLButtonElement | null>(null);
  function openPreferences() {
    if (!IS_DESKTOP) { setShowPrefs(true); return; }
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_preferences'))
      .catch(() => setShowPrefs(true));
  }
  /** External links: the desktop shell owns the default browser, the web opens a tab. */
  function openExternalUrl(url: string) {
    if (!IS_DESKTOP) { window.open(url, '_blank', 'noopener'); return; }
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_external', { url }))
      .catch(() => { window.open(url, '_blank', 'noopener'); });
  }
  const [exampleLoading, setExampleLoading] = useState(false);
  // A file import wins over a pending example module load.
  const exampleRequest = useRef(0);
  const { visible: showPlayTip, dismiss: dismissPlayTip } = useUsageTip('play');
  const { visible: showCheckTip, dismiss: dismissCheckTip } = useUsageTip('checks');
  // Post-import basics check (plan §4.4): surfaces once after a real import
  // (not with the example — its settings are curated) and dismisses locally.
  const [cfOpen, setCfOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);
  const flash = useCallback((msg: string, kind: 'ok' | 'error' = 'ok', ms = 2500) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, ms);
  }, []);
  const importInputRef = useRef<HTMLInputElement>(null);
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) workspaceMenuRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && workspaceMenuRef.current?.open) {
        // The open menu is the topmost layer — consume the key so the
        // composer (or any other Escape owner below) does not also fire.
        event.stopPropagation();
        workspaceMenuRef.current.open = false;
        workspaceMenuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  const canvasRef = useRef<FieldCanvasHandle>(null);
  const canvas3DRef = useRef<FieldCanvas3DHandle>(null);
  const baseField = fieldId === CUSTOM_FIELD_ID && customField ? customField : fieldById(fieldId);
  // The 2D artwork, its calibration, the tag overlay and the 3D beacons all
  // follow the selected field construction.
  const field = useMemo(
    () => (baseField ? withFieldVariant(baseField, fieldVariant, fieldStyle) : baseField),
    [baseField, fieldVariant, fieldStyle],
  );
  // Keep source paths in their original blue-side frame. Both renderers,
  // analysis, inspectors and session exports consume the same alliance view.
  const robots = useMemo(() => robotsForAlliance(sourceRobots, alliance, field), [sourceRobots, alliance, field]);
  const hasRobots = robots.length > 0;
  // Keyboard landing (2026-10-06 keyboard pass): the welcome button that
  // loaded the example is unmounted by the very action it triggered, which
  // dropped focus onto <body> — and the library sits ~48 tab stops deep, so
  // the keyboard needs to be handed a home. It lands silently: a focus ring
  // painted on a freshly opened app reads as a stray box over the first team
  // (user directive, 2026-10-06), and the first real key or click restores
  // ordinary focus styling.
  useEffect(() => {
    if (!hasRobots) return;
    if (document.activeElement !== document.body) return;
    const target = document.querySelector<HTMLElement>('.robot-library-select');
    if (!target) return;
    target.classList.add('focus-silent');
    target.focus();
    const clear = () => {
      target.classList.remove('focus-silent');
      document.removeEventListener('keydown', clear);
      document.removeEventListener('pointerdown', clear);
    };
    document.addEventListener('keydown', clear);
    document.addEventListener('pointerdown', clear);
    return clear;
  }, [hasRobots]);
  const fieldImageUrl = fieldImageFor(fieldId, fieldVariant, fieldStyle, customImageUrl);
  // Per-season rule-max geometry (MK5i plan, 2026-10-02): default-geometry
  // robots are re-resolved against the selected field's season, so checks
  // and rendering follow the season switch; file-provided sizes always win.
  const seasonRobots = useMemo(
    () => robots.map((r) => withSeasonGeometry(r, field.year)),
    [robots, field],
  );
  // 3D exists only where an official model does (2022+). Model-less seasons
  // (2018–2020) and custom fields offer no 3D at all — the hand-built
  // stand-in 3D was removed by user directive (2026-10-01).
  const field3dAvailable = !!FIELD3D_MODELS[fieldId];
  useEffect(() => {
    if (view3D && !field3dAvailable) setView3D(false);
  }, [view3D, field3dAvailable]);
  // One 2D/3D toggle and one view reset shared by the buttons and the
  // keyboard shortcuts (same business handler, never a second path).
  // Switching to 3D also arms the parked-canvas flag (#219).
  const setViewPref = useCallback((on: boolean) => {
    if (on) setEver3D(true);
    setView3D(on);
    rememberView3D(on);
  }, []);
  const resetView = useCallback(() => {
    if (view3D) canvas3DRef.current?.resetCam();
    else canvasRef.current?.fit();
  }, [view3D]);
  // Prewarm (2026-10-06 follow-up report): parking alone only made repeat
  // switches instant — the FIRST 3D click of a session still paid the whole
  // build synchronously (two WebGL contexts, the field GLB parse, shader
  // compile, the 4096² shadow bake), which read as "the click takes quite a
  // while to react". So once robots exist and the season has an official
  // model, mount the parked canvas hidden before any 3D click. Idle-deferred
  // with a timeout so it cannot starve behind continuous playback, and the
  // canvas renders one warm frame while hidden (FieldCanvas3D.warmup), so
  // shaders and GPU buffers are ready before the user ever switches.
  const [prewarm3D, setPrewarm3D] = useState(false);
  useEffect(() => {
    if (ever3D || !field3dAvailable || robots.length === 0) return;
    const idle = typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 3000 })
      : (cb: () => void) => window.setTimeout(cb, 600);
    const cancel = typeof cancelIdleCallback === 'function'
      ? (id: number) => cancelIdleCallback(id)
      : (id: number) => window.clearTimeout(id);
    const id = idle(() => setPrewarm3D(true));
    return () => cancel(id);
  }, [ever3D, field3dAvailable, robots.length]);
  // Field/variant memory is written ONLY from the user's own selects —
  // session-file restores must not overwrite it.

  // An explicitly EMPTY arrangement keeps its sidebar row but leaves the
  // stage: no honest pose to draw (the robot is not "parked", it is not
  // running an auto) and a phantom 0 s collision otherwise (user report
  // 2026-10-08, with screenshot).
  const visible = useMemo(() => seasonRobots.filter((r) => r.visible && !hasEmptyArrangement(r)), [seasonRobots]);
  const duration = sessionDuration(robots);
  // Bug report 2026-10-05: with playback range 'Current paths', hiding the
  // longest robot must shorten the loop to the longest VISIBLE one —
  // including mid-playback hides and every-robot-hidden (playback simply
  // stops, like an empty session). 'Full timeline' and collision checks keep
  // using their own scopes.
  const visibleDuration = sessionDuration(visible);
  const [playbackRange, setPlaybackRange] = usePlaybackRange();
  const previewSource = useMemo(() => composerOpen && previewRouteId
    ? previewRouteFor(previewRobotId
        ? sourceRobots.find((robot) => robot.trajectory.id === previewRobotId)
        : sourceRobots.find((robot) => robot.trajectory.id === selectedId) ?? sourceRobots[0], previewRouteId)
    : undefined, [composerOpen, previewRouteId, previewRobotId, sourceRobots, selectedId]);
  const previewTime = useRoutePreviewClock(previewSource);
  const previewRobots = useMemo(() => previewSource
    ? robotsForAlliance([previewSource], alliance, field).map((robot) => withSeasonGeometry(robot, field.year))
    : undefined, [previewSource, alliance, field]);
  // Field-gray for illegal starts (user 2026-10-09): a path whose first
  // driven leg starts outside the season's legal starting region renders
  // gray instead of the team color — the field-side twin of the composer's
  // first-leg gate, applied to paths that are already on the field
  // (imported files, restored sessions). A route preview grays only while
  // the picker would gate it too (target arrangement empty), so the field
  // never disagrees with the row being hovered.
  const dimPathIds = useMemo(() => {
    if (previewSource) {
      const target = previewRobotId
        ? sourceRobots.find((robot) => robot.trajectory.id === previewRobotId)
        : sourceRobots.find((robot) => robot.trajectory.id === selectedId) ?? sourceRobots[0];
      return previewDimsPath(target, previewSource, field.startZone)
        ? new Set([previewSource.trajectory.id])
        : new Set<string>();
    }
    return dimmedPathRobotIds(visible, field.startZone);
  }, [previewSource, previewRobotId, sourceRobots, selectedId, visible, field]);
  useEffect(() => { setPreviewRouteId(null); setPreviewRobotId(undefined); }, [composerOpen, selectedId]);
  // One transport end for BOTH modes (user 2026-10-07): editing used to
  // force the full auto period; the playback-range choice now governs
  // inside the composer too, with a synced selector in its control bar.
  const playbackEndS = playbackEnd(playbackRange === 'paths' ? visibleDuration : duration, field.autoPeriodS, playbackRange);
  // While editing, the playhead may park beyond the composed end — anywhere
  // on the auto axis — because it doubles as the route-library insertion
  // point (user 2026-10-08). Replay still loops at the range end.
  const playback = usePlayback(playbackEndS, !!previewSource, composerOpen ? field.autoPeriodS : playbackEndS);
  const { t, setT } = playback;
  useEffect(() => {
    if ((playback.playing || t > 0) && showPlayTip) dismissPlayTip();
  }, [playback.playing, t, showPlayTip, dismissPlayTip]);
  // Undo/redo (restored 2026-10-04) — like every history step, they cancel
  // playback and a pending example so the restored scene is what you see.
  const undoSession = useCallback(() => { exampleRequest.current += 1; setExampleLoading(false); playback.setPlaying(false); undo(); }, [playback.setPlaying, undo]);
  const redoSession = useCallback(() => { exampleRequest.current += 1; setExampleLoading(false); playback.setPlaying(false); redo(); }, [playback.setPlaying, redo]);

  // Colorblind-safe robot palette (§7.3-3): the toggle remaps default
  // palette colors in place; custom colors pass through (core remap).
  const [colorblind, setColorblind] = useState(readColorblind);
  // Robots entering the state (restore, imports, example) read the CURRENT
  // preference through this ref — the effect below only runs when the
  // toggle flips, so it never sees arrivals made while the preference was
  // already on.
  const colorblindRef = useRef(colorblind);
  useEffect(() => {
    colorblindRef.current = colorblind;
    setRobots((prev) =>
      prev.length === 0 ? prev : prev.map((r) => ({ ...r, color: remapColorblind(r.color, colorblind) })),
    );
    // The preference itself persists via the settings panel; the remap
    // effect above only needs to run when the toggle flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorblind]);
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key === 'colorblindPalette') setColorblind(v === '1');
      }),
    [],
  );

  // §6.5-①: the tolerance slider rescans pair windows at relative start
  // shifts ±2δ — worst-case execution timing, not just the paper plan.
  const [toleranceS, setToleranceS] = useState(0);
  // The canvas-bar overlay pair (trail tape + occupancy heatmap) defaults to
  // both ON, and each side toggles independently — both-on, both-off and
  // either mix are all valid (user request 2026-10-07).
  const [showTrail, setShowTrail] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  // A-B compare: first click snapshots the scenario, second reports deltas.
  const abBaselineRef = useRef<SessionTrajectory[] | null>(null);
  // Hidden robots are absent for checks too (user request 2026-10-04):
  // their conflict rings, bounds notes and panel entries disappear with
  // the robot and come back when it does — detection and display both
  // follow the visible set.
  const conflicts = useMemo(
    () => detectCollisions(visible, { toleranceS: toleranceS > 0 ? toleranceS : undefined }),
    [visible, toleranceS],
  );
  const bounds = useMemo(() => detectFieldBounds(visible, field), [visible, field]);

  // .path texts stay available so later .auto imports can resolve their
  // pathName references (within the same batch or across this session).
  const pathTextsRef = useRef(new Map<string, string>());
  // A loose configuration picked before any loose import waits for the next loose import.
  const pendingProfilesRef = useRef<LibraryProfile[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Every imported file, raw (relPath → File): the solution package's
  // per-team 原始导入文件 sources. Bytes stay on disk until export reads them.
  const importedFileStoreRef = useRef(new Map<string, File>());
  // Applied settings.json per robot — also for the solution package.
  const settingsFilesRef = useRef(new Map<string, File>());

  const importFiles = useCallback(async (files: FileList | File[] | IncomingFile[], opts?: { fromFolder?: boolean }) => {
    exampleRequest.current += 1;
    setExampleLoading(false);
    const nextErrors: { fileName: string; message: string }[] = [];
    const incoming = toIncoming(files);
    // Keep every incoming file raw — the solution package's per-team
    // 原始导入文件 come from here (byte-identical to what was imported).
    for (const { file, relPath } of incoming) importedFileStoreRef.current.set(relPath, file);
    // A folder drop/pick is any import that carries paths below its root.
    const fromFolder = opts?.fromFolder ?? incoming.some((f) => f.relPath.includes('/'));
    const knownRouteExt = /\.(traj|ghostauto|path|auto|chor)$/i;
    const batch = new Map<string, string>(fromFolder ? [] : pathTextsRef.current);
    for (const { file, relPath } of incoming) {
      if (/\.path$/i.test(file.name)) {
        const stem = relPath.split('/').pop()!.replace(/\.path$/i, '');
        batch.set(fromFolder ? relPath : stem, await file.text());
      }
    }
    const addedRoutes: LibraryRoute[] = [];
    const addedProfiles: LibraryProfile[] = [];
    for (const { file, relPath } of incoming) {
      if (fromFolder && !knownRouteExt.test(file.name) && !/\.json$/i.test(file.name)) continue;
      const text = await file.text();
      // Session files restore as a whole session rather than one robot.
      if (!fromFolder && isSessionFileName(relPath)) {
        try {
          const restored = deserializeSession(text);
          const ui = readSessionUi(text);
          pathTextsRef.current.clear();
          pendingProfilesRef.current = [];
          importedFileStoreRef.current.clear();
          settingsFilesRef.current.clear();
          setScene({ ...restoreSessionAlliance({ ...restored, robots: withTeamPlaceholders(withColorblindPalette(restored.robots, colorblindRef.current)) }), fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
          const ids = new Set(restored.robots.map((r) => r.trajectory.id));
          setSelectedId(
            ui?.selectedId && ids.has(ui.selectedId)
              ? ui.selectedId
              : restored.robots[0]?.trajectory.id ?? null,
          );
          if (ui?.playbackRange) setPlaybackRange(ui.playbackRange);
          setInspectorMode('checks');
          playback.setPlaying(false);
          pendingRestoreT.current = ui?.t ?? 0;
          setErrors([]);
          return;
        } catch {
          nextErrors.push({ fileName: relPath, message: tr('import.notSession') });
          continue;
        }
      }
      let profile: RobotProfile | null = null;
      try {
        profile = parseRobotProfile(text, relPath);
      } catch {
        // Not JSON — let the route parsers raise their (identical) error.
      }
      if (profile) {
        addedProfiles.push({ id: crypto.randomUUID(), relPath, profile });
        continue;
      }
      try {
        const traj = parsePathFile(text, relPath, (name) => {
          if (!fromFolder) return batch.get(name);
          const root = relPath.split('/')[0];
          const matches = [...batch].filter(([path]) => path.split('/')[0] === root && path.split('/').at(-1) === `${name}.path`);
          return matches.length === 1 ? matches[0]![1] : undefined;
        });
        addedRoutes.push({ id: crypto.randomUUID(), relPath, trajectory: traj });
      } catch (e) {
        // Folder imports tolerate bystanders (jars, images, dotfiles);
        // anything claiming a known route extension still reports honestly.
        if (fromFolder && !knownRouteExt.test(file.name)) continue;
        const message =
          e instanceof ParseError
            ? friendlyParseError(e, file.name, tr)
            : e instanceof Error
              ? e.message
              : String(e);
        nextErrors.push({ fileName: relPath, message });
      }
    }
    // A folder that yielded nothing usable is also an answer — say so with the
    // file count instead of leaving the field untouched and unexplained.
    if (
      fromFolder &&
      addedRoutes.length === 0 &&
      addedProfiles.length === 0 &&
      nextErrors.length === 0 &&
      incoming.length > 0
    ) {
      nextErrors.push({
        fileName: incoming[0]!.relPath.split('/')[0] || incoming[0]!.file.name,
        message: tr('import.folderNoRoutes'),
      });
    }
    if (!fromFolder) pathTextsRef.current = batch;
    if (addedRoutes.length > 0) {
      const profiles = fromFolder ? addedProfiles : [...pendingProfilesRef.current, ...addedProfiles];
      const additions = robotsFromImport(addedRoutes, profiles, fromFolder, sourceRobots.length);
      if (!fromFolder) pendingProfilesRef.current = [];
      setRobots((prev) => withTeamPlaceholders(withColorblindPalette([...prev, ...additions], colorblindRef.current)));
      setSelectedId(additions[0]!.trajectory.id);
      setInspectorMode('checks');
      flash(tr('library.imported', { n: addedRoutes.length, m: addedProfiles.length }));
    } else if (!fromFolder && addedProfiles.length > 0 && sourceRobots.length > 0) {
      const targetId = selectedId ?? sourceRobots[0]!.trajectory.id;
      setRobots((prev) => prev.map((robot) => robot.trajectory.id === targetId
        ? { ...robot, profileOptions: [...(robot.profileOptions ?? []), ...addedProfiles] }
        : robot));
      setSelectedId(targetId);
      setInspectorMode('robot');
      flash(tr('library.imported', { n: 0, m: addedProfiles.length }));
    } else if (!fromFolder && addedProfiles.length > 0) {
      pendingProfilesRef.current.push(...addedProfiles);
      flash(tr('library.imported', { n: 0, m: addedProfiles.length }));
    } else if (fromFolder && !addedRoutes.length && !nextErrors.length) {
      nextErrors.push({ fileName: incoming[0]?.relPath.split('/')[0] ?? '', message: tr('import.folderNoRoutes') });
    }
    setErrors(nextErrors);
  }, [tr, flash, sourceRobots.length, selectedId, setRobots, setScene, setT, playback.setPlaying]);

  /**
   * Folder picker result, with every silent exit removed. Before this handler
   * existed, `if (files?.length)` swallowed both "the engine handed back the
   * folder but never expanded it" and "the folder held nothing parseable", so
   * pressing Open looked like a dead button.
   */
  const onFolderPicked = useCallback(async (list: File[]) => {
    // The property is '' in browsers that support it and simply absent in
    // others, so never assume it exists.
    const rootOf = (f: File) => (f.webkitRelativePath ?? '').split('/')[0] || f.name;
    if (list.length === 0) {
      setErrors([{ fileName: tr('library.importFolder'), message: tr('import.emptyFolder') }]);
      return;
    }
    if (!list.some((f) => f.webkitRelativePath)) {
      setErrors([{
        fileName: rootOf(list[0]!),
        message: tr('import.folderNotExpanded'),
      }]);
      return;
    }
    await importFiles(list, { fromFolder: true });
  }, [importFiles, tr]);

  /** Imported profiles also belong to one team. */
  const applyProfile = useCallback((robotId: string, profileId: string) => {
    setRobots((prev) => prev.map((robot) => {
      if (robot.trajectory.id !== robotId) return robot;
      const entry = robot.profileOptions?.find((profile) => profile.id === profileId);
      if (!entry) return robot;
      // §6.6: geometry always applies; a dynamics-carrying profile also
      // regenerates PathPlanner timelines against the real robot.
      return { ...robot, profileId: entry.id, trajectory: applyProfileToTrajectory(robot.trajectory, entry.profile) };
    }));
  }, [setRobots]);

  /**
   * settings.json upload (red book §6.6 entrance ②, post-hoc card import):
   * parse + validate through core, then apply coherently to the robot and
   * its whole route library. Only a real successful application removes the
   * upload action — cancel, corrupt or unrelated JSON leaves it in place.
   */
  const applySettingsFile = useCallback(async (robotId: string, file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      flash(tr('robots.settingsUnreadable'), 'error');
      return;
    }
    let profile: RobotProfile | null;
    try {
      profile = parseRobotProfile(text, file.name);
    } catch (e) {
      const message = e instanceof ParseError && e.kind === 'invalid-json'
        ? tr('import.invalidJson')
        : tr('robots.settingsNotProfile');
      flash(message, 'error');
      return;
    }
    if (!profile) {
      flash(tr('robots.settingsNotProfile'), 'error');
      return;
    }
    setRobots((prev) => prev.map((robot) => (
      robot.trajectory.id === robotId ? applyUploadedProfile(robot, profile, file.name) : robot
    )));
    settingsFilesRef.current.set(robotId, file);
    flash(tr('robots.settingsApplied', { name: profile.name }));
  }, [flash, tr, setRobots]);

  // Whole-window drag & drop; folders are walked recursively.
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt) return;
      void (async () => {
        const collected = dt.items ? await filesFromDataTransfer(dt.items) : null;
        if (collected && collected.length > 0) {
          void importFiles(collected);
          return;
        }
        if (dt.files.length) void importFiles(dt.files);
      })();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  const updateRobot = useCallback((id: string, patch: Partial<SessionTrajectory>) => {
    setRobots((prev) => withTeamPlaceholders(prev.map((r) => r.trajectory.id === id
      ? { ...r, ...patch, trajectory: patch.trajectory
        ? { ...r.trajectory, teamNumber: patch.trajectory.teamNumber, displayName: patch.trajectory.displayName }
        : r.trajectory }
      : r)));
  }, []);

  // Team display order (2026-10-08): one reshuffled robots array is the
  // single truth both the robot list and the timeline read; the move rides
  // the session history (undo/redo, autosave, .pb round trip all follow),
  // and moveTeamOrder itself is the only reordering code. Playback, colors,
  // selection and every timing field are untouched — slots move by identity.
  const moveTeam = useCallback((id: string, targetId: string, edge: 'before' | 'after') => {
    setRobots((prev) => moveTeamOrder(prev, id, targetId, edge));
  }, [setRobots]);
  const teamOrder: TeamOrderUI = useMemo(() => ({
    ids: robots.map((robot) => robot.trajectory.id),
    onMove: moveTeam,
  }), [robots, moveTeam]);

  const selectRobot = useCallback((id: string) => {
    setSelectedId(id);
    // Switching to a robot IS the intent to look at it (user 2026-10-08):
    // if it was hidden, the selection itself unhides it — otherwise the
    // click seems to do nothing and the user must find the eye toggle.
    // An already-visible robot touches NOTHING: setRobots is the session
    // history's setter, and a no-op rewrite would spend an undo step.
    setRobots((prev) => prev.some((r) => r.trajectory.id === id && !r.visible)
      ? prev.map((r) => (r.trajectory.id === id ? { ...r, visible: true } : r))
      : prev);
    setInspectorMode('robot');
  }, []);
  // Double-clicking a team's timeline row enters that team's arrangement
  // editing directly; leaving is a click anywhere outside the surface.
  // Entering is a view change and must not stop the transport (user
  // 2026-10-07, same rule as the 16.12 view switches).
  const openSequenceFor = useCallback((id: string) => {
    composerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selectRobot(id);
    setComposerOpen(true);
  }, [selectRobot, setComposerOpen]);
  const closeComposer = useCallback(() => {
    setComposerOpen(false);
    const trigger = composerTriggerRef.current;
    composerTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
    else composeButtonRef.current?.focus();
  }, [setComposerOpen]);
  const selectedRobot = robots.find((r) => r.trajectory.id === selectedId) ?? robots[0];
  // , / . cycle the robot selection in session order (keyboard pass) — the
  // same selectRobot the cards and timeline rows call, inspector included.
  const stepRobot = useCallback((dir: number) => {
    if (robots.length === 0) return;
    const current = robots.findIndex((r) => r.trajectory.id === (selectedRobot?.trajectory.id ?? ''));
    const next = robots[(Math.max(0, current) + dir + robots.length) % robots.length]!;
    selectRobot(next.trajectory.id);
  }, [robots, selectedRobot, selectRobot]);
  // Arrangement edits share the source store with playback, checks and autosave.
  const sourceSelectedRobot = sourceRobots.find((robot) => robot.trajectory.id === selectedRobot?.trajectory.id);
  const sequenceJoins = useMemo(() => sourceSelectedRobot ? checkSequenceJoins(sourceSelectedRobot) : [], [sourceSelectedRobot]);
  /* Onboarding tour (2026-10-07 plan §3): tasks are marked only while the
     example session is active — the ref re-binds the fresh closure every
     render so the stable action callbacks below can mark without each
     carrying the whole scene as a dependency. */
  const tour = useTourProgress();
  const tourMarkRef = useRef<(id: TourTaskId) => void>(() => {});
  tourMarkRef.current = (id) => { if (hasExample) tour.mark(id); };

  const editSequence = useCallback((segments: AutoSequenceSegment[]) => {
    if (!sourceSelectedRobot) return;
    tourMarkRef.current('plan');
    const id = sourceSelectedRobot.trajectory.id;
    setRobots((previous) => previous.map((robot) => {
      if (robot.trajectory.id !== id) return robot;
      const view = sequenceViewFor(robot);
      if (sameClipLayout(clipsFor(view.segments, view.routes), clipsFor(segments, view.routes))) return robot;
      const next = applySequenceSegments(robot, segments);
      const firstRouteId = segments[0]?.routeId;
      return firstRouteId && robot.routeOptions?.some((option) => option.id === firstRouteId)
        ? { ...next, routeId: firstRouteId } : next;
    }));
  }, [sourceSelectedRobot, setRobots]);
  const jumpToSeam = useCallback((time: number) => {
    playback.setPlaying(false);
    setT(time);
  }, [playback.setPlaying, setT]);





  /**
   * Per-team left/right mirror (user-approved, 2026-10-05): the flag lives on
   * the slot and the alliance view derives it, so imported samples stay
   * untouched, the toggle is an involution, undo/redo follow the ordinary
   * history, and routes added to the team inherit the state.
   * User request 2026-10-06: it is a view switch, not a transport control —
   * an ongoing playback keeps running (the pause that used to hide the pose
   * swap is gone, same as alliance / field / artwork / 2D-3D switches).
   */
  const toggleMirror = useCallback((id: string) => {
    tourMarkRef.current('mirror');
    setRobots((prev) => prev.map((r) => r.trajectory.id === id ? { ...r, mirrored: !(r.mirrored === true) } : r));
  }, [setRobots]);
  const mirroredIds = useMemo(
    () => new Set(robots.filter((r) => r.mirrored === true).map((r) => r.trajectory.id)),
    [robots],
  );

  /**
   * Context-menu removal (2026-10-05): one history step covering the robots,
   * the slot's unsaved draft and the composer if it was editing that slot.
   * Only the session slot goes — the source files on disk are never touched.
   */
  const removeSlot = useCallback((id: string) => {
    change((prev) => {
      const robots = prev.robots.filter((r) => r.trajectory.id !== id);
      return {
        ...prev,
        robots,
        drafts: Object.fromEntries(Object.entries(prev.drafts).filter(([key]) => key !== id)),
        composerOpen: prev.composerOpen && robots.length > 0,
      };
    });
    setSelectedId((current) => (current === id ? null : current));
  }, [change]);

  const saveSession = useCallback(() => {
    // The hosted website is a viewer: it must not write session files. Dropping
    // the menu item was not enough — the web accelerator below calls this
    // directly, so pathblender.pages.dev downloaded a .pb on ⌘S/Ctrl+S with no
    // button anywhere. Gated at the function so no caller can reintroduce it.
    if (VIEWER_ONLY) return;
    const file = JSON.parse(
      serializeSession(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined),
    ) as Record<string, unknown>;
    file.ui = { selectedId, t, playbackRange };
    void saveText(
      `session-${new Date().toISOString().slice(0, 10)}${SESSION_EXT}`,
      'json',
      JSON.stringify(file, null, 2),
    );
  }, [robots, fieldId, field, selectedId, t, playbackRange]);

  // ⌘Z / Ctrl+Z undo, Shift = redo (restored 2026-10-04). Ignored while an
  // input, select, textarea or modal owns focus, so typing stays untouched.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const element = e.target instanceof Element ? e.target : null;
      if ((!e.metaKey && !e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.altKey || element?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (e.shiftKey) redoSession(); else undoSession();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undoSession, redoSession]);

  // Workspace keyboard shortcuts (2026-10-06 keyboard pass). Scopes:
  // letters/digits act on the workspace only when no text field owns them,
  // no modal is open and the composer is closed (it owns its keys); ? opens
  // the shortcut help from anywhere. Each maps onto the SAME handler its
  // button calls. Single-shot keys ignore key repeat; view/playback
  // continuous keys live in the canvases and the playback hook.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      // A modal dialog owns the whole keyboard — no workspace keys beneath it.
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      if (e.key === '?' && !e.repeat) {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      if (composerOpen) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (!hasRobots || e.repeat) return;
      const selected = selectedRobot?.trajectory.id;
      if (!selected) return;
      if (e.code === 'Comma' && !e.shiftKey) {
        e.preventDefault();
        stepRobot(-1);
      } else if (e.code === 'Period' && !e.shiftKey) {
        e.preventDefault();
        stepRobot(1);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        openSequenceFor(selected);
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        const robot = robots.find((r) => r.trajectory.id === selected);
        if (robot) updateRobot(selected, { visible: !robot.visible });
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMirror(selected);
      } else if ((e.key === 'v' || e.key === 'V') && field3dAvailable) {
        e.preventDefault();
        setViewPref(!view3D);
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // stepRobot reads only `robots` + selection; it is defined below and
    // stable per render, so the full dependency list covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, hasRobots, robots, selectedRobot, updateRobot, toggleMirror, openSequenceFor, setViewPref, resetView, view3D, field3dAvailable]);

  // Escape returns from the composer even when focus is OUTSIDE it (the
  // composer's own handler covers focus inside; this is the safety net for
  // focus on body or a control the composer does not contain). A modal
  // dialog owns the top layer and wins.
  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      closeComposer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composerOpen, closeComposer]);

  // Launch continuity (user report 2026-10-02: quitting in 3D reopened to
  // the welcome page — the 3D pref was honored but only after a fresh
  // import). Restore the autosaved session once on mount; a desktop
  // open-with file that arrives later simply replaces whatever this restored.
  useEffect(() => {
    const restored = loadAutosave();
    if (!restored) return;
    const apply = (robots: typeof restored.robots) => {
      setScene({ ...restoreSessionAlliance({ ...restored, robots: withTeamPlaceholders(withColorblindPalette(robots, colorblindRef.current)) }), fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
      // Reopen exactly where the user left (2026-10-04): saved selection
      // (validated — a refreshed example robot may have carried the old id
      // away), playback range, and the playhead. The playhead goes through
      // pendingRestoreT because setT clamps against the current duration,
      // which is still 0 in this mount render.
      const ids = new Set(robots.map((r) => r.trajectory.id));
      setSelectedId(
        restored.ui?.selectedId && ids.has(restored.ui.selectedId)
          ? restored.ui.selectedId
          : robots[0]?.trajectory.id ?? null,
      );
      if (restored.ui?.playbackRange) setPlaybackRange(restored.ui.playbackRange);
      pendingRestoreT.current = restored.ui?.t ?? 0;
    };
    // A restored example is whatever the demo looked like when it was saved;
    // swap in the current example set so a relaunch shows today's demo (the
    // lazy import keeps the 1.6 MB of route text off sessions without one).
    if (restored.robots.some(isExampleRobot)) {
      void import('./welcome-example').then(({ createWelcomeExample }) => {
        apply(refreshExampleRobots(restored.robots, createWelcomeExample().robots));
      });
      return;
    }
    apply(restored.robots);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Playhead waiting for its duration: the restore effect runs while the
  // scene is still empty (duration 0), where setT would clamp to 0.
  const pendingRestoreT = useRef<number | null>(null);
  useEffect(() => {
    if (pendingRestoreT.current === null || duration === 0) return;
    setT(pendingRestoreT.current);
    pendingRestoreT.current = null;
  }, [duration, setT]);

  // Persist completed scene operations even while the playback clock runs.
  // Skip the initial empty render so the mount-time restore owns that pass.
  const lastSavedScene = useRef({ robots, fieldId, field, selectedId, playbackRange });
  const latestSessionUi = useRef({ selectedId, t, playbackRange });
  latestSessionUi.current = { selectedId, t, playbackRange };
  useEffect(() => {
    const previous = lastSavedScene.current;
    if (previous.robots === robots && previous.fieldId === fieldId && previous.field === field && previous.selectedId === selectedId && previous.playbackRange === playbackRange) return;
    lastSavedScene.current = { robots, fieldId, field, selectedId, playbackRange };
    saveAutosave(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined, latestSessionUi.current);
  }, [robots, fieldId, field, selectedId, playbackRange]);

  // Keep the autosave current (debounced; removing the last robot clears
  // the slot so the next launch opens on the welcome page again). The ui
  // slot makes the reopen land where the user left: selection, playhead
  // and playback range ride along with the robots.
  useEffect(() => {
    const id = setTimeout(
      () => saveAutosave(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined, { selectedId, t, playbackRange }),
      600,
    );
    return () => clearTimeout(id);
  }, [robots, fieldId, field, selectedId, t, playbackRange]);

  // The debounce never fires between the last edit and an abrupt close, so
  // unload flushes synchronously. Desktop measures differently: WKWebView
  // fires neither `beforeunload` nor a Tauri `onCloseRequested` when the app
  // is quit (checked against the WebKit store on disk twice, 2026-10-06 —
  // a clean Cmd+Q produces no write at all). That is acceptable because the
  // scene-op save above is immediate: paths, arrangement, colour, visibility
  // and delay are on disk the moment they change. Only the playhead can be up
  // to one debounce window stale, and there is no desktop hook to close it.
  const autosaveFlush = useRef<() => void>(() => {});
  autosaveFlush.current = () => saveAutosave(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined, { selectedId, t, playbackRange });
  useEffect(() => {
    const flush = () => autosaveFlush.current();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // PNG export was removed for good (user decision 2026-10-05, recorded in
  // the deletion ledger) — do not re-add it. GIF stays.
  const exportGif = useCallback(() => {
    if (view3D) {
      flash(tr('toast.gifOnly2d'));
      return;
    }
    flash(tr('toast.gifRendering'));
    canvasRef.current?.exportGif((ok) => flash(tr(ok ? 'toast.gifSaved' : 'toast.gifFailed'), ok ? 'ok' : 'error'));
  }, [view3D, flash, tr]);

  const abToggle = useCallback(() => {
    if (abBaselineRef.current === null) {
      abBaselineRef.current = robots;
      flash(tr('checks.abBaselineSet'));
      return;
    }
    const result = compareScenarios(abBaselineRef.current, robots);
    abBaselineRef.current = null;
    if (result.pairs.length === 0) {
      flash(tr('checks.abNoPairs'));
      return;
    }
    const tightest = result.pairs[0]!;
    flash(tr('checks.abDelta', {
      d: n(Math.abs(tightest.deltaM), 2),
      dir: tightest.deltaM >= 0 ? tr('checks.abSafer') : tr('checks.abTighter'),
    }));
  }, [robots, flash, tr, n]);

  // Native "Check for Updates…" and channel switches. The Rust shell owns
  // the channel→feed mapping (check_update); feed unreachable (offline, or
  // no release assets yet) reports 'failed' → the honest toast, not a fake
  // "up to date". Install + relaunch are one hop: the user asked for it.
  const checkForUpdates = useCallback(
    (ch: UpdateChannel = updateChannel) => {
      if (!IS_DESKTOP) return;
      void runUpdateCheck(ch, (e) => {
        if (e.kind === 'found') flash(tr('updates.downloading', { v: e.version }));
        else if (e.kind === 'upToDate') flash(tr('updates.upToDate'));
        else if (e.kind === 'failed') flash(tr('updates.failed'), 'error');
        // 'installed' — the relaunch is already in flight; nothing left to say.
      });
    },
    [flash, tr, updateChannel],
  );

  // Channel switches from any window (in-app modal here, or the ⌘, prefs
  // window via the pref bridge — broadcasts self-deliver too) immediately
  // check the newly selected channel's feed. The event carries the value,
  // so no stale-closure race with the state update.
  const checkRef = useRef(checkForUpdates);
  useEffect(() => {
    checkRef.current = checkForUpdates;
  }, [checkForUpdates]);
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (v === 'beta' || v === 'stable') {
          if (key === 'updateChannel') checkRef.current(v);
        }
      }),
    [],
  );

  const clearAll = useCallback(() => {
    exampleRequest.current += 1;
    setExampleLoading(false);
    setRobots([]);
    pathTextsRef.current.clear();
    pendingProfilesRef.current = [];
    importedFileStoreRef.current.clear();
    settingsFilesRef.current.clear();
    setErrors([]);
    setT(0);
    playback.setPlaying(false);
    setSelectedId(null);
    setComposerOpen(false);
  }, [setT, setRobots, playback.setPlaying, setComposerOpen]);
  // Desktop: native menu commands and visible buttons share the same
  // handlers — the binding lives with the menu block near the end of this
  // component, driven by the shared menu spec (menu-spec.ts).

  // Desktop open-with: the shell evals a `pb-open-files` CustomEvent with
  // [name, base64] pairs (launch-argument files and native-picker imports
  // both arrive here — push-only, no privileged channel; ADR-0003).
  useEffect(() => {
    const deliver = (pairs: unknown) => {
      if (!Array.isArray(pairs)) return;
      const files = pairs
        .filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string')
        .map(([name, b64]) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return new File([bytes], name);
        });
      if (files.length) void Promise.resolve(importFiles(files)).catch(() => undefined);
    };
    const onOpen = (e: Event) => {
      delete (window as { __pbOpenPayload?: unknown }).__pbOpenPayload;
      deliver((e as CustomEvent).detail);
    };
    window.addEventListener('pb-open-files', onOpen);
    // The shell may have delivered before React mounted — consume the stash.
    const w = window as { __pbOpenPayload?: unknown };
    if (w.__pbOpenPayload) {
      const stash = w.__pbOpenPayload;
      delete w.__pbOpenPayload;
      deliver(stash);
    }
    return () => window.removeEventListener('pb-open-files', onOpen);
  }, [importFiles]);

  // Keep the native menu's language in sync with the in-app preference —
  // handled by the full `set_menu` push in the menu block (the spec carries
  // the labels, so the shell needs no language tables of its own).

  const hasExample = robots.some(isExampleRobot);

  // Play detection for the tour (plan §3): needs hasExample, so it lives
  // here rather than with the tour hook — deps arrays evaluate eagerly.
  useEffect(() => {
    if (hasExample && playback.playing) tourMarkRef.current('play');
  }, [playback.playing, hasExample]);
  // Both side panels stay open while robots exist — there is no collapse
  // entry point left, so a panel can never be closed without a way back.
  const leftOpen = hasRobots;
  const issueCount = conflicts.length + bounds.length;
  const rightOpen = hasRobots;
  const openImport = () => importInputRef.current?.click();
  // The repo link must open the user's system browser from the desktop shell
  // (handoff 2026-10-05): inside WKWebView/WebKitGTK a plain `target="_blank"`
  // anchor is not routed outward, so the desktop path asks the Rust shell to
  // open it (allowlisted there); the web keeps the ordinary anchor.
  const openGithub = (e: { preventDefault: () => void }) => {
    if (!IS_DESKTOP) return;
    e.preventDefault();
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_external', { url: GITHUB_URL }))
      .catch(() => { window.open(GITHUB_URL, '_blank', 'noopener'); });
  };
  const tryExample = async () => {
    const request = ++exampleRequest.current;
    setExampleLoading(true);
    try {
      const { createWelcomeExample } = await loadWelcomeExample();
      if (request !== exampleRequest.current) return;
      const example = createWelcomeExample();
      // Show it on the field the user actually uses — first visit defaults
      // to AndyMark, afterwards the remembered season + construction.
      setScene({
        robots: withColorblindPalette(example.robots, colorblindRef.current),
        fieldId: initialFieldPref.id,
        fieldVariant: initialFieldPref.variant,
        fieldStyle: initialFieldPref.style,
        customField: undefined,
        customImageUrl: undefined,
      });
      importedFileStoreRef.current.clear();
      settingsFilesRef.current.clear();
      setSelectedId(example.robots[0]?.trajectory.id ?? null);
      setInspectorMode('checks');
      setView3D(false);
      setErrors([]);
      setT(0);
      setComposerOpen(false);
    } catch (err) {
      // The reload fallback replaces the whole document — no error toast for
      // it, the page re-opens the example by itself once it lands.
      if (err !== EXAMPLE_RELOADING && request === exampleRequest.current) flash(tr('welcome.exampleFailed'), 'error');
    } finally {
      if (request === exampleRequest.current) setExampleLoading(false);
    }
  };
  const exitExample = () => {
    // Ending the example always lands on the welcome page (user 2026-10-04:
    // keeping the session's other robots read as "exiting into another
    // workspace" whenever any non-example robot — an adopted route pick or
    // an import made while exploring — was present). Clearing the last
    // robot also clears the autosave slot, so the next launch starts at
    // the welcome page too; the whole exit stays undo-able via ⌘Z.
    setRobots([]);
    setSelectedId(null);
    playback.setPlaying(false);
    setT(0);
    setComposerOpen(false);
    importedFileStoreRef.current.clear();
    settingsFilesRef.current.clear();
  };
  // Landing side of the loader's reload fallback: the reloaded page re-opens
  // the example by itself, unless an autosaved session is already taking over
  // the scene (mount effects read pre-update state, so ask the source).
  useEffect(() => {
    if (!consumeExampleRetryFlag()) return;
    if (loadAutosave()?.robots.length) return;
    void tryExample();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);
  // Warm the example chunk while the welcome page is on screen, so the click
  // that asks for it needs no fresh 456 KB round-trip (and survives a link
  // that drops right afterwards). Failure is logged inside the loader and
  // never pinned — a later click retries.
  useEffect(() => {
    if (hasRobots) return;
    const warm = () => void prefetchWelcomeExample().catch(() => undefined);
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm);
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, [hasRobots]);
  const jumpToIssue = (time: number, robotIds: string[] = []) => {
    dismissCheckTip();
    tourMarkRef.current('issue');
    playback.setPlaying(false);
    setT(time);
    if (robotIds[0]) {
      setSelectedId(robotIds[0]);
    }
    // Checks run on the visible set only, so a located problem always
    // belongs to a robot that is already on the field.
  };

  /* ---------------------------------------------------------------- */
  /* Menu bar (2026-10-06) — one spec for the web menubar and the      */
  /* native desktop menu; ids below are the dispatch contract.         */
  /* ---------------------------------------------------------------- */

  const [exportingPackage, setExportingPackage] = useState(false);
  const exportSolutionPackage = useCallback(() => {
    if (exportingPackage) return;
    if (robots.length === 0) { flash(tr('toast.pkgNeedRobots'), 'error'); return; }
    setExportingPackage(true);
    void (async () => {
      try {
        const result = await buildSolutionPackage({
          robots,
          visibleRobots: visible,
          field,
          fieldId,
          customFieldForSession: fieldId === CUSTOM_FIELD_ID ? field : undefined,
          fieldImageUrl,
          rawFiles: importedFileStoreRef.current,
          settingsFiles: settingsFilesRef.current,
          conflicts,
          bounds,
          appVersion: APP_VERSION,
          onProgress: (stage) => flash(
            tr(stage === 'recording' ? 'toast.pkgRecording' : stage === 'rendering' ? 'toast.pkgRendering' : 'toast.pkgSaving'),
            'ok',
            stage === 'recording' ? 21_000 : 2_500,
          ),
        });
        if (!result.entries.some((name) => name.startsWith('回放.'))) flash(tr('toast.pkgNoVideo'), 'error');
        const ok = await saveBytes(result.suggestedName, 'zip', result.zip);
        flash(tr(ok ? 'toast.pkgSaved' : 'toast.pkgFailed'), ok ? 'ok' : 'error');
      } catch {
        flash(tr('toast.pkgFailed'), 'error');
      } finally {
        setExportingPackage(false);
      }
    })();
  }, [exportingPackage, robots, visible, field, fieldId, fieldImageUrl, conflicts, bounds, flash, tr]);

  // Native menu undo/redo: the ⌘Z accelerator is claimed by the menu, so the
  // old keydown path never fires on desktop. Inside a text field the session
  // undo must not fire — fall through to the engine's text undo instead.
  const menuUndo = useCallback(() => {
    const el = document.activeElement instanceof Element ? document.activeElement : null;
    if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || document.querySelector('[aria-modal="true"]')) {
      document.execCommand('undo');
      return;
    }
    undoSession();
  }, [undoSession]);
  const menuRedo = useCallback(() => {
    const el = document.activeElement instanceof Element ? document.activeElement : null;
    if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || document.querySelector('[aria-modal="true"]')) {
      document.execCommand('redo');
      return;
    }
    redoSession();
  }, [redoSession]);

  // Alliance, season, field construction and artwork style are view switches
  // on the same scene, so they share one rule (user request 2026-10-06): an
  // ongoing playback keeps running through them instead of pausing.
  const switchAlliance = useCallback((side: 'blue' | 'red') => {
    if (alliance === side) return;
    tourMarkRef.current('alliance');
    setScene({ alliance: side });
  }, [alliance, setScene]);
  const selectSeason = useCallback((id: string) => {
    if (id === CUSTOM_FIELD_ID) { setCfOpen(true); return; }
    setScene({ fieldId: id });
    rememberFieldPrefs(id, fieldVariant, fieldStyle);
  }, [fieldVariant, fieldStyle, setScene]);
  const selectVariant = useCallback((variant: 'welded' | 'andymark') => {
    if (fieldVariant === variant) return;
    setScene({ fieldVariant: variant });
    if (fieldId !== CUSTOM_FIELD_ID) rememberFieldPrefs(fieldId, variant, fieldStyle);
  }, [fieldVariant, fieldId, fieldStyle, setScene]);
  const selectStyle = useCallback((style: 'schematic' | 'rendered') => {
    if (fieldStyle === style) return;
    setScene({ fieldStyle: style });
    if (fieldId !== CUSTOM_FIELD_ID) rememberFieldPrefs(fieldId, fieldVariant, style);
  }, [fieldStyle, fieldId, fieldVariant, setScene]);
  const jumpFirstIssue = () => {
    const conflict = conflicts[0];
    if (conflict) { jumpToIssue(conflict.closestT, [conflict.aId, conflict.bId]); return; }
    const bound = bounds[0];
    if (bound) jumpToIssue((bound.startT + bound.endT) / 2, [bound.robotId]);
  };

  const menuSpec = useMemo(() => buildMenuSpec({
    t: tr,
    robotsCount: robots.length,
    hasSelection: !!selectedId && sourceRobots.some((r) => r.trajectory.id === selectedId),
    selectedVisible: selectedRobot?.visible ?? true,
    composerOpen,
    canUndo,
    canRedo,
    view3D,
    field3dAvailable,
    alliance,
    fieldId,
    fieldVariant,
    andymarkAvailable: !!field.aprilTagsAndyMark,
    hasRenderedArt: !!field.imageRendered,
    fieldStyle,
    showHeatmap,
    playing: playback.playing,
    speed: playback.speed,
    playbackRange,
    hasIssues: issueCount > 0,
    viewerOnly: VIEWER_ONLY,
    isDesktop: IS_DESKTOP,
    hasExample,
  }), [tr, robots.length, selectedId, sourceRobots, selectedRobot, composerOpen, canUndo, canRedo, view3D, field3dAvailable, alliance, fieldId, fieldVariant, field, fieldStyle, showHeatmap, playback.playing, playback.speed, playbackRange, issueCount, hasExample]);

  // The full menu action table — one entry per menu-spec id. The web MenuBar
  // calls runMenuCommand directly; the desktop shell dispatches pb-menu-<id>
  // CustomEvents routed here by the effect below. The ref keeps the
  // (spec-driven) listener binding mount-stable while closures stay fresh.
  const menuHandlersRef = useRef<Record<string, () => void>>({});
  menuHandlersRef.current = {
    import: openImport,
    'import-folder': () => folderInputRef.current?.click(),
    'open-session': () => sessionInputRef.current?.click(),
    save: saveSession,
    'export-package': exportSolutionPackage,
    'export-gif': exportGif,
    clear: clearAll,
    undo: menuUndo,
    redo: menuRedo,
    'rename-selected': () => setRenameSignal((n) => n + 1),
    'mirror-selected': () => { if (selectedId) toggleMirror(selectedId); },
    'visibility-selected': () => {
      if (!selectedId) return;
      const target = sourceRobots.find((r) => r.trajectory.id === selectedId);
      updateRobot(selectedId, { visible: !(target?.visible ?? true) });
    },
    'remove-selected': () => { if (selectedId) removeSlot(selectedId); },
    'apply-profile': () => setInspectorMode('robot'),
    'arrange-selected': () => { if (selectedId) openSequenceFor(selectedId); },
    'composer-back': () => closeComposer(),
    fit: () => resetView(),
    // The keyboard pass shares ONE 2D/3D entry with the buttons — it also
    // arms the parked-canvas flag, which the raw setters skipped.
    'view-2d': () => setViewPref(false),
    'view-3d': () => setViewPref(true),
    'alliance-blue': () => switchAlliance('blue'),
    'alliance-red': () => switchAlliance('red'),
    'construction-welded': () => selectVariant('welded'),
    'construction-andymark': () => selectVariant('andymark'),
    'style-schematic': () => selectStyle('schematic'),
    'style-rendered': () => selectStyle('rendered'),
    heatmap: () => setShowHeatmap((v) => !v),
    'ab-compare': abToggle,
    'play-pause': () => playback.setPlaying(!playback.playing),
    rewind: () => { playback.setPlaying(false); setT(0); },
    'step-back': () => { playback.setPlaying(false); setT((v) => v - 0.5); },
    'step-forward': () => { playback.setPlaying(false); setT((v) => v + 0.5); },
    'speed-0_25': () => playback.setSpeed(0.25),
    'speed-0_5': () => playback.setSpeed(0.5),
    'speed-1': () => playback.setSpeed(1),
    'range-full': () => setPlaybackRange('full'),
    'range-paths': () => setPlaybackRange('paths'),
    'jump-first-issue': jumpFirstIssue,
    preferences: openPreferences,
    'check-update': () => void checkForUpdates(),
    'open-guide': () => setShowGuide(true),
    'open-shortcuts': () => setShowHelp(true),
    // Tour entry (plan §3): opens the example when none is running and
    // un-dismisses the checklist; progress survives both.
    'open-tour': () => { if (!hasExample) void tryExample(); tour.reopen(); },
    github: () => openExternalUrl(GITHUB_URL),
    about: () => { if (IS_DESKTOP) openPreferences(); else setShowPrefs(true); },
  };
  for (const f of FIELDS) {
    menuHandlersRef.current[`season-${f.id}`] = () => selectSeason(f.id);
  }
  const runMenuCommand = (id: string) => { menuHandlersRef.current[id]?.(); };

  // Desktop: bind every spec id to its pb-menu-* event (the shell evals
  // them — ADR-0003), and push the whole menu (labels included) to the
  // shell so the native menu mirrors the web one in every UI language.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const ids = menuCommandIds(menuSpec);
    const unbinds = ids.map((id) => {
      const h = () => menuHandlersRef.current[id]?.();
      window.addEventListener(`pb-menu-${id}`, h);
      return () => window.removeEventListener(`pb-menu-${id}`, h);
    });
    return () => unbinds.forEach((u) => u());
  }, [menuSpec]);
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const id = setTimeout(() => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_menu', { payload: menuSpecPayload(menuSpec) }))
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(id);
  }, [menuSpec]);

  // Web keyboard shortcuts mirroring the desktop accelerators (on desktop
  // the native menu claims these keys, so the keydown never fires there).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); saveSession(); }
      else if (k === 'o') { e.preventDefault(); openImport(); }
      else if (k === '0') {
        e.preventDefault();
        if (view3D) canvas3DRef.current?.resetCam();
        else canvasRef.current?.fit();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [saveSession, view3D]);

  return (
    <div className={`app${hasRobots ? '' : ' is-welcome'}`}>
      {/* The web has no native menu — the shared spec renders as a DOM
          menubar. Desktop keeps its native menu and never mounts this. */}
      {!IS_DESKTOP && <MenuBar menus={menuSpec} onCommand={runMenuCommand} />}
      <header className="toolbar workspace-toolbar" data-tauri-drag-region="deep" aria-label={tr('app.title')}>
        {hasRobots && <button className="btn accent import-action" onClick={openImport}><Icon name="import" />{tr('robots.import')}</button>}
        <input ref={importInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }} />
        {hasRobots && <button className="btn accent import-folder-action" onClick={() => folderInputRef.current?.click()} title={tr('library.importFolderHint')}><Icon name="folder" />{tr('library.importFolder')}</button>}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          // Directory mode must be a CONTENT attribute. WebKit reads it at
          // parse time and ignores an IDL assignment (`el.webkitdirectory =
          // true`), which silently degraded this to a plain file panel: a
          // chosen folder is not a valid file, so the change came back with
          // zero files and nothing happened. `directory` is the standardized
          // spelling; engines that know it accept either.
          // @ts-expect-error non-standard attributes, supported everywhere
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            const el = e.currentTarget;
            const list = Array.from(el.files ?? []);
            // Reset before reporting, and never let the reset decide
            // whether the user hears back: some engines refuse a value
            // write on a file input.
            try {
              el.value = '';
            } catch {
              /* the picker keeps its selection; the import already ran */
            }
            void onFolderPicked(list);
          }}
        />
        <input ref={sessionInputRef} type="file" accept=".pb,.ghpb.json" hidden aria-label={tr('welcome.openSession')} onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          if (!isSessionFileName(file.name)) { setErrors([{ fileName: file.name, message: tr('import.notSession') }]); return; }
          void importFiles([file]);
        }} />
        {hasRobots && <button className="tool-btn square" title={tr('workspace.home')} aria-label={tr('workspace.home')} onClick={clearAll}><Icon name="home" /></button>}
        {hasRobots && <div className="history-controls">
          <button className="tool-btn square" data-session-history="undo" title={tr('workspace.undo')} aria-label={tr('workspace.undo')} disabled={!canUndo} onClick={undoSession}><Icon name="undo" /></button>
          <button className="tool-btn square" data-session-history="redo" title={tr('workspace.redo')} aria-label={tr('workspace.redo')} disabled={!canRedo} onClick={redoSession}><Icon name="redo" /></button>
        </div>}
        {hasRobots && <a className="tool-btn square toolbar-github" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" onClick={openGithub}><Icon name="github" size={18} /></a>}
        <span className="toolbar-spacer" data-tauri-drag-region="" />
        {/* Save moved to the File menu (2026-10-06): the menu bar is the
            complete entry point, so the workspace keeps only controls that
            benefit from sitting next to the field. */}
        {hasRobots && <details ref={workspaceMenuRef} className="workspace-menu">
          <summary className="tool-btn square" aria-label={tr('workspace.more')} title={tr('workspace.more')}><Icon name="more" /></summary>
          <div className="workspace-menu-items" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            {hasRobots && <button onClick={abToggle}>{tr('actions.abCompare')}</button>}
            <button onClick={() => setShowHelp(true)} aria-keyshortcuts="?">{tr('help.title')}</button>
          </div>
        </details>}
        <button className="tool-btn square" aria-label={tr('prefs.title')} title={tr('prefs.title')} onClick={openPreferences}><Icon name="settings" /></button>
      </header>
      <div className="app-col">
        <ImportBanner errors={errors} onDismiss={() => setErrors([])} />
        <main className={`app-body workspace-body ${leftOpen ? 'with-paths' : ''} ${rightOpen ? 'with-inspector' : ''}`}>
          {leftOpen && <RobotList teamOrder={teamOrder} robots={robots} conflicts={conflicts} selectedId={selectedRobot?.trajectory.id ?? null} onSelect={selectRobot} onImport={openImport} onUpdate={updateRobot} onArrange={openSequenceFor} onSelectSettings={(id, file) => { void applySettingsFile(id, file); }} onRemoveFromMenu={removeSlot} onMirror={toggleMirror} onMirrorButtonClick={toggleMirror} mirroredIds={mirroredIds} renameSignal={renameSignal} header={
            hasExample && !tour.dismissed ? <OnboardingTasks done={tour.done} expanded={tour.expanded} onToggle={tour.toggle} onDismiss={tour.dismiss} /> : undefined
          } />}
          <section className="workspace-stage" aria-label={tr('canvas.view')}>
            {hasExample && <div className="example-notice"><strong>{tr('welcome.exampleBadge')}</strong><span>{tr('welcome.exampleNotice')}</span><button className="btn small" onClick={exitExample}>{tr('welcome.exitExample')}</button></div>}
            <div className="canvas-slot">
              {/* The import page stays clean: the field picker, its construction
                  variant and the 2D/3D switch only become useful once there is
                  something on the field, so the bar appears with the robots. */}
              {hasRobots && <div className="canvas-bar workspace-canvas-bar">
                <div className="field-options">
                  <SelectControl className="field-select" aria-label={tr('workspace.season')} value={fieldId} onValueChange={selectSeason}>
                    {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name} {f.year}</option>)}
                    <option value={CUSTOM_FIELD_ID}>{tr('customField.title')}</option>
                  </SelectControl>
                  {field.aprilTagsAndyMark && <div className="seg field-variant-toggle" role="group" aria-label={tr('field.variant')}>
                    {(['welded', 'andymark'] as const).map((variant) => <button key={variant} type="button" aria-pressed={fieldVariant === variant} className={fieldVariant === variant ? 'on' : ''} onClick={() => selectVariant(variant)}>{variant === 'andymark' ? 'AndyMark' : 'Welded'}</button>)}
                  </div>}
                  {/* 2D-artwork switcher, hidden in 3D: the official field
                      model replaces the artwork plane entirely (the image
                      only feeds the no-model fallback), so both styles
                      render the same scene there (user request 2026-10-02). */}
                  {!view3D && field.imageRendered && <div className="seg field-style-toggle" role="group" aria-label={tr('field.style')}>
                    {(['schematic', 'rendered'] as const).map((style) => <button key={style} type="button" aria-pressed={fieldStyle === style} className={fieldStyle === style ? 'on' : ''} onClick={() => selectStyle(style)}>{tr(`field.style.${style}`)}</button>)}
                  </div>}
                </div>
                <div className="session-alliance" role="group" aria-label={tr('robots.alliance')}>
                  <div className="seg alliance-toggle">
                    {(['blue', 'red'] as const).map((side) => <button key={side} type="button" className={`alliance-${side}${alliance === side ? ' on' : ''}`} aria-pressed={alliance === side} onClick={() => switchAlliance(side)}>{tr(side === 'blue' ? 'robots.blue' : 'robots.red')}</button>)}
                  </div>
                </div>
                <span className="canvas-spacer" />
                {/* Overlay pair, styled after the 2D/3D switch but with each
                    side its own toggle (user request 2026-10-07): the trail
                    tape and the occupancy heatmap can be shown together,
                    separately, or not at all. It sits LEFT of the 2D/3D
                    switch on purpose — it is not part of that group. */}
                <div className="seg overlay-toggle" role="group" aria-label={tr('canvas.overlays')}>
                  <button type="button" aria-pressed={showTrail} className={showTrail ? 'on' : ''} title={tr('canvas.trailHint')} onClick={() => setShowTrail((v) => !v)}>{tr('canvas.trail')}</button>
                  <button type="button" aria-pressed={showHeatmap} className={showHeatmap ? 'on' : ''} title={tr('canvas.heatmapHint')} onClick={() => setShowHeatmap((v) => !v)}>{tr('canvas.heatmap')}</button>
                </div>
                {field3dAvailable && (
                  <div className="seg view-toggle" role="group" aria-label={tr('canvas.view')}>
                    <button aria-pressed={!view3D} className={!view3D ? 'on' : ''} aria-keyshortcuts="v" onClick={() => setViewPref(false)}>2D</button>
                    <button aria-pressed={view3D} className={view3D ? 'on' : ''} aria-keyshortcuts="v" onClick={() => setViewPref(true)}>3D</button>
                  </div>
                )}
                {/* The rest of the bar needs a robot to act on, which the gate
                    above now guarantees. */}
                <button className="tool-btn canvas-recenter" aria-label={tr('canvas.fit')} title={tr('canvas.fit')} aria-keyshortcuts="0" onClick={resetView}><Icon name="recenter" size={17} /></button>
              </div>}
              {!hasRobots ? <WelcomeScreen onImport={openImport} onImportFolder={() => folderInputRef.current?.click()} onOpenSession={() => sessionInputRef.current?.click()} onTryExample={() => void tryExample()} exampleLoading={exampleLoading} onOpenGuide={() => setShowGuide(true)} /> : <>
                {/* Parked 3D: mounted at the first 3D entry — or earlier,
                    prewarmed hidden once robots exist (see prewarm3D above) —
                    then hidden (not unmounted) while 2D shows: scene, models
                    and camera survive, so every switch is instant, first
                    click included. `active` pauses the render loop while
                    hidden; warmup() bakes one hidden frame so shaders and
                    GPU buffers are ready before the first click. Seasons
                    without an official model unmount it (field3dAvailable),
                    remounting on return to a modeled season behind the usual
                    loading fallback. */}
                {(ever3D || prewarm3D) && field3dAvailable && <div className="canvas-3d-keep" hidden={!view3D}>
                  <Suspense fallback={<div className="view-loading" role="status">{tr('workspace.loading3d')}</div>}>
                    <FieldCanvas3D active={view3D} showTrail={showTrail} showHeatmap={showHeatmap} ref={canvas3DRef} variant={fieldVariant} field={field} fieldImageUrl={fieldImageUrl} robots={previewRobots ?? visible} currentT={previewSource ? previewTime : t} dimPathIds={dimPathIds} />
                  </Suspense>
                </div>}
                {!view3D && <FieldCanvas ref={canvasRef} showTrail={showTrail} showHeatmap={showHeatmap} field={field} fieldImageUrl={fieldImageUrl} robots={previewRobots ?? visible} currentT={previewSource ? previewTime : t} conflicts={previewSource ? [] : conflicts} bounds={previewSource ? [] : bounds} dimPathIds={dimPathIds} />}
              </>}
            </div>
            {hasRobots && <div className="workspace-status"><span>{tr('workspace.imported', { n: robots.length })}</span>{/* A pure indicator, not a control — no ring, no click (user 2026-10-07). */}
              <span className={`status-check${issueCount ? ' status-warning' : ''}`} role="status"><Icon name={issueCount ? 'warning' : 'check'} size={14} />{issueCount ? tr('checks.issues', { n: issueCount }) : tr(robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle')}</span></div>}
          </section>
          <aside className="workspace-inspector" hidden={!rightOpen}>
            <div className="inspector-header"><div className="seg inspector-tabs" role="group" aria-label={tr('workspace.panels')}>
              <button className={inspectorMode === 'checks' ? 'on' : ''} aria-pressed={inspectorMode === 'checks'} onClick={() => setInspectorMode('checks')}>{tr('workspace.checks')}{issueCount > 0 && <span className="tab-count">{issueCount}</span>}</button>
              <button className={inspectorMode === 'robot' ? 'on' : ''} aria-pressed={inspectorMode === 'robot'} onClick={() => setInspectorMode('robot')}>{tr('workspace.details')}</button>
            </div></div>
            {inspectorMode === 'checks' && <ConflictPanel robots={robots} conflicts={conflicts} bounds={bounds} onJump={jumpToIssue} toleranceS={toleranceS} onToleranceChange={setToleranceS} guide={issueCount > 0 && showCheckTip && <UsageTip text={tr('onboarding.check')} onDismiss={dismissCheckTip} />} />}
            {inspectorMode === 'robot' && <div className="inspector-scroll"><RobotInspector robot={selectedRobot ? withSeasonGeometry(selectedRobot, field.year) : undefined} libraryProfiles={selectedRobot?.profileOptions ?? []} onApplyProfile={applyProfile} /></div>}
          </aside>
        </main>
        {/* Playback spans the full workspace, below both side panels. */}
{hasRobots && !composerOpen && <footer className="app-footer"><Timeline teamOrder={teamOrder} composeAction={<button ref={composeButtonRef} className="btn small" aria-keyshortcuts="e" onClick={() => { const id = (selectedRobot ?? robots[0])?.trajectory.id; if (id) openSequenceFor(id); }}>{tr('sequence.arrange')}</button>} robots={robots} autoPeriodS={field.autoPeriodS} duration={duration} visibleDuration={visibleDuration} playback={playback} playbackRange={playbackRange} onPlaybackRangeChange={setPlaybackRange} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} onEditTeam={openSequenceFor} onJump={jumpToIssue} guide={showPlayTip && <UsageTip text={tr('onboarding.play')} onDismiss={dismissPlayTip} />} /></footer>}
        {hasRobots && <SequenceTimelineComposer robots={sourceRobots} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} autoPeriodS={field.autoPeriodS} startZone={field.startZone} startRegions={field.startRegions} open={composerOpen} onClose={closeComposer} onChange={editSequence} onPreviewRoute={(routeId, robotId) => { setPreviewRouteId(routeId); setPreviewRobotId(routeId ? robotId : undefined); }} joins={sequenceJoins} playback={playback} playbackEndS={playbackEndS} playbackRange={playbackRange} onPlaybackRangeChange={setPlaybackRange} onJump={jumpToSeam} />}

      {cfOpen && <CustomFieldPanel
        open
        onClose={() => setCfOpen(false)}
        current={customField}
        currentImageUrl={customImageUrl}
        onApply={(f, url) => {
          setScene({ customField: f, customImageUrl: url, fieldId: CUSTOM_FIELD_ID });
        }}
      />}
      {toast && <div className={toast.kind === 'error' ? 'toast error' : 'toast'} role="status">{toast.msg}</div>}
      {showPrefs && <Dialog title={tr('prefs.title')} onClose={() => setShowPrefs(false)} className="preferences-dialog">
        <PreferencesPanel desktop={IS_DESKTOP} onClose={() => setShowPrefs(false)} onColorblindSaved={setColorblind} />
      </Dialog>}
      {showGuide && <GuideDialog onClose={() => setShowGuide(false)} onOpenShortcuts={() => { setShowGuide(false); setShowHelp(true); }} onOpenUrl={openExternalUrl} />}
      {showHelp && <Dialog title={tr('help.title')} onClose={() => setShowHelp(false)} className="help-dialog">
        <p className="help-intro">{tr('help.intro')}</p>
        <div className="help-groups">
          <section>
            <h3>{tr('help.group.playback')}</h3>
            <HelpRow keys="Space" label={`${tr('timeline.play')} / ${tr('timeline.pause')}`} />
            <HelpRow keys="← / →" label={`${tr('timeline.stepBack')} / ${tr('timeline.stepForward')} · ⇧ 2 s`} />
            <HelpRow keys="Home" label={tr('timeline.rewind')} />
            <HelpRow keys="End" label={tr('help.playbackEnd')} />
            <HelpRow keys="⇧ , / ⇧ ." label={tr('timeline.playbackSpeed')} />
          </section>
          <section>
            <h3>{tr('help.group.view')}</h3>
            {/* The canvas-scope keys (zoom/orbit/pan/cube presets) went with
                the canvas focus feature (user 2026-10-07) — scrubbing, refit
                and the view toggle are global and stay listed. */}
            <HelpRow keys="0" label={tr('canvas.fit')} />
            <HelpRow keys="V" label={tr('help.viewToggle')} />
          </section>
          <section>
            <h3>{tr('help.group.robot')}</h3>
            <HelpRow keys=", / ." label={tr('help.switchRobot')} />
            <HelpRow keys="H" label={tr('help.hideShow')} />
            <HelpRow keys="M" label={tr('robots.mirror')} />
            <HelpRow keys="E" label={tr('sequence.arrange')} />
          </section>
          <section>
            <h3>{tr('sequence.arrange')}</h3>
            <HelpRow keys="Esc" label={tr('sequence.back')} />
            <HelpRow keys="← / →" label={`${tr('help.composerMove')} · ⇧ 1 s`} />
            <HelpRow keys="Del / ⌫" label={tr('help.deleteClip')} />
            <HelpRow keys="⇧ F10" label={tr('sequence.removeRoute')} />
          </section>
          <section>
            <h3>{tr('workspace.more')}</h3>
            <HelpRow keys="⌘Z / Ctrl+Z" label={tr('workspace.undo')} />
            <HelpRow keys="⇧⌘Z / Ctrl+⇧Z" label={tr('workspace.redo')} />
            <HelpRow keys="?" label={tr('help.title')} />
          </section>
        </div>
        <p className="help-desktop-hint">{tr('help.hint.desktop')}</p>
      </Dialog>}
      </div>
    </div>
  );
}

function HelpRow({ keys, label }: { keys: string; label: string }) {
  return <div className="help-row"><kbd dir="ltr">{keys}</kbd><span>{label}</span></div>;
}

function friendlyParseError(
  e: ParseError,
  fileName: string,
  tr: ReturnType<typeof useI18n>['t'],
): string {
  switch (e.kind) {
    case 'invalid-json':
      return tr('import.invalidJson');
    case 'missing-trajectory':
      return tr('import.missingTrajectory');
    case 'empty-trajectory':
      return tr('import.empty');
    case 'not-yet-supported':
      return e.message;
    default:
      return tr('import.unrecognized', { f: fileName });
  }
}

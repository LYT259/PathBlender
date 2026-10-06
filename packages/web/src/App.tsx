import { previewRouteFor, useRoutePreviewClock } from './route-preview';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionHistory } from './session-history';
import { robotsForAlliance, restoreSessionAlliance } from './session-alliance';
import { isExampleRobot, refreshExampleRobots } from './example-robot';
import { compareScenarios, remapColorblind } from '@pathblender/core';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { PreferencesPanel } from './components/PreferencesPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { UsageTip, useUsageTip } from './components/UsageTip';
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
import { saveText } from './download';
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
import { VIEWER_ONLY, SITE_PREVIEW, SITE_URLS } from './viewer';

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
  const { lang, t: tr } = useI18n();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  function openPreferences() {
    if (!IS_DESKTOP) { setShowPrefs(true); return; }
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('open_preferences'))
      .catch(() => setShowPrefs(true));
  }
  const [exampleLoading, setExampleLoading] = useState(false);
  // A file import wins over a pending example module load.
  const exampleRequest = useRef(0);
  const { visible: showPlayTip, dismiss: dismissPlayTip } = useUsageTip('play');
  const { visible: showCheckTip, dismiss: dismissCheckTip } = useUsageTip('checks');
  const [cfOpen, setCfOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);
  const flash = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 2500);
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
  // Field/variant memory is written ONLY from the user's own selects —
  // session-file restores must not overwrite it.

  const visible = useMemo(() => seasonRobots.filter((r) => r.visible), [seasonRobots]);
  const duration = sessionDuration(robots);
  // Bug report 2026-10-05: with playback range 'Current paths', hiding the
  // longest robot must shorten the loop to the longest VISIBLE one —
  // including mid-playback hides and every-robot-hidden (playback simply
  // stops, like an empty session). 'Full timeline' and collision checks keep
  // using their own scopes.
  const visibleDuration = sessionDuration(visible);
  const [playbackRange, setPlaybackRange] = usePlaybackRange();
  const previewSource = useMemo(() => composerOpen && previewRouteId
    ? previewRouteFor(sourceRobots.find((robot) => robot.trajectory.id === selectedId) ?? sourceRobots[0], previewRouteId)
    : undefined, [composerOpen, previewRouteId, sourceRobots, selectedId]);
  const previewTime = useRoutePreviewClock(previewSource);
  const previewRobots = useMemo(() => previewSource
    ? robotsForAlliance([previewSource], alliance, field).map((robot) => withSeasonGeometry(robot, field.year))
    : undefined, [previewSource, alliance, field]);
  useEffect(() => { setPreviewRouteId(null); }, [composerOpen, selectedId]);
  const playback = usePlayback(composerOpen ? field.autoPeriodS : playbackEnd(playbackRange === 'paths' ? visibleDuration : duration, field.autoPeriodS, playbackRange), !!previewSource);
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
  const [showHeatmap, setShowHeatmap] = useState(false);
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
  // A loose configuration picked before any path waits for the next loose import.
  const pendingProfilesRef = useRef<LibraryProfile[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const importFiles = useCallback(async (files: FileList | File[] | IncomingFile[], opts?: { fromFolder?: boolean }) => {
    exampleRequest.current += 1;
    setExampleLoading(false);
    const nextErrors: { fileName: string; message: string }[] = [];
    const incoming = toIncoming(files);
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

  const selectRobot = useCallback((id: string) => {
    setSelectedId(id);
    setInspectorMode('robot');
  }, []);
  // Double-clicking a team's timeline row enters that team's arrangement
  // editing directly; leaving is a click anywhere outside the surface.
  const openSequenceFor = useCallback((id: string) => {
    playback.setPlaying(false);
    selectRobot(id);
    setComposerOpen(true);
  }, [playback.setPlaying, selectRobot, setComposerOpen]);
  const selectedRobot = robots.find((r) => r.trajectory.id === selectedId) ?? robots[0];
  // Arrangement edits share the source store with playback, checks and autosave.
  const sourceSelectedRobot = sourceRobots.find((robot) => robot.trajectory.id === selectedRobot?.trajectory.id);
  const sequenceJoins = useMemo(() => sourceSelectedRobot ? checkSequenceJoins(sourceSelectedRobot) : [], [sourceSelectedRobot]);
  const editSequence = useCallback((segments: AutoSequenceSegment[]) => {
    if (!sourceSelectedRobot) return;
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
   * history, and routes added to the team inherit the state. Playback pauses
   * so the whole-slot pose swap never reads as motion; the playhead stays.
   */
  const toggleMirror = useCallback((id: string) => {
    playback.setPlaying(false);
    setRobots((prev) => prev.map((r) => r.trajectory.id === id ? { ...r, mirrored: !(r.mirrored === true) } : r));
  }, [playback.setPlaying, setRobots]);
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

  // The debounce never fires between the last edit and Cmd+Q — flush
  // synchronously on unload so a quit loses nothing (route pick included).
  useEffect(() => {
    const flush = () => saveAutosave(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined, { selectedId, t, playbackRange });
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [robots, fieldId, field, selectedId, t, playbackRange]);

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
      d: Math.abs(tightest.deltaM).toFixed(2),
      dir: tightest.deltaM >= 0 ? tr('checks.abSafer') : tr('checks.abTighter'),
    }));
  }, [robots, flash, tr]);

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
    setErrors([]);
    setT(0);
    playback.setPlaying(false);
    setSelectedId(null);
    setComposerOpen(false);
  }, [setT, setRobots, playback.setPlaying, setComposerOpen]);
  // Desktop: native menu commands and visible buttons share the same handlers.
  // The menu is rebuilt in the app language whenever it changes. The shell
  // dispatches `pb-menu-*` DOM CustomEvents via eval (ADR-0003) — Tauri
  // event `listen()` can silently lose the race against page load on
  // WebKitGTK, leaving every menu command dead.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const on = (name: string, fn: () => void) => {
      const h = () => fn();
      window.addEventListener(`pb-menu-${name}`, h);
      return () => window.removeEventListener(`pb-menu-${name}`, h);
    };
    const unbinds = [
      on('import', () => importInputRef.current?.click()),
      on('save', () => saveSession()),
      on('clear', () => clearAll()),
      on('check-update', () => void checkForUpdates()),
    ];
    return () => unbinds.forEach((u) => u());
  }, [saveSession, clearAll, flash, tr, checkForUpdates]);

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

  // Keep the native menu's language in sync with the in-app preference.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_menu_language', { lang }))
      .catch(() => undefined);
  }, [lang]);

  const hasRobots = robots.length > 0;
  const hasExample = robots.some(isExampleRobot);
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
      const { createWelcomeExample } = await import('./welcome-example');
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
      setSelectedId(example.robots[0]?.trajectory.id ?? null);
      setInspectorMode('checks');
      setView3D(false);
      setErrors([]);
      setT(0);
      setComposerOpen(false);
    } catch {
      if (request === exampleRequest.current) flash(tr('welcome.exampleFailed'), 'error');
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
  };
  const jumpToIssue = (time: number, robotIds: string[] = []) => {
    dismissCheckTip();
    playback.setPlaying(false);
    setT(time);
    if (robotIds[0]) {
      setSelectedId(robotIds[0]);
    }
    // Checks run on the visible set only, so a located problem always
    // belongs to a robot that is already on the field.
  };
  return (
    <div className={`app${hasRobots ? '' : ' is-welcome'}`}>
      <header className="toolbar workspace-toolbar" data-tauri-drag-region="deep" aria-label="primary">
        {hasRobots && <button className="btn accent import-action" onClick={openImport}><Icon name="import" />{tr('robots.import')}</button>}
        <input ref={importInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }} />
        {!VIEWER_ONLY && (
          <>
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
          </>
        )}
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
        {!VIEWER_ONLY && hasRobots && <button className="tool-btn save-action" onClick={saveSession} title={tr('actions.saveHint')}>{tr('actions.save')}</button>}
        {hasRobots && <details ref={workspaceMenuRef} className="workspace-menu">
          <summary className="tool-btn square" aria-label={tr('workspace.more')} title={tr('workspace.more')}><Icon name="more" /></summary>
          <div className="workspace-menu-items" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            {hasRobots && !view3D && <button onClick={() => setShowHeatmap((v) => !v)} aria-pressed={showHeatmap}>{tr(showHeatmap ? 'actions.heatmapOff' : 'actions.heatmapOn')}</button>}
            {hasRobots && <button onClick={abToggle}>{tr('actions.abCompare')}</button>}
            {VIEWER_ONLY && <a href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview} target="_blank" rel="noopener noreferrer">{tr(SITE_PREVIEW ? 'site.backStable' : 'site.tryPreview')}</a>}
          </div>
        </details>}
        <button className="tool-btn square" aria-label={tr('prefs.title')} title={tr('prefs.title')} onClick={openPreferences}><Icon name="settings" /></button>
      </header>
      {VIEWER_ONLY && SITE_PREVIEW && <div className="site-preview-banner" role="contentinfo"><span>{tr('site.previewNote')}</span><a href={SITE_URLS.stable}>{tr('site.backStable')}</a></div>}
      <div className="app-col">
        <ImportBanner errors={errors} onDismiss={() => setErrors([])} />
        <main className={`app-body workspace-body ${leftOpen ? 'with-paths' : ''} ${rightOpen ? 'with-inspector' : ''}`}>
          {leftOpen && <RobotList robots={robots} conflicts={conflicts} selectedId={selectedRobot?.trajectory.id ?? null} onSelect={selectRobot} onImport={openImport} onUpdate={updateRobot} onArrange={(id) => { selectRobot(id); playback.setPlaying(false); setComposerOpen(true); }} onSelectSettings={(id, file) => { void applySettingsFile(id, file); }} onRemoveFromMenu={removeSlot} onMirror={toggleMirror} onMirrorButtonClick={toggleMirror} mirroredIds={mirroredIds} />}
          <section className="workspace-stage" aria-label={tr('canvas.view')}>
            {hasExample && <div className="example-notice"><strong>{tr('welcome.exampleBadge')}</strong><span>{tr('welcome.exampleNotice')}</span><button className="btn small" onClick={exitExample}>{tr('welcome.exitExample')}</button></div>}
            <div className="canvas-slot">
              {/* The import page stays clean: the field picker, its construction
                  variant and the 2D/3D switch only become useful once there is
                  something on the field, so the bar appears with the robots. */}
              {hasRobots && <div className="canvas-bar workspace-canvas-bar">
                <div className="field-options">
                  <select className="field-select" aria-label={tr('workspace.season')} value={fieldId} onChange={(e) => {
                    if (e.target.value === CUSTOM_FIELD_ID) { setCfOpen(true); return; }
                    setScene({ fieldId: e.target.value });
                    rememberFieldPrefs(e.target.value, fieldVariant, fieldStyle);
                  }}>
                    {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name} {f.year}</option>)}
                    <option value={CUSTOM_FIELD_ID}>{tr('customField.title')}</option>
                  </select>
                  {field.aprilTagsAndyMark && <div className="seg field-variant-toggle" role="group" aria-label={tr('field.variant')}>
                    {(['welded', 'andymark'] as const).map((variant) => <button key={variant} type="button" aria-pressed={fieldVariant === variant} className={fieldVariant === variant ? 'on' : ''} onClick={() => {
                      if (fieldVariant === variant) return;
                      setScene({ fieldVariant: variant });
                      if (fieldId !== CUSTOM_FIELD_ID) rememberFieldPrefs(fieldId, variant, fieldStyle);
                    }}>{variant === 'andymark' ? 'AndyMark' : 'Welded'}</button>)}
                  </div>}
                  {/* 2D-artwork switcher, hidden in 3D: the official field
                      model replaces the artwork plane entirely (the image
                      only feeds the no-model fallback), so both styles
                      render the same scene there (user request 2026-10-02). */}
                  {!view3D && field.imageRendered && <div className="seg field-style-toggle" role="group" aria-label={tr('field.style')}>
                    {(['schematic', 'rendered'] as const).map((style) => <button key={style} type="button" aria-pressed={fieldStyle === style} className={fieldStyle === style ? 'on' : ''} onClick={() => {
                      if (fieldStyle === style) return;
                      setScene({ fieldStyle: style });
                      if (fieldId !== CUSTOM_FIELD_ID) rememberFieldPrefs(fieldId, fieldVariant, style);
                    }}>{tr(`field.style.${style}`)}</button>)}
                  </div>}
                </div>
                <div className="session-alliance" role="group" aria-label={tr('robots.alliance')}>
                  <div className="seg alliance-toggle">
                    {(['blue', 'red'] as const).map((side) => <button key={side} type="button" className={`alliance-${side}${alliance === side ? ' on' : ''}`} aria-pressed={alliance === side} onClick={() => {
                      if (alliance === side) return;
                      playback.setPlaying(false);
                      setScene({ alliance: side });
                    }}>{tr(side === 'blue' ? 'robots.blue' : 'robots.red')}</button>)}
                  </div>
                </div>
                <span className="canvas-spacer" />
                {field3dAvailable && (
                  <div className="seg view-toggle" role="group" aria-label={tr('canvas.view')}>
                    <button aria-pressed={!view3D} className={!view3D ? 'on' : ''} onClick={() => { setView3D(false); rememberView3D(false); }}>2D</button>
                    <button aria-pressed={view3D} className={view3D ? 'on' : ''} onClick={() => { setEver3D(true); setView3D(true); rememberView3D(true); }}>3D</button>
                  </div>
                )}
                {/* The rest of the bar needs a robot to act on, which the gate
                    above now guarantees. */}
                <button className="tool-btn canvas-recenter" aria-label={tr('canvas.fit')} title={tr('canvas.fit')} onClick={() => view3D ? canvas3DRef.current?.resetCam() : canvasRef.current?.fit()}><Icon name="recenter" size={17} /></button>
              </div>}
              {!hasRobots ? <WelcomeScreen onImport={openImport} onImportFolder={VIEWER_ONLY ? undefined : () => folderInputRef.current?.click()} onOpenSession={() => sessionInputRef.current?.click()} onTryExample={() => void tryExample()} exampleLoading={exampleLoading} /> : <>
                {/* Parked 3D: mounted from the first 3D entry onward, hidden
                    (not unmounted) while 2D shows — scene, models and camera
                    survive, so switching back is instant. `active` pauses the
                    render loop while hidden. Seasons without an official
                    model unmount it (field3dAvailable), remounting on return
                    to a modeled season behind the usual loading fallback. */}
                {ever3D && field3dAvailable && <div className="canvas-3d-keep" hidden={!view3D}>
                  <Suspense fallback={<div className="view-loading" role="status">{tr('workspace.loading3d')}</div>}>
                    <FieldCanvas3D active={view3D} showTrail ref={canvas3DRef} variant={fieldVariant} field={field} fieldImageUrl={fieldImageUrl} robots={previewRobots ?? visible} currentT={previewSource ? previewTime : t} />
                  </Suspense>
                </div>}
                {!view3D && <FieldCanvas ref={canvasRef} showTrail showHeatmap={showHeatmap} field={field} fieldImageUrl={fieldImageUrl} robots={previewRobots ?? visible} currentT={previewSource ? previewTime : t} conflicts={previewSource ? [] : conflicts} bounds={previewSource ? [] : bounds} />}
              </>}
            </div>
            {hasRobots && <div className="workspace-status"><span>{tr('workspace.imported', { n: robots.length })}</span><button onClick={() => setInspectorMode('checks')} className={issueCount ? 'status-warning' : ''}><Icon name={issueCount ? 'warning' : 'check'} size={14} />{issueCount ? tr('checks.issues', { n: issueCount }) : tr(robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle')}</button></div>}
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
        {hasRobots && !composerOpen && <footer className="app-footer"><Timeline composeAction={<button className="btn small" onClick={() => { playback.setPlaying(false); setComposerOpen(true); }}>{tr('sequence.arrange')}</button>} robots={robots} conflicts={conflicts} bounds={bounds} autoPeriodS={field.autoPeriodS} duration={duration} visibleDuration={visibleDuration} playback={playback} playbackRange={playbackRange} onPlaybackRangeChange={setPlaybackRange} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} onEditTeam={openSequenceFor} onJump={jumpToIssue} guide={showPlayTip && <UsageTip text={tr('onboarding.play')} onDismiss={dismissPlayTip} />} /></footer>}
        {hasRobots && <SequenceTimelineComposer robots={sourceRobots} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} autoPeriodS={field.autoPeriodS} open={composerOpen} onClose={() => setComposerOpen(false)} onChange={editSequence} onPreviewRoute={setPreviewRouteId} joins={sequenceJoins} playback={playback} onJump={jumpToSeam} />}

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
      </div>
    </div>
  );
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

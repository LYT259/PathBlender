import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionState } from './session-state';
import { robotsForAlliance, restoreSessionAlliance } from './session-alliance';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { PreferencesPanel } from './components/PreferencesPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { UsageTip, useUsageTip } from './components/UsageTip';
import {
  CUSTOM_FIELD_ID,
  detectCollisions,
  detectFieldBounds,
  deserializeSession,
  FIELDS,
  fieldById,
  minimumSeparation,
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
import { displayName, robotFromRoute, type LibraryProfile, type LibraryRoute } from './route-library';
import { loadAutosave, saveAutosave } from './autosave';
import { saveText } from './download';
import { fieldImageFor } from './field-images';
import { FIELD3D_MODELS } from './field3d-models';
import { FieldCanvas, type FieldCanvasHandle } from './components/FieldCanvas';
import type { FieldCanvas3DHandle } from './components/FieldCanvas3D';
const FieldCanvas3D = lazy(() => import('./components/FieldCanvas3D').then((module) => ({ default: module.FieldCanvas3D })));
import { Timeline } from './components/Timeline';
import { RobotList, RobotInspector } from './components/RobotList';
import { ConflictPanel } from './components/ConflictPanel';
import { ImportBanner } from './components/ImportBanner';
import { usePlayback } from './playback';
import { I18nProvider, useI18n } from './i18n';
import { CustomFieldPanel } from './components/CustomFieldPanel';
import { useUpdateChannel, type UpdateChannel } from './update-channel';
import { runUpdateCheck } from './update-check';
import { listenPrefs } from './pref-sync';
import { VIEWER_ONLY, SITE_PREVIEW, SITE_URLS } from './viewer';

const SESSION_EXT = '.ghpb.json';
// Switching a demo robot to a real library route keeps its stable id. That
// robot now belongs to the user and must survive "End example".
const isExampleRobot = (robot: SessionTrajectory) => robot.trajectory.id.startsWith('welcome-example-') && !robot.routeId;
// The project's public home — the repo is private today; the link simply
// starts resolving once it goes public.
const GITHUB_URL = 'https://github.com/LYT259/pathblender';

// The field + variant survive refreshes (a custom field is not persisted —
// its definition lives only in the session payload).
const FIELD_PREF_KEY = 'ghpb.field';
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
const VIEW3D_KEY = 'ghpb.view3d';
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
  const { channel: updateChannel } = useUpdateChannel();
  const [initialFieldPref] = useState(loadFieldPref);
  const { robots: sourceRobots, alliance, setRobots, setScene, fieldId, fieldVariant, fieldStyle, customField, customImageUrl } = useSessionState(initialFieldPref);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'checks' | 'robot'>('checks');
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [view3D, setView3D] = useState(loadView3D);
  const [showTrail, setShowTrail] = useState(true);
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

  const duration = sessionDuration(robots);
  const playback = usePlayback(duration);
  const { t, setT } = playback;
  useEffect(() => {
    if ((playback.playing || t > 0) && showPlayTip) dismissPlayTip();
  }, [playback.playing, t, showPlayTip, dismissPlayTip]);

  const visible = useMemo(() => seasonRobots.filter((r) => r.visible), [seasonRobots]);
  const conflicts = useMemo(
    () => detectCollisions(seasonRobots),
    [seasonRobots],
  );
  const bounds = useMemo(() => detectFieldBounds(seasonRobots, field), [seasonRobots, field]);
  const minSep = useMemo(() => minimumSeparation(seasonRobots), [seasonRobots]);

  // .path texts stay available so later .auto imports can resolve their
  // pathName references (within the same batch or across this session).
  const pathTextsRef = useRef(new Map<string, string>());
  // Route/profile library: everything parsed this session stays pickable
  // next to each robot, so users can compare autos by switching (2026-09-20).
  const [libraryRoutes, setLibraryRoutes] = useState<LibraryRoute[]>([]);
  const [libraryProfiles, setLibraryProfiles] = useState<LibraryProfile[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const importFiles = useCallback(async (files: FileList | File[] | IncomingFile[], opts?: { fromFolder?: boolean }) => {
    exampleRequest.current += 1;
    setExampleLoading(false);
    const nextErrors: { fileName: string; message: string }[] = [];
    const incoming = toIncoming(files);
    // A folder drop/pick is any import that carries paths below its root.
    const fromFolder = opts?.fromFolder ?? incoming.some((f) => f.relPath.includes('/'));
    const knownRouteExt = /\.(traj|ghostauto|path|auto|chor)$/i;
    const batch = new Map<string, string>(pathTextsRef.current);
    for (const { file, relPath } of incoming) {
      if (/\.path$/i.test(file.name)) {
        const stem = relPath.split('/').pop()!.replace(/\.path$/i, '');
        batch.set(stem, await file.text());
      }
    }
    const addedRoutes: LibraryRoute[] = [];
    const addedProfiles: LibraryProfile[] = [];
    for (const { file, relPath } of incoming) {
      const text = await file.text();
      // Session files restore as a whole session rather than one robot.
      if (relPath.endsWith(SESSION_EXT)) {
        try {
          const restored = deserializeSession(text);
          setScene({ ...restoreSessionAlliance(restored), fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
          setSelectedId(restored.robots[0]?.trajectory.id ?? null);
          setInspectorMode('checks');
          playback.setPlaying(false);
          setT(0);
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
        const traj = parsePathFile(text, relPath, (name) => batch.get(name));
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
    pathTextsRef.current = batch;
    // Re-importing the same path refreshes the entry in place (stable id, so
    // robots pointing at it follow the update).
    setLibraryRoutes((prev) => {
      const byRel = new Map(prev.map((r) => [r.relPath, r]));
      for (const r of addedRoutes) {
        const old = byRel.get(r.relPath);
        byRel.set(r.relPath, old ? { ...r, id: old.id } : r);
      }
      return [...byRel.values()];
    });
    setLibraryProfiles((prev) => {
      const byRel = new Map(prev.map((p) => [p.relPath, p]));
      for (const p of addedProfiles) {
        const old = byRel.get(p.relPath);
        byRel.set(p.relPath, old ? { ...p, id: old.id } : p);
      }
      return [...byRel.values()];
    });
    if (addedRoutes.length > 0 || addedProfiles.length > 0) {
      flash(tr('library.imported', { n: addedRoutes.length, m: addedProfiles.length }));
    }
    if (addedRoutes.length > 0) {
      // Ids are decided up front so selection can target the first new
      // robot without depending on when the state update flushes.
      const ids = addedRoutes.map(() => crypto.randomUUID());
      const willSeed = fromFolder && robots.length === 0;
      setRobots((prev) =>
        fromFolder
          ? prev.length > 0
            ? prev
            : [robotFromRoute(addedRoutes[0]!, 0, ids[0]!)]
          : [
              ...prev,
              ...addedRoutes.map((route, i) => robotFromRoute(route, prev.length + i, ids[i]!)),
            ],
      );
      if (!fromFolder || willSeed) {
        setSelectedId(ids[0]!);
        setInspectorMode('checks');
      }
    }
    setErrors(nextErrors);
  }, [tr, flash, robots.length, setRobots, setScene, setT, playback.setPlaying]);

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

  /** Switch one robot onto another library route (the comparison loop). */
  const pickRoute = useCallback((robotId: string, routeId: string) => {
    const route = libraryRoutes.find((r) => r.id === routeId);
    if (!route) return;
    setRobots((prev) =>
      prev.map((r) => {
        if (r.trajectory.id !== robotId) return r;
        // The shared alliance view is derived after picking the source route.
        const traj = route.trajectory;
        return {
          ...r,
          trajectory: { ...traj, id: r.trajectory.id, name: displayName(traj) },
          routeId: route.id,
        };
      }),
    );
  }, [libraryRoutes, setRobots]);

  const addRouteAsRobot = useCallback((routeId: string) => {
    const route = libraryRoutes.find((r) => r.id === routeId);
    if (!route) return;
    // Decide the id before dispatching so selection can target it directly.
    const id = crypto.randomUUID();
    setRobots((prev) => [...prev, robotFromRoute(route, prev.length, id)]);
    setSelectedId(id);
    setInspectorMode('robot');
  }, [libraryRoutes, setRobots]);

  /** Apply an imported profile's bumper box to one robot. */
  const applyProfile = useCallback((robotId: string, profileId: string) => {
    const entry = libraryProfiles.find((p) => p.id === profileId);
    if (!entry) return;
    setRobots((prev) =>
      prev.map((r) =>
        r.trajectory.id === robotId
          ? {
              ...r,
              trajectory: {
                ...r.trajectory,
                geometry: entry.profile.geometry,
                moduleLocations: entry.profile.moduleLocations,
                geometrySource: 'file',
              },
            }
          : r,
      ),
    );
  }, [libraryProfiles, setRobots]);

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
    setRobots((prev) => prev.map((r) => (r.trajectory.id === id ? { ...r, ...patch } : r)));
  }, []);

  const selectRobot = useCallback((id: string) => {
    setSelectedId(id);
    setInspectorMode('robot');
  }, []);
  const selectedRobot = robots.find((r) => r.trajectory.id === selectedId) ?? robots[0];





  const removeRobot = useCallback((id: string) => {
    setRobots((prev) => prev.filter((r) => r.trajectory.id !== id));
  }, []);

  const saveSession = useCallback(() => {
    const text = serializeSession(
      robots,
      fieldId,
      fieldId === CUSTOM_FIELD_ID ? field : undefined,
    );
    void saveText(
      `session-${new Date().toISOString().slice(0, 10)}${SESSION_EXT}`,
      'json',
      text,
    );
  }, [robots, fieldId, field]);

  // Launch continuity (user report 2026-10-02: quitting in 3D reopened to
  // the welcome page — the 3D pref was honored but only after a fresh
  // import). Restore the autosaved session once on mount; a desktop
  // open-with file that arrives later simply replaces whatever this restored.
  useEffect(() => {
    const restored = loadAutosave();
    if (restored) {
      setScene({ ...restoreSessionAlliance(restored), fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
      setSelectedId(restored.robots[0]?.trajectory.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Keep the autosave current (debounced; removing the last robot clears
  // the slot so the next launch opens on the welcome page again).
  useEffect(() => {
    const id = setTimeout(
      () => saveAutosave(robots, fieldId, fieldId === CUSTOM_FIELD_ID ? field : undefined),
      600,
    );
    return () => clearTimeout(id);
  }, [robots, fieldId, field]);

  const exportPng = useCallback(() => {
    if (view3D) {
      flash(tr('toast.pngOnly2d'));
      return;
    }
    canvasRef.current?.exportPng((ok) => flash(tr(ok ? 'toast.pngSaved' : 'toast.pngFailed'), ok ? 'ok' : 'error'));
  }, [view3D, flash, tr]);

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
    setErrors([]);
    setT(0);
    playback.setPlaying(false);
    setSelectedId(null);
  }, [setT, setRobots, playback.setPlaying]);
  // Desktop: native menu commands and visible buttons share the same handlers.
  // The menu is rebuilt in the app language whenever it changes. The shell
  // dispatches `ghpb-menu-*` DOM CustomEvents via eval (ADR-0003) — Tauri
  // event `listen()` can silently lose the race against page load on
  // WebKitGTK, leaving every menu command dead.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const on = (name: string, fn: () => void) => {
      const h = () => fn();
      window.addEventListener(`ghpb-menu-${name}`, h);
      return () => window.removeEventListener(`ghpb-menu-${name}`, h);
    };
    const unbinds = [
      on('import', () => importInputRef.current?.click()),
      on('save', () => saveSession()),
      on('png', () => exportPng()),
      on('clear', () => clearAll()),
      on('check-update', () => void checkForUpdates()),
    ];
    return () => unbinds.forEach((u) => u());
  }, [saveSession, exportPng, clearAll, flash, tr, checkForUpdates]);

  // Desktop open-with: the shell evals a `ghpb-open-files` CustomEvent with
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
      delete (window as { __ghpbOpenPayload?: unknown }).__ghpbOpenPayload;
      deliver((e as CustomEvent).detail);
    };
    window.addEventListener('ghpb-open-files', onOpen);
    // The shell may have delivered before React mounted — consume the stash.
    const w = window as { __ghpbOpenPayload?: unknown };
    if (w.__ghpbOpenPayload) {
      const stash = w.__ghpbOpenPayload;
      delete w.__ghpbOpenPayload;
      deliver(stash);
    }
    return () => window.removeEventListener('ghpb-open-files', onOpen);
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
  const leftOpen = hasRobots;
  const issueCount = conflicts.length + bounds.length;
  const rightOpen = hasRobots;
  const openImport = () => importInputRef.current?.click();
  const tryExample = async () => {
    const request = ++exampleRequest.current;
    setExampleLoading(true);
    try {
      const { createWelcomeExample } = await import('./welcome-example');
      if (request !== exampleRequest.current) return;
      const example = createWelcomeExample({ a: '00001', b: '00002' });
      // Show it on the field the user actually uses — first visit defaults
      // to AndyMark, afterwards the remembered season + construction.
      setScene({
        robots: example.robots,
        fieldId: initialFieldPref.id,
        fieldVariant: initialFieldPref.variant,
        fieldStyle: initialFieldPref.style,
        customField: undefined,
        customImageUrl: undefined,
      });
      setSelectedId(example.robots[0]?.trajectory.id ?? null);
      setInspectorMode('checks');
      setView3D(false);
      setShowTrail(true);
      setErrors([]);
      playback.setPlaying(false);
      setT(0);
    } catch {
      if (request === exampleRequest.current) flash(tr('welcome.exampleFailed'), 'error');
    } finally {
      if (request === exampleRequest.current) setExampleLoading(false);
    }
  };
  const exitExample = () => {
    // Keep any real paths the user added while exploring the example.
    const remaining = sourceRobots.filter((robot) => !isExampleRobot(robot));
    // Folder imports build a library without adding robots while the demo is
    // on the field. Exiting must still expose that newly imported library.
    if (!remaining.length && libraryRoutes.length) remaining.push(robotFromRoute(libraryRoutes[0]!, 0, crypto.randomUUID()));
    setRobots(remaining);
    setSelectedId(remaining[0]?.trajectory.id ?? null);
    playback.setPlaying(false);
    setT(0);
  };
  const jumpToIssue = (time: number, robotIds: string[] = []) => {
    dismissCheckTip();
    playback.setPlaying(false);
    setT(time);
    if (robotIds[0]) {
      setSelectedId(robotIds[0]);
    }
    // A located problem must be visible even if its paths were hidden.
    if (robotIds.some((id) => robots.some((r) => r.trajectory.id === id && !r.visible)))
      setRobots((previous) => previous.map((r) => robotIds.includes(r.trajectory.id) ? { ...r, visible: true } : r));
  };
  return (
    <div className={`app${hasRobots ? '' : ' is-welcome'}`}>
      <header className="toolbar workspace-toolbar" data-tauri-drag-region="deep" aria-label="primary">
        {hasRobots && <button className="btn accent import-action" onClick={openImport}><Icon name="import" />{tr('robots.import')}</button>}
        <input ref={importInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }} />
        {!VIEWER_ONLY && (
          <>
            {hasRobots && <button className="btn import-folder-action" onClick={() => folderInputRef.current?.click()} title={tr('library.importFolderHint')}><Icon name="folder" />{tr('library.importFolder')}</button>}
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
        <input ref={sessionInputRef} type="file" accept=".ghpb.json" hidden aria-label={tr('welcome.openSession')} onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          if (!file.name.endsWith(SESSION_EXT)) { setErrors([{ fileName: file.name, message: tr('import.notSession') }]); return; }
          void importFiles([file]);
        }} />
        <span className="toolbar-spacer" data-tauri-drag-region="" />
        {!VIEWER_ONLY && hasRobots && <button className="tool-btn save-action" onClick={saveSession} title={tr('actions.saveHint')}>{tr('actions.save')}</button>}
        {hasRobots && <details className="workspace-menu">
          <summary className="tool-btn square" aria-label={tr('workspace.more')} title={tr('workspace.more')}><Icon name="more" /></summary>
          <div className="workspace-menu-items" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            {!VIEWER_ONLY && <button className="menu-save-action" disabled={!hasRobots} onClick={saveSession}>{tr('actions.save')}</button>}
            {!VIEWER_ONLY && <button disabled={!hasRobots || view3D} onClick={exportPng} title={view3D ? tr('toast.pngOnly2d') : undefined}>{tr('actions.png')}</button>}
            <button disabled={!hasRobots} onClick={clearAll}>{tr('actions.clear')}</button>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            {VIEWER_ONLY && <a href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview} target="_blank" rel="noopener noreferrer">{tr(SITE_PREVIEW ? 'site.backStable' : 'site.tryPreview')}</a>}
          </div>
        </details>}
        <button className="tool-btn square" aria-label={tr('prefs.title')} title={tr('prefs.title')} onClick={openPreferences}><Icon name="settings" /></button>
      </header>
      {VIEWER_ONLY && SITE_PREVIEW && <div className="site-preview-banner" role="contentinfo"><span>{tr('site.previewNote')}</span><a href={SITE_URLS.stable}>{tr('site.backStable')}</a></div>}
      <div className="app-col">
        <ImportBanner errors={errors} onDismiss={() => setErrors([])} />
        <main className={`app-body workspace-body ${leftOpen ? 'with-paths' : ''} ${rightOpen ? 'with-inspector' : ''}`}>
          {leftOpen && <RobotList robots={robots} conflicts={conflicts} selectedId={selectedRobot?.trajectory.id ?? null} onSelect={selectRobot} onImport={openImport} onUpdate={updateRobot} libraryRoutes={libraryRoutes} libraryProfiles={libraryProfiles} onPickRoute={pickRoute} onAddRoute={addRouteAsRobot} />}
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
                    <button aria-pressed={view3D} className={view3D ? 'on' : ''} onClick={() => { setView3D(true); rememberView3D(true); }}>3D</button>
                  </div>
                )}
                {/* The rest of the bar needs a robot to act on, which the gate
                    above now guarantees. */}
                <button className="tool-btn square" aria-label={tr('canvas.fit')} title={tr('canvas.fit')} onClick={() => view3D ? canvas3DRef.current?.resetCam() : canvasRef.current?.fit()}><Icon name="fit" /></button>
                <label className="switch trails-control"><input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /><span className="sw-track" aria-hidden="true" /><span className="sw-text">{tr('canvas.trails')}</span></label>
              </div>}
              {!hasRobots ? <WelcomeScreen onImport={openImport} onImportFolder={VIEWER_ONLY ? undefined : () => folderInputRef.current?.click()} onOpenSession={() => sessionInputRef.current?.click()} onTryExample={() => void tryExample()} exampleLoading={exampleLoading} /> : view3D ? <Suspense fallback={<div className="view-loading" role="status">{tr('workspace.loading3d')}</div>}><FieldCanvas3D showTrail={showTrail} ref={canvas3DRef} variant={fieldVariant} field={field} fieldImageUrl={fieldImageUrl} robots={visible} currentT={t} /></Suspense> :
                <FieldCanvas ref={canvasRef} showTrail={showTrail} field={field} fieldImageUrl={fieldImageUrl} robots={visible} currentT={t} conflicts={conflicts} bounds={bounds} />}
            </div>
            {hasRobots && <div className="workspace-status"><span>{tr('workspace.imported', { n: robots.length })}</span><button onClick={() => { setInspectorMode('checks'); }} className={issueCount ? 'status-warning' : ''}><Icon name={issueCount ? 'warning' : 'check'} size={14} />{issueCount ? tr('checks.issues', { n: issueCount }) : tr(robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle')}</button></div>}
            {hasRobots && <footer className="app-footer"><Timeline robots={robots} conflicts={conflicts} bounds={bounds} autoPeriodS={field.autoPeriodS} duration={duration} playback={playback} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} onJump={jumpToIssue} guide={showPlayTip && <UsageTip text={tr('onboarding.play')} onDismiss={dismissPlayTip} />} /></footer>}
          </section>
          <aside className="workspace-inspector" hidden={!rightOpen}>
            <div className="inspector-header"><div className="seg inspector-tabs" role="group" aria-label={tr('workspace.panels')}>
              <button className={inspectorMode === 'checks' ? 'on' : ''} aria-pressed={inspectorMode === 'checks'} onClick={() => setInspectorMode('checks')}>{tr('workspace.checks')}{issueCount > 0 && <span className="tab-count">{issueCount}</span>}</button>
              <button className={inspectorMode === 'robot' ? 'on' : ''} aria-pressed={inspectorMode === 'robot'} onClick={() => setInspectorMode('robot')}>{tr('workspace.details')}</button>
            </div></div>
            {inspectorMode === 'checks' && <ConflictPanel robots={robots} conflicts={conflicts} bounds={bounds} minSeparation={minSep} onJump={jumpToIssue} guide={issueCount > 0 && showCheckTip && <UsageTip text={tr('onboarding.check')} onDismiss={dismissCheckTip} />} />}
            {inspectorMode === 'robot' && <div className="inspector-scroll"><RobotInspector robot={selectedRobot} onRemove={removeRobot} libraryProfiles={libraryProfiles} onApplyProfile={applyProfile} /></div>}
          </aside>
        </main>

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
        <PreferencesPanel desktop={IS_DESKTOP} onClose={() => setShowPrefs(false)} />
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

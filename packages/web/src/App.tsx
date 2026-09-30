import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionHistory } from './session-history';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import {
  applyAllianceChange,
  autoResolveConflicts,
  CUSTOM_FIELD_ID,
  addChoreoWaypoint,
  addPpWaypoint,
  adjustedName,
  detectCollisions,
  detectFieldBounds,
  deserializeSession,
  exportGhostAuto,
  exportPathPlannerPath,
  exportTraj,
  FIELDS,
  fieldById,
  minimumSeparation,
  moveChoreoWaypoint,
  movePpWaypoint,
  parsePathFile,
  parseRobotProfile,
  ParseError,
  REBUILT_2026,
  reparameterize,
  resetToOriginal,
  removeChoreoWaypoint,
  removePpWaypoint,
  serializeSession,
  sessionDuration,
} from '@pathblender/core';
import type { FieldPackage, RobotGeometry, RobotProfile, SessionTrajectory } from '@pathblender/core';
import { filesFromDataTransfer, toIncoming, type IncomingFile } from './dropped-files';
import { displayName, robotFromRoute, type LibraryProfile, type LibraryRoute } from './route-library';
import { hashToSession, sessionToHash } from './share-url';
import { copyText, saveText } from './download';
import { useTheme, type ThemeMode } from './theme';
import field2018 from '../../../assets/fields/powerup2018.png';
import field2019 from '../../../assets/fields/deepspace2019.png';
import field2020 from '../../../assets/fields/infinitercharge2020.png';
import field2022 from '../../../assets/fields/rapidreact2022.png';
import field2023 from '../../../assets/fields/chargedup2023.png';
import field2024 from '../../../assets/fields/crescendo2024.png';
import field2025 from '../../../assets/fields/reefscape2025.png';
import field2026 from '../../../assets/fields/rebuilt2026.png';

const FIELD_IMAGES: Record<string, string> = {
  'powerup-2018': field2018,
  'deepspace-2019': field2019,
  'infinitercharge-2020': field2020,
  'rapidreact-2022': field2022,
  'chargedup-2023': field2023,
  'crescendo-2024': field2024,
  'reefscape-2025': field2025,
  'rebuilt-2026': field2026,
};
import { FieldCanvas, type FieldCanvasHandle } from './components/FieldCanvas';
import type { FieldCanvas3DHandle } from './components/FieldCanvas3D';
const FieldCanvas3D = lazy(() => import('./components/FieldCanvas3D').then((module) => ({ default: module.FieldCanvas3D })));
import { Timeline } from './components/Timeline';
import { RobotList, RobotInspector } from './components/RobotList';
import { ConflictPanel } from './components/ConflictPanel';
import { ImportBanner } from './components/ImportBanner';
import { usePlayback } from './playback';
import { I18nProvider, LANGUAGES, langLabel, useI18n, type LangChoice } from './i18n';
import { CustomFieldPanel } from './components/CustomFieldPanel';
import { AiPanel, SparkleIcon } from './components/AiPanel';
import { AiSettingsSection } from './components/AiSettingsSection';
import { WaypointPanel } from './components/WaypointPanel';
import { UpdateChannelProvider, useUpdateChannel, type UpdateChannel } from './update-channel';
import { runUpdateCheck } from './update-check';
import { listenPrefs } from './pref-sync';
import { VIEWER_ONLY, SITE_PREVIEW, SITE_URLS } from './viewer';
import type { ActionContext } from './ai/actions';
import { loadAISettings, saveAISettings, type AISettings } from './ai/settings';
import { AI_ENABLED } from './ai/availability';

const SESSION_EXT = '.ghpb.json';
// The project's public home — the repo is private today; the link simply
// starts resolving once it goes public.
const GITHUB_URL = 'https://github.com/LYT259/pathblender';

// The field + variant survive refreshes (a custom field is not persisted —
// its definition lives only in the session/share payload).
const FIELD_PREF_KEY = 'ghpb.field';
type FieldPref = { id: string; variant: 'welded' | 'andymark' };
function loadFieldPref(): FieldPref {
  const fallback: FieldPref = { id: REBUILT_2026.id, variant: 'andymark' };
  try {
    const raw = localStorage.getItem(FIELD_PREF_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<FieldPref>;
    const f = p.id ? fieldById(p.id) : undefined;
    if (!f) return fallback;
    return {
      id: f.id,
      variant: p.variant === 'andymark' && f.aprilTagsAndyMark ? 'andymark' : 'welded',
    };
  } catch {
    return fallback;
  }
}
function rememberFieldPrefs(id: string, variant: 'welded' | 'andymark') {
  if (id === CUSTOM_FIELD_ID) return;
  try {
    localStorage.setItem(FIELD_PREF_KEY, JSON.stringify({ id, variant }));
  } catch {
    /* private browsing — stickiness is best-effort */
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
  const { lang, langChoice, setLang, t: tr } = useI18n();
  const { channel: updateChannel, setChannel: setUpdateChannel } = useUpdateChannel();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [initialFieldPref] = useState(loadFieldPref);
  const { robots, setRobots, setScene, fieldId, fieldVariant, customField, customImageUrl, undo, redo, beginEdit, endEdit, canUndo, canRedo } = useSessionHistory(initialFieldPref);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathsOpen, setPathsOpen] = useState(() => window.innerWidth > 640);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorMode, setInspectorMode] = useState<'checks' | 'robot' | 'ai'>('checks');
  const [aiMounted, setAiMounted] = useState(false);
  useEffect(() => { if (inspectorMode === 'ai') setAiMounted(true); }, [inspectorMode]);
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings());
  const [view3D, setView3D] = useState(false);
  const [showTrail, setShowTrail] = useState(true);
  const [showPrefs, setShowPrefs] = useState(false);
  // Language and theme are staged: picking one enables Save instead of applying
  // instantly (the other preferences keep their immediate-apply behavior).
  // `null` means "nothing staged", which is also the rule the dialog's Save
  // button uses — see the prefs-row btns block.
  const [pendingLang, setPendingLang] = useState<LangChoice | null>(null);
  const [pendingTheme, setPendingTheme] = useState<ThemeMode | null>(null);
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(null);
  const closePrefs = useCallback(() => {
    setShowPrefs(false);
    setPendingLang(null);
    setPendingTheme(null);
    setPendingChannel(null);
  }, []);
  const [cfOpen, setCfOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);
  const flash = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2500);
  }, []);
  const importInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<FieldCanvasHandle>(null);
  const canvas3DRef = useRef<FieldCanvas3DHandle>(null);
  const baseField = fieldId === CUSTOM_FIELD_ID && customField ? customField : fieldById(fieldId);
  // The 2D overlay / beacons follow the selected field construction.
  const field = useMemo(() =>
    fieldVariant === 'andymark' && baseField?.aprilTagsAndyMark
      ? { ...baseField, aprilTags: baseField.aprilTagsAndyMark }
      : baseField, [baseField, fieldVariant]);
  // Field/variant memory is written ONLY from the user's own selects —
  // share-link and session-file restores must not overwrite it.

  const duration = sessionDuration(robots);
  const playback = usePlayback(duration);
  const { t, setT } = playback;
  const undoSession = useCallback(() => { playback.setPlaying(false); undo(); }, [playback.setPlaying, undo]);
  const redoSession = useCallback(() => { playback.setPlaying(false); redo(); }, [playback.setPlaying, redo]);

  const visible = useMemo(() => robots.filter((r) => r.visible), [robots]);
  const conflicts = useMemo(
    () => detectCollisions(robots),
    [robots],
  );
  const bounds = useMemo(() => detectFieldBounds(robots, field), [robots, field]);
  const minSep = useMemo(() => minimumSeparation(robots), [robots]);

  // .path texts stay available so later .auto imports can resolve their
  // pathName references (within the same batch or across this session).
  const pathTextsRef = useRef(new Map<string, string>());
  // Route/profile library: everything parsed this session stays pickable
  // next to each robot, so users can compare autos by switching (2026-09-20).
  const [libraryRoutes, setLibraryRoutes] = useState<LibraryRoute[]>([]);
  const [libraryProfiles, setLibraryProfiles] = useState<LibraryProfile[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const importFiles = useCallback(async (files: FileList | File[] | IncomingFile[], opts?: { fromFolder?: boolean }) => {
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
          setScene({ robots: restored.robots, fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
          setSelectedId(restored.robots[0]?.trajectory.id ?? null);
          setInspectorMode('checks');
          setInspectorOpen(window.innerWidth > 900);
          if (window.innerWidth <= 640) setPathsOpen(false);
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
        setInspectorOpen(window.innerWidth > 900);
        if (window.innerWidth <= 640) setPathsOpen(false);
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
    // An in-progress waypoint edit belongs to the previous route; leave edit
    // mode rather than half-apply it to the new one.
    setEditingId((cur) => (cur === robotId ? null : cur));
    setRobots((prev) =>
      prev.map((r) => {
        if (r.trajectory.id !== robotId) return r;
        let traj = route.trajectory;
        // Alliance is the robot's (user-chosen) property — bring the route
        // into it rather than letting the file's origin flip the robot.
        if (traj.alliance !== r.trajectory.alliance) traj = applyAllianceChange(traj, r.trajectory.alliance, field);
        return {
          ...r,
          trajectory: { ...traj, id: r.trajectory.id, name: displayName(traj) },
          routeId: route.id,
        };
      }),
    );
  }, [libraryRoutes, field, setRobots]);

  const addRouteAsRobot = useCallback((routeId: string) => {
    const route = libraryRoutes.find((r) => r.id === routeId);
    if (!route) return;
    // Decide the id before dispatching so selection can target it directly.
    const id = crypto.randomUUID();
    setRobots((prev) => [...prev, robotFromRoute(route, prev.length, id)]);
    setSelectedId(id);
    setInspectorMode('robot');
    setInspectorOpen(true);
    if (window.innerWidth <= 640) setPathsOpen(false);
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

  const setTeamNumber = useCallback((id: string, teamNumber: string) => {
    setRobots((prev) =>
      prev.map((r) =>
        r.trajectory.id === id
          ? { ...r, trajectory: { ...r.trajectory, teamNumber } }
          : r,
      ),
    );
  }, []);

  // --- meditation editing (report v1.4 §6.3) ---
  const [editingId, setEditingId] = useState<string | null>(null);

  const selectRobot = useCallback((id: string) => {
    setSelectedId(id);
    setInspectorMode('robot');
    setInspectorOpen(true);
    if (window.innerWidth <= 640) setPathsOpen(false);
    setEditingId((current) => current === id ? current : null);
  }, []);
  const toggleEdit = useCallback((id: string) => {
    setEditingId((cur) => (cur === id ? null : id));
    setSelectedId(id);
    setInspectorMode('robot');
    setInspectorOpen(true);
    setView3D(false);
    setShowTrail(true);
    playback.setPlaying(false);
    setRobots((previous) => previous.map((r) => r.trajectory.id === id && !r.visible ? { ...r, visible: true } : r));
  }, [playback.setPlaying, setRobots]);

  const editWaypoint = useCallback(
    (
      id: string,
      idx: number,
      pos: { x: number; y: number },
      kind: 'anchor' | 'prevControl' | 'nextControl',
    ) => {
      setRobots((prev) =>
        prev.map((r) => {
          if (r.trajectory.id !== id) return r;
          const tr = r.trajectory;
          if (tr.editable?.kind === 'pathplanner') {
            const part =
              kind === 'anchor'
                ? { anchor: pos }
                : kind === 'prevControl'
                  ? { prevControl: pos }
                  : { nextControl: pos };
            return { ...r, trajectory: reparameterize(movePpWaypoint(tr, idx, part)) };
          }
          if (tr.editable?.kind === 'choreo' && kind === 'anchor') {
            return { ...r, trajectory: reparameterize(moveChoreoWaypoint(tr, idx, pos)) };
          }
          return r;
        }),
      );
    },
    [],
  );

  const addWaypoint = useCallback((id: string, afterIdx: number) => {
    setRobots((prev) =>
      prev.map((r) => {
        if (r.trajectory.id !== id) return r;
        const tr = r.trajectory;
        if (tr.editable?.kind === 'pathplanner')
          return { ...r, trajectory: reparameterize(addPpWaypoint(tr, afterIdx)) };
        if (tr.editable?.kind === 'choreo')
          return { ...r, trajectory: reparameterize(addChoreoWaypoint(tr, afterIdx)) };
        return r;
      }),
    );
  }, []);

  const removeWaypoint = useCallback((id: string, idx: number) => {
    setRobots((prev) =>
      prev.map((r) => {
        if (r.trajectory.id !== id) return r;
        const tr = r.trajectory;
        if (tr.editable?.kind === 'pathplanner')
          return { ...r, trajectory: reparameterize(removePpWaypoint(tr, idx)) };
        if (tr.editable?.kind === 'choreo')
          return { ...r, trajectory: reparameterize(removeChoreoWaypoint(tr, idx)) };
        return r;
      }),
    );
  }, []);

  const resetEdit = useCallback((id: string) => {
    setRobots((prev) =>
      prev.map((r) => (r.trajectory.id === id ? { ...r, trajectory: resetToOriginal(r.trajectory) } : r)),
    );
  }, []);

  const exportRobot = useCallback(
    (id: string, format: 'path' | 'traj' | 'ghostauto') => {
      const r = robots.find((x) => x.trajectory.id === id);
      if (!r) return;
      let text: string;
      let ext: string;
      try {
        if (format === 'path') {
          text = exportPathPlannerPath(r.trajectory);
          ext = 'path';
        } else if (format === 'traj') {
          text = exportTraj(r.trajectory);
          ext = 'traj';
        } else {
          text = exportGhostAuto(r.trajectory);
          ext = 'ghostauto';
        }
      } catch (e) {
        setErrors([{ fileName: r.trajectory.name, message: e instanceof Error ? e.message : String(e) }]);
        return;
      }
      void saveText(`${adjustedName(r.trajectory.name)}.${ext}`, ext, text);
    },
    [robots],
  );

  const editRobot = useMemo(
    () => robots.find((r) => r.trajectory.id === editingId) ?? null,
    [robots, editingId],
  );
  const selectedRobot = robots.find((r) => r.trajectory.id === selectedId) ?? robots[0];
  useEffect(() => {
    if (editingId && !robots.some((r) => r.trajectory.id === editingId)) setEditingId(null);
  }, [robots, editingId]);





  const setAlliance = useCallback(
    (id: string, alliance: 'blue' | 'red') => {
      setRobots((prev) =>
        prev.map((r) =>
          r.trajectory.id === id
            ? {
                ...r,
                trajectory: applyAllianceChange(r.trajectory, alliance, field),
              }
            : r,
        ),
      );
    },
    [field],
  );

  const setGeometry = useCallback(
    (id: string, patch: Partial<RobotGeometry>) => {
      setRobots((prev) =>
        prev.map((r) =>
          r.trajectory.id === id && r.trajectory.geometrySource !== 'file'
            ? {
                ...r,
                trajectory: {
                  ...r.trajectory,
                  geometry: { ...r.trajectory.geometry, ...patch },
                },
              }
            : r,
        ),
      );
    },
    [],
  );

  const removeRobot = useCallback((id: string) => {
    setRobots((prev) => prev.filter((r) => r.trajectory.id !== id));
  }, []);

  // --- AI assistant plumbing (report v1.4 §6.4) ---
  const setStartDelay = useCallback((id: string, seconds: number) => {
    updateRobot(id, { startDelayS: Math.max(0, seconds) });
  }, [updateRobot]);

  const buildActionContext = useCallback((): ActionContext => {
    return {
      robots,
      conflicts,
      setStartDelay,
      setAlliance,
      setTeamNumber,
      editWaypoint,
      addWaypoint,
      removeWaypoint,
      removeRobot,
      exportRobot,
      // Every mutation is captured by the shared session history.
      pushUndo: () => {},
    };
  }, [robots, conflicts, setStartDelay, setAlliance, setTeamNumber, editWaypoint, addWaypoint, removeWaypoint, removeRobot, exportRobot]);

  const applyAiSettings = useCallback((next: AISettings) => {
    setAiSettings(next);
    saveAISettings(next);
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


  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const element = e.target instanceof Element ? e.target : null;
      if ((!e.metaKey && !e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.altKey || element?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      playback.setPlaying(false);
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undo, redo, playback.setPlaying]);

  const [shareLink, setShareLink] = useState<string | null>(null);
  const shareUrl = useCallback(async () => {
    try {
      const hash = await sessionToHash(
        robots,
        fieldId,
        fieldId === CUSTOM_FIELD_ID ? field : undefined,
      );
      try {
        history.replaceState(null, '', hash);
      } catch {
        // Custom protocols (desktop) may refuse replaceState — the payload
        // itself still goes to the dialog below.
      }
      // Web: full URL; desktop: the #s=… payload itself (recipient pastes it
      // after the web app's address).
      setShareLink(location.protocol.startsWith('http') ? location.href : hash);
    } catch {
      flash(tr('toast.shareFailed'), 'error');
    }
  }, [robots, fieldId, field, flash, tr]);

  // Restore a shared session from the URL hash on first load.
  useEffect(() => {
    if (!location.hash.startsWith('#s=')) return;
    void hashToSession(location.hash).then((restored) => {
      if (restored && restored.robots.length > 0) {
        setScene({ robots: restored.robots, fieldId: restored.fieldId, customField: restored.field, customImageUrl: undefined });
      }
    });
  }, []);

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
    setRobots([]);
    setErrors([]);
    setT(0);
    playback.setPlaying(false);
    setEditingId(null);
    setSelectedId(null);
  }, [setT, setRobots, playback.setPlaying]);
  // Desktop: native menu commands and visible buttons share the same handlers.
  // The menu is rebuilt in the app language whenever it changes.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    let disposed = false;
    const unbinds: (() => void)[] = [];
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (disposed) return;
      void listen('menu-import', () => importInputRef.current?.click()).then((u) => { if (disposed) u(); else unbinds.push(u); });
      void listen('menu-save', () => saveSession()).then((u) => { if (disposed) u(); else unbinds.push(u); });
      void listen('menu-share', () => void shareUrl()).then((u) => { if (disposed) u(); else unbinds.push(u); });
      void listen('menu-png', () => exportPng()).then((u) => { if (disposed) u(); else unbinds.push(u); });
      void listen('menu-clear', () => clearAll()).then((u) => { if (disposed) u(); else unbinds.push(u); });
      void listen('menu-check-update', () => void checkForUpdates()).then((u) => { if (disposed) u(); else unbinds.push(u); });
    });
    return () => {
      disposed = true;
      unbinds.forEach((u) => u());
    };
  }, [saveSession, shareUrl, exportPng, clearAll, flash, tr, checkForUpdates]);

  // Keep the native menu's language in sync with the in-app preference.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_menu_language', { lang }))
      .catch(() => undefined);
  }, [lang]);

  const hasRobots = robots.length > 0;
  const issueCount = conflicts.length + bounds.length;
  const rightOpen = inspectorOpen && (hasRobots || inspectorMode === 'ai');
  const openImport = () => importInputRef.current?.click();
  const jumpToIssue = (time: number, robotIds: string[] = []) => {
    playback.setPlaying(false);
    setT(time);
    if (robotIds[0]) {
      setSelectedId(robotIds[0]);
      setEditingId((current) => current === robotIds[0] ? current : null);
    }
    // A located problem must be visible even if its paths were hidden.
    if (robotIds.some((id) => robots.some((r) => r.trajectory.id === id && !r.visible)))
      setRobots((previous) => previous.map((r) => robotIds.includes(r.trajectory.id) ? { ...r, visible: true } : r));
  };
  const resolveConflicts = () => {
    playback.setPlaying(false);
    const next = autoResolveConflicts(robots.map((r) => ({ ...r, visible: true })))
      .map((r, i) => ({ ...r, visible: robots[i]!.visible }));
    setRobots(next);
    const remaining = detectCollisions(next).length;
    flash(tr(remaining > 0 ? 'conflicts.autoResolvePartial' : 'checks.resolved', { n: remaining }));
  };

  return (
    <div className="app">
      <header className="toolbar workspace-toolbar" data-tauri-drag-region="" aria-label="primary">
        <button className="tool-btn square" aria-label={tr('workspace.togglePaths')} aria-pressed={pathsOpen} onClick={() => { setPathsOpen(!pathsOpen); if (!pathsOpen && window.innerWidth <= 640) setInspectorOpen(false); }}><Icon name="sidebar" /></button>
        <div className="workspace-brand" data-tauri-drag-region="">
          <strong data-tauri-drag-region="">PathBlender</strong>
          <span data-tauri-drag-region="">{tr('workspace.subtitle')}</span>
        </div>
        <span className="toolbar-divider" />
        <button className="btn accent import-action" onClick={openImport}><Icon name="import" />{tr('robots.import')}</button>
        <input ref={importInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) void importFiles(e.target.files); e.target.value = ''; }} />
        {!VIEWER_ONLY && (
          <>
            <button className="btn import-folder-action" onClick={() => folderInputRef.current?.click()} title={tr('library.importFolderHint')}><Icon name="folder" />{tr('library.importFolder')}</button>
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
        <div className="history-controls">
          <button className="tool-btn square" title={tr('workspace.undo')} aria-label={tr('workspace.undo')} disabled={!canUndo} onClick={undoSession}><Icon name="undo" /></button>
          <button className="tool-btn square" title={tr('workspace.redo')} aria-label={tr('workspace.redo')} disabled={!canRedo} onClick={redoSession}><Icon name="redo" /></button>
        </div>
        <span className="toolbar-spacer" data-tauri-drag-region="" />
        {!VIEWER_ONLY && <button className="tool-btn save-action" disabled={!hasRobots} onClick={saveSession} title={tr('actions.saveHint')}>{tr('actions.save')}</button>}
        <button className="tool-btn share-action" disabled={!hasRobots} aria-label={tr('actions.share')} onClick={() => void shareUrl()}><Icon name="share" /><span>{tr('rail.share')}</span></button>
        <details className="workspace-menu">
          <summary className="tool-btn square" aria-label={tr('workspace.more')} title={tr('workspace.more')}><Icon name="more" /></summary>
          <div className="workspace-menu-items" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            {!VIEWER_ONLY && <button className="menu-save-action" disabled={!hasRobots} onClick={saveSession}>{tr('actions.save')}</button>}
            {!VIEWER_ONLY && <button disabled={!hasRobots || view3D} onClick={exportPng} title={view3D ? tr('toast.pngOnly2d') : undefined}>{tr('actions.png')}</button>}
            <button disabled={!hasRobots} onClick={clearAll}>{tr('actions.clear')}</button>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            {VIEWER_ONLY && <a href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview} target="_blank" rel="noopener noreferrer">{tr(SITE_PREVIEW ? 'site.backStable' : 'site.tryPreview')}</a>}
          </div>
        </details>
        {!VIEWER_ONLY && AI_ENABLED && !rightOpen && <button className="tool-btn square" aria-label={tr('ai.title')} title={tr('ai.title')} onClick={() => { setInspectorMode('ai'); setInspectorOpen(true); }}><SparkleIcon /></button>}
        <button className="tool-btn square" aria-label={tr('prefs.title')} title={tr('prefs.title')} onClick={() => setShowPrefs(true)}><Icon name="settings" /></button>
        <button className="tool-btn square" aria-label={tr('workspace.toggleInspector')} aria-pressed={rightOpen} onClick={() => { setInspectorOpen(!inspectorOpen); if (!inspectorOpen && window.innerWidth <= 640) setPathsOpen(false); }} disabled={!hasRobots}><Icon name="inspector" /></button>
      </header>
      {VIEWER_ONLY && SITE_PREVIEW && <div className="site-preview-banner" role="contentinfo"><span>{tr('site.previewNote')}</span><a href={SITE_URLS.stable}>{tr('site.backStable')}</a></div>}
      <div className="app-col">
        <ImportBanner errors={errors} onDismiss={() => setErrors([])} />
        <main className={`app-body workspace-body ${pathsOpen ? 'with-paths' : ''} ${rightOpen ? 'with-inspector' : ''}`}>
          {pathsOpen && <RobotList robots={robots} conflicts={conflicts} selectedId={selectedRobot?.trajectory.id ?? null} onSelect={selectRobot} onImport={openImport} onUpdate={updateRobot} libraryRoutes={libraryRoutes} libraryProfiles={libraryProfiles} onPickRoute={pickRoute} onAddRoute={addRouteAsRobot} />}
          <section className="workspace-stage" aria-label={tr('canvas.view')}>
            <div className="canvas-slot">
              {/* The import page stays clean: the field picker, its construction
                  variant and the 2D/3D switch only become useful once there is
                  something on the field, so the bar appears with the robots. */}
              {hasRobots && <div className="canvas-bar workspace-canvas-bar">
                <div className="field-options">
                  <select className="field-select" aria-label={tr('workspace.season')} value={fieldId} onChange={(e) => {
                    if (e.target.value === CUSTOM_FIELD_ID) { setCfOpen(true); return; }
                    setScene({ fieldId: e.target.value });
                    rememberFieldPrefs(e.target.value, fieldVariant);
                  }}>
                    {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name} {f.year}</option>)}
                    <option value={CUSTOM_FIELD_ID}>{tr('customField.title')}</option>
                  </select>
                  {field.aprilTagsAndyMark && <select className="field-select field-variant" value={fieldVariant} onChange={(e) => {
                    const v = e.target.value as 'welded' | 'andymark'; setScene({ fieldVariant: v });
                    if (fieldId !== CUSTOM_FIELD_ID) rememberFieldPrefs(fieldId, v);
                  }} title={tr('field.variant')} aria-label={tr('field.variant')}><option value="andymark">AndyMark</option><option value="welded">Welded</option></select>}
                </div>
                <span className="canvas-spacer" />
                <div className="seg view-toggle" role="group" aria-label={tr('canvas.view')}>
                  <button aria-pressed={!view3D} className={!view3D ? 'on' : ''} onClick={() => setView3D(false)}>2D</button>
                  <button aria-pressed={view3D} className={view3D ? 'on' : ''} disabled={!!editRobot} title={editRobot ? tr('workspace.edit2d') : undefined} onClick={() => setView3D(true)}>3D</button>
                </div>
                {/* The rest of the bar needs a robot to act on, which the gate
                    above now guarantees. */}
                <button className="tool-btn square" aria-label={tr('canvas.fit')} title={tr('canvas.fit')} onClick={() => view3D ? canvas3DRef.current?.resetCam() : canvasRef.current?.fit()}><Icon name="fit" /></button>
                {!view3D && <label className="switch trails-control"><input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} /><span className="sw-track" aria-hidden="true" /><span className="sw-text">{tr('canvas.trails')}</span></label>}
              </div>}
              {editRobot && <div className="editing-banner"><div><strong>{tr('workspace.editing', { name: editRobot.trajectory.name })}</strong><span>{tr('canvas.editHint')}</span></div><button className="btn" onClick={() => setEditingId(null)}>{tr('robots.doneEdit')}</button></div>}
              {!hasRobots ? <div className="workspace-empty">
                <div className="welcome-mark"><Icon name="path" size={40} /></div>
                <h1>{tr('workspace.emptyTitle')}</h1>
                <p>{tr('workspace.emptyBody')}</p>
                <div className="welcome-actions">
                  <button className="btn accent welcome-import" onClick={openImport}><Icon name="import" />{tr('robots.import')}</button>
                  {!VIEWER_ONLY && <button className="btn welcome-folder-import" onClick={() => folderInputRef.current?.click()}><Icon name="folder" />{tr('library.importFolder')}</button>}
                </div>
                <div className="welcome-steps">{(['workspace.importStep', 'workspace.compareStep', 'workspace.checkStep'] as const).map((key, i) => <span key={key}><b>{i + 1}</b>{tr(key)}</span>)}</div>
              </div> : view3D ? <Suspense fallback={<div className="view-loading" role="status">{tr('workspace.loading3d')}</div>}><FieldCanvas3D ref={canvas3DRef} variant={fieldVariant} field={field} fieldImageUrl={FIELD_IMAGES[field.id] ?? customImageUrl} robots={visible} currentT={t} /></Suspense> :
                <FieldCanvas ref={canvasRef} showTrail={showTrail} field={field} fieldImageUrl={FIELD_IMAGES[field.id] ?? customImageUrl} robots={visible} currentT={t} conflicts={conflicts} bounds={bounds} editRobot={editRobot} onBeginEdit={beginEdit} onEndEdit={endEdit} onEditWaypoint={editWaypoint} onAddWaypoint={addWaypoint} onRemoveWaypoint={removeWaypoint} />}
            </div>
            {hasRobots && <div className="workspace-status"><span>{tr('workspace.imported', { n: robots.length })}</span><button onClick={() => { setInspectorMode('checks'); setInspectorOpen(true); }} className={issueCount ? 'status-warning' : ''}><Icon name={issueCount ? 'warning' : 'check'} size={14} />{issueCount ? tr('checks.issues', { n: issueCount }) : tr(robots.length < 2 ? 'checks.singleTitle' : 'checks.clearTitle')}</button></div>}
            {hasRobots && <footer className="app-footer"><Timeline robots={robots} conflicts={conflicts} bounds={bounds} duration={duration} playback={playback} selectedId={selectedRobot?.trajectory.id} onSelect={selectRobot} onJump={jumpToIssue} /></footer>}
          </section>
          <aside className="workspace-inspector" hidden={!rightOpen}>
            <div className="inspector-header"><div className="seg inspector-tabs" role="group" aria-label={tr('workspace.panels')}>
              <button className={inspectorMode === 'checks' ? 'on' : ''} aria-pressed={inspectorMode === 'checks'} onClick={() => setInspectorMode('checks')}>{tr('workspace.checks')}{issueCount > 0 && <span className="tab-count">{issueCount}</span>}</button>
              <button className={inspectorMode === 'robot' ? 'on' : ''} aria-pressed={inspectorMode === 'robot'} onClick={() => setInspectorMode('robot')}>{tr('workspace.details')}</button>
              {!VIEWER_ONLY && AI_ENABLED && <button className={inspectorMode === 'ai' ? 'on' : ''} aria-label={tr('ai.title')} aria-pressed={inspectorMode === 'ai'} onClick={() => setInspectorMode('ai')}><SparkleIcon />{tr('workspace.assistant')}</button>}
            </div><button className="tool-btn square inspector-close" title={tr('workspace.closePanel')} aria-label={tr('workspace.closePanel')} onClick={() => setInspectorOpen(false)}><Icon name="close" size={14} /></button></div>
            {inspectorMode === 'checks' && <ConflictPanel robots={robots} conflicts={conflicts} bounds={bounds} minSeparation={minSep} onJump={jumpToIssue} onAdjust={selectRobot} onAutoResolve={resolveConflicts} />}
            {inspectorMode === 'robot' && <div className="inspector-scroll"><RobotInspector robot={selectedRobot} editingId={editingId} onUpdate={updateRobot} onSetAlliance={setAlliance} onSetGeometry={setGeometry} onSetTeamNumber={setTeamNumber} onToggleEdit={toggleEdit} onResetEdit={resetEdit} onExport={exportRobot} onRemove={removeRobot} libraryProfiles={libraryProfiles} onApplyProfile={applyProfile} />{editRobot && <WaypointPanel key={editRobot.trajectory.id} robot={editRobot} onEditWaypoint={editWaypoint} onAddWaypoint={addWaypoint} onRemoveWaypoint={removeWaypoint} />}</div>}
            {aiMounted && !VIEWER_ONLY && AI_ENABLED && <div className="inspector-ai" hidden={inspectorMode !== 'ai'}><AiPanel settings={aiSettings} onSettings={applyAiSettings} buildContext={buildActionContext} undoLabel={canUndo ? tr('workspace.undo') : null} onUndo={undoSession} onAttachFiles={(files) => void importFiles(files)} onOpenSettings={() => setShowPrefs(true)} /></div>}
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
      {shareLink != null && (
        <Dialog title={tr('share.title')} onClose={() => setShareLink(null)}>
            <h3>{tr('share.title')}</h3>
            <textarea aria-label={tr('share.title')} className="share-box" readOnly value={shareLink} rows={3} />
            <p className="prefs-note">{tr('share.note')}</p>
            <div className="prefs-row btns">
              <button
                className="btn small"
                onClick={async () => {
                  const ok = await copyText(shareLink);
                  setToast({ msg: ok ? tr('toast.copied') : tr('share.copyFailed'), kind: ok ? 'ok' : 'error' });
                  window.setTimeout(() => setToast(null), 2500);
                }}
              >
                {tr('share.copy')}
              </button>
              <button className="btn small" onClick={() => setShareLink(null)}>
                {tr('prefs.done')}
              </button>
            </div>
        </Dialog>
      )}
      {showPrefs && (
        <Dialog title={tr('prefs.title')} onClose={closePrefs}>
            <h3>{tr('prefs.title')}</h3>
            <label className="prefs-row">
              <span>{tr('prefs.language')}</span>
              <select
                value={pendingLang ?? langChoice}
                onChange={(e) => setPendingLang(e.target.value as LangChoice)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l === 'system' ? tr('prefs.langSystem') : langLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            {VIEWER_ONLY && (
              <label className="prefs-row">
                <span>{tr('site.version')}</span>
                <a
                  className="prefs-link"
                  href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {SITE_PREVIEW ? tr('site.backStable') : tr('site.tryPreview')} ↗
                </a>
              </label>
            )}
            <label className="prefs-row">
              <span>{tr('prefs.theme')}</span>
              <select
                value={pendingTheme ?? themeMode}
                onChange={(e) => setPendingTheme(e.target.value as ThemeMode)}
              >
                <option value="system">{tr('theme.system')}</option>
                <option value="dark">{tr('theme.dark')}</option>
                <option value="light">{tr('theme.light')}</option>
              </select>
            </label>
            {IS_DESKTOP && (
              <label className="prefs-row">
                <span>{tr('prefs.channel')}</span>
                <select
                  value={pendingChannel ?? updateChannel}
                  onChange={(e) => setPendingChannel(e.target.value as UpdateChannel)}
                >
                  <option value="stable">{tr('prefs.channel.stable')}</option>
                  <option value="beta">{tr('prefs.channel.beta')}</option>
                </select>
              </label>
            )}
            {!VIEWER_ONLY && AI_ENABLED && (
              <div className="prefs-ai">
                <h4>{tr('prefs.ai')}</h4>
                <AiSettingsSection
                  settings={aiSettings}
                  onSettings={applyAiSettings}
                />
              </div>
            )}
            <div className="prefs-row btns">
              {/* Cancel is the always-available way out (user report 2026-09-24:
                  it used to be the disabled one, so an untouched dialog had no
                  working button on its left). It discards the drafts and closes. */}
              <button className="btn small" onClick={closePrefs}>
                {tr('prefs.cancel')}
              </button>
              {/* Save only means something when there is something to save. */}
              <button
                className="btn small accent"
                disabled={pendingLang == null && pendingTheme == null && pendingChannel == null}
                onClick={() => {
                  if (pendingLang != null) setLang(pendingLang);
                  if (pendingTheme != null) setThemeMode(pendingTheme);
                  // Applying the channel broadcasts to every window (self
                  // included), which re-checks the newly selected feed.
                  if (pendingChannel != null) setUpdateChannel(pendingChannel);
                  setPendingLang(null);
                  setPendingTheme(null);
                  setPendingChannel(null);
                  closePrefs();
                }}
              >
                {tr('prefs.save')}
              </button>
            </div>
        </Dialog>
      )}
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

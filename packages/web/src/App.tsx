import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
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
  makeSession,
  minimumSeparation,
  moveChoreoWaypoint,
  movePpWaypoint,
  parsePathFile,
  ParseError,
  REBUILT_2026,
  reparameterize,
  resetToOriginal,
  removeChoreoWaypoint,
  removePpWaypoint,
  serializeSession,
  sessionDuration,
} from '@pathblender/core';
import type { FieldPackage, RobotGeometry, SessionTrajectory, Trajectory } from '@pathblender/core';
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
import { FieldCanvas3D, type FieldCanvas3DHandle } from './components/FieldCanvas3D';
import { Timeline } from './components/Timeline';
import { RobotList } from './components/RobotList';
import { ConflictPanel } from './components/ConflictPanel';
import { ImportBanner } from './components/ImportBanner';
import { usePlayback } from './playback';
import { I18nProvider, LANGUAGES, langLabel, useI18n, type Lang } from './i18n';
import { CustomFieldPanel } from './components/CustomFieldPanel';
import { AiPanel, SparkleIcon } from './components/AiPanel';
import { EditorPage } from './components/EditorPage';
import { UpdateChannelProvider, useUpdateChannel, channelFeedUrl } from './update-channel';
import type { ActionContext } from './ai/actions';
import { loadAISettings, saveAISettings, type AISettings } from './ai/settings';

const SESSION_EXT = '.ghpb.json';

// Desktop (Tauri) hides the in-page preferences gear — ⌘, owns it there.
const IS_DESKTOP = location.protocol === 'tauri:' || location.protocol === 'asset:';

export function App() {
  return (
    <I18nProvider>
      <AppBody />
    </I18nProvider>
  );
}

function AppBody() {
  const { lang, setLang, t: tr } = useI18n();
  const { channel: updateChannel, setChannel: setUpdateChannel } = useUpdateChannel();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [robots, setRobots] = useState<SessionTrajectory[]>([]);
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
  const [aiSettings, setAiSettings] = useState<AISettings>(() => loadAISettings());
  const [showAi, setShowAi] = useState(false);
  const [view3D, setView3D] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showPrefs, setShowPrefs] = useState(false);
  const aiUndoRef = useRef<{ label: string; robots: SessionTrajectory[] }[]>([]);
  const [aiUndoTop, setAiUndoTop] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState(REBUILT_2026.id);
  const [fieldVariant, setFieldVariant] = useState<'welded' | 'andymark'>('welded');
  const [customField, setCustomField] = useState<FieldPackage | undefined>(undefined);
  const [customImageUrl, setCustomImageUrl] = useState<string | undefined>(undefined);
  const [cfOpen, setCfOpen] = useState(false);
  const [toast, setToast] = useState('');
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }, []);
  const importInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<FieldCanvasHandle>(null);
  const canvas3DRef = useRef<FieldCanvas3DHandle>(null);
  const baseField = fieldId === CUSTOM_FIELD_ID && customField ? customField : fieldById(fieldId);
  // The 2D overlay / beacons follow the selected field construction.
  const field =
    fieldVariant === 'andymark' && baseField?.aprilTagsAndyMark
      ? { ...baseField, aprilTags: baseField.aprilTagsAndyMark }
      : baseField;

  const duration = sessionDuration(robots);
  const playback = usePlayback(duration);
  const { t, setT } = playback;

  const visible = useMemo(() => robots.filter((r) => r.visible), [robots]);
  const conflicts = useMemo(
    () => detectCollisions(visible),
    [visible],
  );
  const bounds = useMemo(() => detectFieldBounds(visible, field), [visible, field]);
  const minSep = useMemo(() => minimumSeparation(visible), [visible]);

  // .path texts stay available so later .auto imports can resolve their
  // pathName references (within the same batch or across this session).
  const pathTextsRef = useRef(new Map<string, string>());

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const nextErrors: { fileName: string; message: string }[] = [];
    const added: Trajectory[] = [];
    const batch = new Map<string, string>(pathTextsRef.current);
    const list = Array.from(files);
    for (const file of list) {
      const text = await file.text();
      if (/\.path$/i.test(file.name)) {
        const stem = file.name.replace(/\.path$/i, '');
        batch.set(stem, text);
      }
    }
    for (const file of list) {
      const text = await file.text();
      // Session files restore as a whole session rather than one robot.
      if (file.name.endsWith(SESSION_EXT)) {
        try {
          const restored = deserializeSession(text);
          setRobots(restored.robots);
          setErrors([]);
          return;
        } catch {
          nextErrors.push({ fileName: file.name, message: tr('import.notSession') });
          continue;
        }
      }
      try {
        const traj = parsePathFile(text, file.name, (name) => batch.get(name));
        added.push(traj);
      } catch (e) {
        const message =
          e instanceof ParseError
            ? friendlyParseError(e, file.name, tr)
            : e instanceof Error
              ? e.message
              : String(e);
        nextErrors.push({ fileName: file.name, message });
      }
    }
    pathTextsRef.current = batch;
    if (added.length > 0) {
      // Colors follow the live robot count so consecutive imports keep cycling
      // through the palette instead of all landing on color 0.
      setRobots((prev) => [
        ...prev,
        ...added.map((traj, i) => makeSession(traj, prev.length + i)),
      ]);
    }
    setErrors(nextErrors);
  }, []);

  // Whole-window drag & drop.
  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
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

  const toggleEdit = useCallback((id: string) => {
    setEditingId((cur) => (cur === id ? null : id));
  }, []);

  const applyEdited = useCallback(
    (id: string, edit: (t: import('@pathblender/core').Trajectory) => import('@pathblender/core').Trajectory) => {
      setRobots((prev) =>
        prev.map((r) =>
          r.trajectory.id === id
            ? { ...r, trajectory: reparameterize(edit(r.trajectory)) }
            : r,
        ),
      );
    },
    [],
  );

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
          r.trajectory.id === id
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
      pushUndo: (label) => {
        aiUndoRef.current = [...aiUndoRef.current.slice(-19), { label, robots }];
        setAiUndoTop(label);
      },
    };
  }, [robots, conflicts, setStartDelay, setAlliance, setTeamNumber, editWaypoint, addWaypoint, removeWaypoint, removeRobot, exportRobot]);

  const aiUndo = useCallback(() => {
    const top = aiUndoRef.current[aiUndoRef.current.length - 1];
    if (!top) return;
    aiUndoRef.current = aiUndoRef.current.slice(0, -1);
    setAiUndoTop(aiUndoRef.current[aiUndoRef.current.length - 1]?.label ?? null);
    setRobots(top.robots);
  }, []);

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
  }, [robots, fieldId]);


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
      flash(tr('toast.shareFailed'));
    }
  }, [robots, fieldId, flash, tr]);

  // Restore a shared session from the URL hash on first load.
  useEffect(() => {
    if (!location.hash.startsWith('#s=')) return;
    void hashToSession(location.hash).then((restored) => {
      if (restored && restored.robots.length > 0) {
        setFieldId(restored.fieldId);
        if (restored.fieldId === CUSTOM_FIELD_ID && restored.field) {
          setCustomField(restored.field);
        }
        setRobots(restored.robots);
      }
    });
  }, []);

  const exportPng = useCallback(() => {
    if (view3D) {
      flash(tr('toast.pngOnly2d'));
      return;
    }
    canvasRef.current?.exportPng((ok) => flash(tr(ok ? 'toast.pngSaved' : 'toast.pngFailed')));
  }, [view3D, flash, tr]);

  // Native "Check for Updates…": quiet until the release feed exists —
  // a 404 (no releases yet) or offline lands in the honest fallback toast.
  // The feed follows the selected channel (stable/beta). Download installs
  // on quit automatically (Tauri keeps the staged update) — relaunch only
  // when the user is still here; a stale-version note covers the rest.
  const checkForUpdates = useCallback(async () => {
    if (!IS_DESKTOP) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check({ headers: {}, timeout: 15000, target: undefined } as never).catch(() => null)
        // channel-aware check: point the updater at the channel feed
        ?? await check({ url: channelFeedUrl(updateChannel) } as never).catch(() => null);
      if (update == null) {
        flash(tr('updates.upToDate'));
        return;
      }
      flash(tr('updates.downloading', { v: update.version }));
      await update.downloadAndInstall();
      // User is present (they triggered the check) → relaunch right away.
      await relaunch();
    } catch {
      flash(tr('updates.none'));
    }
  }, [flash, tr, updateChannel]);

  const clearAll = useCallback(() => {
    setRobots([]);
    setErrors([]);
    setT(0);
  }, [setT]);
  // Desktop: the native app menu owns Import/Save/Share/PNG/Clear —
  // the toolbar buttons hide there, but the shared input stays reachable.
  // The menu is rebuilt in the app language whenever it changes.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    let disposed = false;
    const unbinds: (() => void)[] = [];
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (disposed) return;
      void listen('menu-import', () => importInputRef.current?.click()).then((u) => unbinds.push(u));
      void listen('menu-save', () => saveSession()).then((u) => unbinds.push(u));
      void listen('menu-share', () => void shareUrl()).then((u) => unbinds.push(u));
      void listen('menu-png', () => exportPng()).then((u) => unbinds.push(u));
      void listen('menu-clear', () => clearAll()).then((u) => unbinds.push(u));
      void listen('menu-check-update', () => void checkForUpdates()).then((u) => unbinds.push(u));
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

  // Editing lives on its own page (round 9): the fusion view unmounts
  // entirely, Choreo-style — the robot's edits persist on close.
  if (editingId && editRobot) {
    return (
      <div className="app">
        <EditorPage
          robot={editRobot}
          field={field}
          fieldImageUrl={FIELD_IMAGES[field.id] ?? customImageUrl}
          onEditWaypoint={editWaypoint}
          onAddWaypoint={addWaypoint}
          onRemoveWaypoint={removeWaypoint}
          onReset={resetEdit}
          onExport={exportRobot}
          onClose={() => setEditingId(null)}
        />
        {toast !== '' && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="toolbar" data-tauri-drag-region="" aria-label="primary">
        <ToolBtn
          label={tr('rail.import')}
          aria={tr('actions.import')}
          fileInput
          hidden={IS_DESKTOP}
          inputRef={importInputRef}
          onFiles={(files) => void importFiles(files)}
        />
        {!IS_DESKTOP && (
          <ToolBtn label={tr('rail.save')} aria={tr('actions.save')} onClick={saveSession} disabled={robots.length === 0} />
        )}
        {!IS_DESKTOP && (
          <>
            <ToolBtn label={tr('rail.share')} aria="Share link" onClick={() => void shareUrl()} disabled={robots.length === 0} />
            <ToolBtn label={tr('rail.png')} aria={tr('actions.png')} onClick={exportPng} disabled={robots.length === 0 || view3D} />
            <ToolBtn label={tr('rail.prefs')} aria={tr('prefs.title')} onClick={() => setShowPrefs(true)} />
            <span className="toolbar-spacer" />
            <ToolBtn label={tr('rail.clear')} aria={tr('actions.clear')} danger onClick={clearAll} disabled={robots.length === 0} />
          </>
        )}
      </header>
      <div className="app-col">


      <ImportBanner errors={errors} onDismiss={() => setErrors([])} />

      <main className="app-body">
        <RobotList
          robots={robots}
          conflicts={conflicts}
          onUpdate={updateRobot}
          onSetAlliance={setAlliance}
          onSetGeometry={setGeometry}
          onSetTeamNumber={setTeamNumber}
          editingId={editingId}
          onToggleEdit={toggleEdit}
          onResetEdit={resetEdit}
          onExport={exportRobot}
          onRemove={removeRobot}
        />
        <div className="canvas-slot">
          <div className="canvas-bar">
            <select
              className="field-select"
              value={fieldId}
              onChange={(e) => {
                setFieldId(e.target.value);
                if (e.target.value === CUSTOM_FIELD_ID && !customField) {
                  setCfOpen(true);
                }
              }}
              title="Game season"
            >
              {FIELDS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} {f.year}
                </option>
              ))}
              <option value={CUSTOM_FIELD_ID}>{tr('customField.title')}</option>
            </select>
            {field.aprilTagsAndyMark && (
              <select
                className="field-select"
                value={fieldVariant}
                onChange={(e) => setFieldVariant(e.target.value as 'welded' | 'andymark')}
                title={tr('field.variant')}
                aria-label={tr('field.variant')}
              >
                <option value="welded">Welded</option>
                <option value="andymark">AndyMark</option>
              </select>
            )}
            <button
              className={`btn small ${view3D ? 'on' : ''}`}
              onClick={() => setView3D((v) => !v)}
            >
              3D
            </button>
            {view3D && (
              <button
                className="btn small"
                onClick={() => canvas3DRef.current?.resetCam()}
              >
                {tr('canvas.fit')}
              </button>
            )}
            <label className="switch">
              <input
                type="checkbox"
                checked={showTrail}
                onChange={(e) => setShowTrail(e.target.checked)}
              />
              <span className="sw-track" aria-hidden="true" />
              <span className="sw-text">{tr('canvas.trails')}</span>
            </label>
            <span className="canvas-spacer" />
            <button
              className="btn small ai-toggle"
              title={tr('ai.title')}
              aria-label={tr('ai.title')}
              onClick={() => setShowAi((v) => !v)}
            >
              <SparkleIcon />
            </button>
          </div>
          {view3D ? (
            <FieldCanvas3D
              ref={canvas3DRef}
              variant={fieldVariant}
              field={field}
              fieldImageUrl={FIELD_IMAGES[field.id] ?? customImageUrl}
              robots={visible}
              currentT={t}
            />
          ) : (
            <FieldCanvas
              ref={canvasRef}
              showTrail={showTrail}
          field={field}
          fieldImageUrl={FIELD_IMAGES[field.id] ?? customImageUrl}
          robots={visible}
          currentT={t}
          conflicts={conflicts}
          bounds={bounds}
          editRobot={editRobot}
          onEditWaypoint={editWaypoint}
          onAddWaypoint={addWaypoint}
              onRemoveWaypoint={removeWaypoint}
            />
          )}
        </div>
        <ConflictPanel
          robots={visible}
          conflicts={conflicts}
          bounds={bounds}
          minSeparation={minSep}
          onJump={setT}
          onAutoResolve={() => {
            const next = autoResolveConflicts(robots);
            setRobots(next);
            const remaining = detectCollisions(next.filter((r) => r.visible)).length;
            if (remaining > 0) flash(tr('conflicts.autoResolvePartial', { n: remaining }));
          }}
        />
        {showAi && (
          <AiPanel
            settings={aiSettings}
            onSettings={applyAiSettings}
            buildContext={buildActionContext}
            undoLabel={aiUndoTop}
            onUndo={aiUndo}
            onAttachFiles={(files) => void importFiles(files)}
          />
        )}
      </main>

      <CustomFieldPanel
        open={cfOpen}
        onClose={() => {
          setCfOpen(false);
          if (!customField) setFieldId(REBUILT_2026.id);
        }}
        current={customField}
        onApply={(f, url) => {
          setCustomField(f);
          setCustomImageUrl(url);
          setFieldId(CUSTOM_FIELD_ID);
        }}
      />
      {toast !== '' && <div className="toast">{toast}</div>}
      <footer className="app-footer">
        <Timeline
          robots={visible}
          conflicts={conflicts}
          bounds={bounds}
          duration={duration}
          playback={playback}
        />
      </footer>
      {shareLink != null && (
        <div className="prefs-overlay" onClick={() => setShareLink(null)}>
          <div className="prefs-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('share.title')}</h3>
            <textarea className="share-box" readOnly value={shareLink} rows={3} />
            <p className="prefs-note">{tr('share.note')}</p>
            <div className="prefs-row btns">
              <button
                className="btn small"
                onClick={async () => {
                  const ok = await copyText(shareLink);
                  setToast(ok ? tr('toast.copied') : tr('share.copyFailed'));
                  window.setTimeout(() => setToast(''), 2500);
                }}
              >
                {tr('share.copy')}
              </button>
              <button className="btn small" onClick={() => setShareLink(null)}>
                {tr('prefs.done')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPrefs && (
        <div className="prefs-overlay" onClick={() => setShowPrefs(false)}>
          <div className="prefs-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{tr('prefs.title')}</h3>
            <label className="prefs-row">
              <span>{tr('prefs.language')}</span>
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {langLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="prefs-row">
              <span>{tr('prefs.theme')}</span>
              <select value={themeMode} onChange={(e) => setThemeMode(e.target.value as ThemeMode)}>
                <option value="system">{tr('theme.system')}</option>
                <option value="dark">{tr('theme.dark')}</option>
                <option value="light">{tr('theme.light')}</option>
              </select>
            </label>
            <label className="prefs-row">
              <span>{tr('prefs.channel')}</span>
              <select
                value={updateChannel}
                onChange={(e) => {
                  const next = e.target.value as 'stable' | 'beta';
                  setUpdateChannel(next);
                  void checkForUpdates(); // switch channel → immediately check that channel's feed
                }}
              >
                <option value="stable">{tr('prefs.channel.stable')}</option>
                <option value="beta">{tr('prefs.channel.beta')}</option>
              </select>
            </label>
            <div className="prefs-row btns">
              <button className="btn small" onClick={() => setShowPrefs(false)}>
                {tr('prefs.done')}
              </button>
            </div>
          </div>
        </div>
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


function ToolBtn(props: {
  label: string;
  aria: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  fileInput?: boolean;
  hidden?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onFiles?: (files: FileList) => void;
  title?: string;
}) {
  const { label, aria, onClick, disabled, active, danger, fileInput, hidden, inputRef, onFiles, title } = props;
  const cls = `tool-btn${active ? ' on' : ''}${danger ? ' danger' : ''}${hidden ? ' hidden-tool' : ''}`;
  const body = <span className="tool-label">{label}</span>;
  if (fileInput) {
    return (
      <label className={cls} title={title ?? aria} aria-label={aria}>
        {body}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onFiles?.(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
    );
  }
  return (
    <button className={cls} title={title ?? aria} aria-label={aria} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

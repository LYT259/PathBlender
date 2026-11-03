/**
 * WPILOG import dialog: log file(s) → per-file choice of pose source and
 * autonomous interval → unified trajectories. The dialog exists because
 * "the container parsed" is not "the route recovered": the user confirms
 * which entry is the robot pose and which time window is the auto run.
 * Everything stays local; parsing runs through the wpilog client (worker
 * when available, byte-identical fallback otherwise).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FieldPackage,
  HeadingUnit,
  LengthUnit,
  Trajectory,
  WpilogExtractionSelection,
  WpilogInspection,
} from '@pathblender/core';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import { createWpilogClient, type WpilogClient } from './client';

export interface WpilogIncomingFile {
  file: File;
  relPath: string;
}

export interface WpilogImportResult {
  routes: Array<{ relPath: string; trajectory: Trajectory }>;
  failures: Array<{ relPath: string; message: string }>;
}

type FileState =
  | { status: 'inspecting' }
  | { status: 'ready'; inspection: WpilogInspection }
  | { status: 'failed'; message: string };

interface FileSlot {
  /** Stable identity: relPath#index at enqueue time — survives appends. */
  key: string;
  file: File;
  relPath: string;
  state: FileState;
  selection: Selection | null;
}

function slotOf(incoming: WpilogIncomingFile, index: number): FileSlot {
  return {
    key: `${incoming.relPath}#${index}`,
    file: incoming.file,
    relPath: incoming.relPath,
    state: { status: 'inspecting' },
    selection: null,
  };
}

interface Selection {
  pose:
    | { mode: 'candidate'; entryId: number; elementIndex: number }
    | { mode: 'fields'; xEntryId: number; yEntryId: number; headingEntryId?: number };
  intervalIndex: number | null;
  manualStartS: number;
  manualEndS: number;
  lengthUnit: LengthUnit;
  headingUnit: HeadingUnit;
  frameOrigin: 'blue' | 'red';
}

const UNIT_BY_HINT: Record<string, LengthUnit> = {
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm',
  in: 'in', inch: 'in', inches: 'in',
  ft: 'ft', foot: 'ft', feet: 'ft',
};

function defaultLengthUnit(hint: string | undefined): LengthUnit {
  return UNIT_BY_HINT[(hint ?? '').toLowerCase()] ?? 'm';
}

/**
 * Sensible starting point after inspection: the highest-scoring measured
 * candidate and the longest detected auto interval — every default stays a
 * visible, changeable choice in the panel. With no candidates at all, the
 * custom x/y/heading mapping starts on name-matched numeric entries; with
 * no numeric entries either, the file reports "no pose data".
 */
function defaultSelection(inspection: WpilogInspection): Selection | null {
  const spanS = (inspection.lastTimestampUs - inspection.firstTimestampUs) / 1e6;
  const numeric = inspection.catalog.entries.filter((entry) =>
    (entry.type === 'double' || entry.type === 'float') && entry.recordCount > 0);
  const best = inspection.candidates[0];
  if (!best) {
    if (numeric.length === 0) return null;
    const x = numeric.find((e) => /x/i.test(e.name.split('/').pop() ?? ''));
    const y = numeric.find((e) => /\by\b/i.test(e.name.split('/').pop() ?? ''));
    if (!x || !y) return null;
    const heading = numeric.find((e) => /(heading|theta|angle|rot|yaw)/i.test(e.name));
    return {
      pose: { mode: 'fields', xEntryId: x.id, yEntryId: y.id, headingEntryId: heading?.id },
      intervalIndex: null,
      manualStartS: 0,
      manualEndS: spanS,
      lengthUnit: 'm',
      headingUnit: 'deg',
      frameOrigin: 'blue',
    };
  }
  let intervalIndex: number | null = null;
  if (inspection.autoIntervals.length > 0) {
    intervalIndex = inspection.autoIntervals.reduce((bestIndex, interval, index, all) =>
      (interval.endUs - interval.startUs) > (all[bestIndex]!.endUs - all[bestIndex]!.startUs) ? index : bestIndex, 0);
  }
  return {
    pose: { mode: 'candidate', entryId: best.entryId, elementIndex: 0 },
    intervalIndex,
    manualStartS: 0,
    manualEndS: spanS,
    lengthUnit: defaultLengthUnit(best.unitHint),
    headingUnit: best.kind === 'numeric-array' ? 'deg' : 'rad',
    frameOrigin: 'blue',
  };
}

export function WpilogImportDialog({
  files,
  field,
  onDone,
  onCancel,
}: {
  files: WpilogIncomingFile[];
  field: FieldPackage;
  onDone: (result: WpilogImportResult) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  // Slots are created exclusively by the files effect (initial batch and
  // later appends take the same path) — seeding them here as well would
  // duplicate every file.
  const [slots, setSlots] = useState<FileSlot[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [working, setWorking] = useState(false);
  const clientRef = useRef<WpilogClient | null>(null);
  const cancelledRef = useRef(false);
  /** relPath#index keys already queued or inspected (appends while open
   *  re-run the effect; the first run covers the initial batch). */
  const seenKeysRef = useRef(new Set<string>());
  /** Serializes inspections: one worker, bounded memory, any arrival order. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // Client lifecycle only — inspections run through the files effect below.
  useEffect(() => {
    cancelledRef.current = false;
    const client = createWpilogClient();
    clientRef.current = client;
    return () => {
      cancelledRef.current = true;
      client.dispose();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inspect every file once, sequentially — including files appended to the
  // queue while the dialog is already open (a .wpilog dropped mid-session
  // used to vanish silently; it now gets its own slot and inspection).
  useEffect(() => {
    const pending = files
      .map((incoming, index) => ({ incoming, key: `${incoming.relPath}#${index}` }))
      .filter(({ key }) => !seenKeysRef.current.has(key));
    if (pending.length === 0) return;
    for (const { key } of pending) seenKeysRef.current.add(key);
    setSlots((prev) => [...prev, ...pending.map(({ incoming, key }) => slotOf(incoming, Number(key.split('#').at(-1))))]);
    for (const { incoming, key } of pending) {
      const slotKey = key;
      queueRef.current = queueRef.current.then(async () => {
        if (cancelledRef.current) return;
        const client = clientRef.current;
        if (!client) return;
        try {
          const bytes = new Uint8Array(await incoming.file.arrayBuffer());
          const inspection = await client.inspect(bytes, incoming.relPath);
          if (cancelledRef.current) return;
          const selection = defaultSelection(inspection);
          setSlots((prev) => prev.map((slot) => slot.key === slotKey
            ? { ...slot, state: { status: 'ready', inspection }, selection }
            : slot));
        } catch (error) {
          if (cancelledRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setSlots((prev) => prev.map((slot) => slot.key === slotKey
            ? { ...slot, state: { status: 'failed', message } }
            : slot));
        }
      });
    }
  }, [files]);

  const active = slots[activeIndex] ?? null;
  const patchActive = useCallback((patch: Partial<FileSlot>) => {
    setSlots((prev) => prev.map((slot, index) => index === activeIndex ? { ...slot, ...patch } : slot));
  }, [activeIndex]);

  const readySlots = slots.filter((slot) => slot.state.status === 'ready' && slot.selection);

  const confirm = useCallback(async () => {
    setWorking(true);
    const client = clientRef.current ?? createWpilogClient();
    const routes: WpilogImportResult['routes'] = [];
    const failures: WpilogImportResult['failures'] = [];
    for (const slot of slots) {
      if (slot.state.status === 'failed') {
        failures.push({ relPath: slot.relPath, message: slot.state.message });
        continue;
      }
      if (slot.state.status === 'inspecting') {
        failures.push({ relPath: slot.relPath, message: t('wpilog.stillReading') });
        continue;
      }
      if (!slot.selection) {
        failures.push({ relPath: slot.relPath, message: t('wpilog.nothingSelected') });
        continue;
      }
      const selection = slot.selection;
      const payload: WpilogExtractionSelection = {
        pose: selection.pose,
        interval: selection.intervalIndex !== null
          ? { mode: 'auto', index: selection.intervalIndex }
          : { mode: 'manual', startS: selection.manualStartS, endS: selection.manualEndS },
        lengthUnit: selection.lengthUnit,
        headingUnit: selection.headingUnit,
        frameOrigin: selection.frameOrigin,
        field: selection.frameOrigin === 'red' ? { lengthM: field.lengthM, widthM: field.widthM } : undefined,
        name: slot.relPath,
      };
      try {
        // Bytes re-read from the File at confirm time — large logs don't
        // sit duplicated in memory while the user ponders the panel.
        const bytes = new Uint8Array(await slot.file.arrayBuffer());
        const trajectory = await client.extract(bytes, slot.state.inspection, payload);
        routes.push({ relPath: slot.relPath, trajectory });
      } catch (error) {
        failures.push({ relPath: slot.relPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
    onDone({ routes, failures });
  }, [slots, onDone, field]);

  return <Dialog title={t('wpilog.title')} onClose={onCancel} className="wpilog-dialog">
    <div className="wpilog-body">
      <aside className="wpilog-queue" aria-label={t('wpilog.queued')}>
        {slots.map((slot, index) => <button
          key={slot.relPath + index}
          type="button"
          className={`wpilog-file${index === activeIndex ? ' active' : ''}`}
          onClick={() => setActiveIndex(index)}
        >
          <span className="wpilog-file-name">{slot.relPath.split('/').pop()}</span>
          <span className="wpilog-file-state" aria-hidden="true">
            {slot.state.status === 'inspecting' && '…'}
            {slot.state.status === 'ready' && (slot.selection ? <Icon name="check" size={12} /> : <Icon name="warning" size={12} />)}
            {slot.state.status === 'failed' && <Icon name="warning" size={12} />}
          </span>
        </button>)}
      </aside>
      <div className="wpilog-main">
        {active?.state.status === 'failed' && (
          <p className="wpilog-error" role="alert">{t('wpilog.inspectFailed', { name: active.relPath, message: active.state.message })}</p>
        )}
        {active?.state.status === 'inspecting' && <p>{t('wpilog.inspecting', { name: active.relPath.split('/').pop() ?? '' })}</p>}
        {active?.state.status === 'ready' && active.selection && (
          <FilePanel
            inspection={active.state.inspection}
            selection={active.selection}
            field={field}
            onSelectionChange={(selection) => patchActive({ selection })}
          />
        )}
        {active?.state.status === 'ready' && !active.selection && (
          <p className="wpilog-error" role="alert">{t('wpilog.noPose')}</p>
        )}
      </div>
    </div>
    <div className="wpilog-actions">
      <button type="button" className="btn" onClick={onCancel}>{t('import.dismiss')}</button>
      <button type="button" className="btn accent" disabled={working || readySlots.length === 0} onClick={() => void confirm()}>
        {t('wpilog.importN', { n: readySlots.length })}
      </button>
    </div>
  </Dialog>;
}

/* ------------------------------------------------------------------ */
/* Per-file panel                                                      */
/* ------------------------------------------------------------------ */

function FilePanel({
  inspection,
  selection,
  field,
  onSelectionChange,
}: {
  inspection: WpilogInspection;
  selection: Selection;
  field: FieldPackage;
  onSelectionChange: (selection: Selection) => void;
}) {
  const { t } = useI18n();
  const candidate = inspection.candidates.find((c) =>
    c.entryId === (selection.pose.mode === 'candidate' ? selection.pose.entryId : -1));
  const numericEntries = useMemo(() => inspection.catalog.entries.filter((entry) =>
    entry.type === 'double' || entry.type === 'float' || entry.type === 'int64'), [inspection]);
  const patch = (part: Partial<Selection>) => onSelectionChange({ ...selection, ...part });
  const logSpanS = Math.max(0, (inspection.lastTimestampUs - inspection.firstTimestampUs) / 1e6);

  return <div className="wpilog-panel">
    <section>
      <h3>{t('wpilog.poseSource')}</h3>
      {inspection.candidates.length === 0 && <p className="wpilog-hint">{t('wpilog.noPose')}</p>}
      <div className="wpilog-candidates" role="radiogroup" aria-label={t('wpilog.poseSource')}>
        {inspection.candidates.map((c) => <label key={c.entryId} className={`wpilog-candidate${selection.pose.mode === 'candidate' && selection.pose.entryId === c.entryId ? ' selected' : ''}`}>
          <input
            type="radio"
            name="wpilog-pose"
            checked={selection.pose.mode === 'candidate' && selection.pose.entryId === c.entryId}
            onChange={() => patch({
              pose: { mode: 'candidate', entryId: c.entryId, elementIndex: 0 },
              lengthUnit: defaultLengthUnit(c.unitHint),
              headingUnit: c.kind === 'numeric-array' ? 'deg' : 'rad',
            })}
          />
          <span className="wpilog-candidate-body">
            <span className="wpilog-candidate-name">{c.entryName}</span>
            <span className="wpilog-candidate-meta">
              {c.type} · {t('wpilog.records', { n: c.recordCount, span: c.spanS.toFixed(1) })}
              {c.hasHeading ? '' : ` · ${t('wpilog.noHeading')}`}
              {c.unitHint ? ` · ${t('wpilog.unitHint', { unit: c.unitHint })}` : ''}
            </span>
            {c.likelyTarget && <span className="wpilog-badge target">{t('wpilog.candidateTarget')}</span>}
            {c.outOfFieldRange && <span className="wpilog-badge range">{t('wpilog.outOfRange')}</span>}
          </span>
        </label>)}
        {numericEntries.length >= 2 && <label className={`wpilog-candidate${selection.pose.mode === 'fields' ? ' selected' : ''}`}>
          <input
            type="radio"
            name="wpilog-pose"
            checked={selection.pose.mode === 'fields'}
            onChange={() => {
              const x = numericEntries.find((e) => /x/i.test(e.name.split('/').pop() ?? ''));
              const y = numericEntries.find((e) => /\by\b/i.test(e.name.split('/').pop() ?? ''));
              const heading = numericEntries.find((e) => /(heading|theta|angle|rot|yaw)/i.test(e.name));
              if (!x || !y) return;
              patch({ pose: { mode: 'fields', xEntryId: x.id, yEntryId: y.id, headingEntryId: heading?.id }, headingUnit: 'deg' });
            }}
          />
          <span className="wpilog-candidate-body">
            <span className="wpilog-candidate-name">{t('wpilog.customFields')}</span>
          </span>
        </label>}
      </div>
      {selection.pose.mode === 'candidate' && candidate && candidate.elementCount > 1 && (
        <label className="wpilog-inline">
          {t('wpilog.element')}
          <input
            type="number"
            min={0}
            max={candidate.elementCount - 1}
            value={selection.pose.elementIndex}
            onChange={(e) => {
              const value = Math.max(0, Math.min(candidate.elementCount - 1, Number(e.target.value) || 0));
              if (selection.pose.mode === 'candidate') {
                patch({ pose: { mode: 'candidate', entryId: selection.pose.entryId, elementIndex: value } });
              }
            }}
          />
          <span className="wpilog-hint">0…{candidate.elementCount - 1}</span>
        </label>
      )}
      {selection.pose.mode === 'fields' && (
        <div className="wpilog-mapping">
          <label>{t('wpilog.xField')}
            <select value={selection.pose.mode === 'fields' ? selection.pose.xEntryId : 0} onChange={(e) => selection.pose.mode === 'fields' && patch({ pose: { ...selection.pose, xEntryId: Number(e.target.value) } })}>
              {numericEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label>{t('wpilog.yField')}
            <select value={selection.pose.mode === 'fields' ? selection.pose.yEntryId : 0} onChange={(e) => selection.pose.mode === 'fields' && patch({ pose: { ...selection.pose, yEntryId: Number(e.target.value) } })}>
              {numericEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label>{t('wpilog.headingField')}
            <select
              value={selection.pose.headingEntryId ?? ''}
              onChange={(e) => selection.pose.mode === 'fields' && patch({ pose: { ...selection.pose, headingEntryId: e.target.value === '' ? undefined : Number(e.target.value) } })}
            >
              <option value="">—</option>
              {numericEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </section>

    <section>
      <h3>{t('wpilog.interval')}</h3>
      {inspection.autoIntervals.length === 0 && <p className="wpilog-hint">{t('wpilog.noIntervals')}</p>}
      <div role="radiogroup" aria-label={t('wpilog.interval')}>
        {inspection.autoIntervals.map((interval, index) => {
          const startS = (interval.startUs - inspection.firstTimestampUs) / 1e6;
          const endS = (interval.endUs - inspection.firstTimestampUs) / 1e6;
          return <label key={index} className={`wpilog-interval${selection.intervalIndex === index ? ' selected' : ''}`}>
            <input
              type="radio"
              name="wpilog-interval"
              checked={selection.intervalIndex === index}
              onChange={() => patch({ intervalIndex: index })}
            />
            <span>{startS.toFixed(1)} s → {endS.toFixed(1)} s ({(endS - startS).toFixed(1)} s)</span>
            <span className="wpilog-hint">{t('wpilog.intervalSource', { source: interval.source })}</span>
          </label>;
        })}
        <label className={`wpilog-interval${selection.intervalIndex === null ? ' selected' : ''}`}>
          <input
            type="radio"
            name="wpilog-interval"
            checked={selection.intervalIndex === null}
            onChange={() => patch({ intervalIndex: null })}
          />
          <span>{t('wpilog.manual')}</span>
        </label>
      </div>
      {selection.intervalIndex === null && (
        <div className="wpilog-manual">
          <label>
            {t('wpilog.startTime')}
            <input type="number" min={0} max={logSpanS} step={0.1} value={selection.manualStartS}
              onChange={(e) => patch({ manualStartS: Math.max(0, Math.min(logSpanS, Number(e.target.value) || 0)) })} />
          </label>
          <label>
            {t('wpilog.endTime')}
            <input type="number" min={0} max={logSpanS} step={0.1} value={selection.manualEndS}
              onChange={(e) => patch({ manualEndS: Math.max(0, Math.min(logSpanS, Number(e.target.value) || 0)) })} />
          </label>
          <span className="wpilog-hint">0 … {logSpanS.toFixed(1)} s</span>
        </div>
      )}
    </section>

    <section>
      <h3>{t('wpilog.unitsFrame')}</h3>
      {(selection.pose.mode === 'fields' || candidate?.kind === 'numeric-array') && (
        <div className="wpilog-units">
          <label>
            {t('wpilog.lengthUnit')}
            <select value={selection.lengthUnit} onChange={(e) => patch({ lengthUnit: e.target.value as LengthUnit })}>
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="in">in</option>
              <option value="ft">ft</option>
            </select>
          </label>
          <label>
            {t('wpilog.headingUnit')}
            <select value={selection.headingUnit} onChange={(e) => patch({ headingUnit: e.target.value as HeadingUnit })}>
              <option value="rad">rad</option>
              <option value="deg">deg</option>
            </select>
          </label>
        </div>
      )}
      <label className="wpilog-inline">
        {t('wpilog.frame')}
        <select value={selection.frameOrigin} onChange={(e) => patch({ frameOrigin: e.target.value as 'blue' | 'red' })}>
          <option value="blue">{t('wpilog.frameBlue')}</option>
          <option value="red">{t('wpilog.frameRed')}</option>
        </select>
      </label>
    </section>

    {inspection.warnings.length > 0 && (
      <section className="wpilog-logwarnings">
        <h3>{t('wpilog.warnings', { n: inspection.warnings.length })}</h3>
        <ul>{inspection.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </section>
    )}
    <PosePreview inspection={inspection} selection={selection} field={field} />
  </div>;
}

/** Small field-frame plot of the chosen candidate's preview poses. */
function PosePreview({
  inspection,
  selection,
  field,
}: {
  inspection: WpilogInspection;
  selection: Selection;
  field: FieldPackage;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candidate = inspection.candidates.find((c) =>
    c.entryId === (selection.pose.mode === 'candidate' ? selection.pose.entryId : -1));
  // The preview plots the candidate's decoded head samples (first ~96
  // records) — enough to recognise the path shape, honestly labelled.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const margin = 6;
    const fieldW = width - margin * 2;
    const fieldH = fieldW * (field.widthM / field.lengthM);
    const ox = margin;
    const oy = (height - fieldH) / 2;
    ctx.strokeStyle = 'rgba(128,128,128,0.6)';
    ctx.strokeRect(ox, oy, fieldW, fieldH);
    const points = candidate?.preview ?? [];
    if (points.length === 0) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(-0.5, ...xs);
    const maxX = Math.max(field.lengthM + 0.5, ...xs);
    const minY = Math.min(-0.5, ...ys);
    const maxY = Math.max(field.widthM + 0.5, ...ys);
    const sx = (x: number) => ox + ((x - minX) / (maxX - minX)) * fieldW;
    const sy = (y: number) => oy + fieldH - ((y - minY) / (maxY - minY)) * fieldH;
    ctx.strokeStyle = 'rgba(0,122,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(sx(point.x), sy(point.y));
      else ctx.lineTo(sx(point.x), sy(point.y));
    });
    ctx.stroke();
    ctx.fillStyle = 'rgba(52,199,89,1)';
    ctx.beginPath();
    ctx.arc(sx(points[0]!.x), sy(points[0]!.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }, [candidate, field]);
  const entryName = selection.pose.mode === 'candidate'
    ? inspection.catalog.byId.get(selection.pose.entryId)?.name ?? ''
    : t('wpilog.customFields');
  return <section className="wpilog-preview">
    <h3>{t('wpilog.preview')}</h3>
    <canvas ref={canvasRef} width={280} height={140} role="img" aria-label={t('wpilog.preview')} />
    <p className="wpilog-hint">{entryName}</p>
  </section>;
}

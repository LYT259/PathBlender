import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { SessionRouteOption, SequenceJoinIssue, SequenceTimingIssue } from '@pathblender/core';
import { useI18n } from '../i18n';
import { sequenceRows, type AutoSequenceSegment } from '../auto-sequence-state';
import { routeLabel } from '../route-library';
import { formatLength, useLengthUnit } from '../length-units';
import { Icon } from './Icon';
import './AutoSequenceEditor.css';

export interface AutoSequenceEditorProps {
  routes: SessionRouteOption[];
  segments: AutoSequenceSegment[];
  onChange: (segments: AutoSequenceSegment[]) => void;
  /** Join mismatches between consecutive segments (earlier segment index). */
  joins?: SequenceJoinIssue[];
  /** Finish-time warning when the composition outruns the auto period. */
  timing?: SequenceTimingIssue | undefined;
  /** Seek the playback head to a seam (pauses playback). */
  onJump?: (t: number) => void;
}

/** Controlled editor for one robot's composition. No parser, collision or persistence calls. */
export function AutoSequenceEditor({ routes, segments, onChange, joins = [], timing, onJump }: AutoSequenceEditorProps) {
  const { t } = useI18n();
  const [unit] = useLengthUnit();
  const uid = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rows = sequenceRows(segments, routes);
  const totalS = rows.at(-1)?.endS ?? 0;

  function patch(id: string, change: Partial<AutoSequenceSegment>) {
    onChange(segments.map((segment) => segment.id === id ? { ...segment, ...change } : segment));
  }

  function add() {
    const route = routes.find((option) => !segments.some((segment) => segment.routeId === option.id)) ?? routes[0];
    if (!route) return;
    onChange([...segments, { id: crypto.randomUUID(), routeId: route.id, waitBeforeS: 0 }]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLSelectElement>('li:last-child select')?.focus());
  }

  function move(index: number, offset: number) {
    const next = [...segments];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    // Waits belong to their time slots, not route assets. Swapping does not
    // accidentally turn an initial start delay into a mid-auto pause.
    const here = next[index]!;
    const there = next[target]!;
    next[index] = { ...there, waitBeforeS: here.waitBeforeS };
    next[target] = { ...here, waitBeforeS: there.waitBeforeS };
    onChange(next);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLSelectElement>('select')[target]?.focus());
  }

  function remove(id: string, index: number) {
    onChange(segments.filter((segment) => segment.id !== id));
    requestAnimationFrame(() => {
      const selects = listRef.current?.querySelectorAll<HTMLSelectElement>('select');
      (selects?.[Math.min(index, (selects?.length ?? 0) - 1)] ?? addRef.current)?.focus();
    });
  }

  const joinDetail = (issue: SequenceJoinIssue) => issue.kind === 'position'
    ? t('sequence.joinPosition', { d: formatLength(issue.delta, unit) })
    : issue.kind === 'heading'
      ? t('sequence.joinHeading', { d: issue.delta.toFixed(1) })
      : t('sequence.joinVelocity', { d: issue.delta.toFixed(2) });

  return (
    <section className="robot-inspector-section auto-sequence" aria-labelledby={`${uid}-title`}>
      <div className="auto-sequence-heading">
        <h3 id={`${uid}-title`}>{t('sequence.title')}</h3>
      </div>
      {rows.length > 0 && <div className="auto-sequence-overview">
        <div className="auto-sequence-summary">
          <span>{t('sequence.count', { n: rows.length })}</span>
          <span>{t('sequence.finish')} <strong><bdi>{totalS.toFixed(2)}</bdi> {t('sequence.seconds')}</strong></span>
        </div>
        <div className="auto-sequence-strip" aria-hidden="true" dir="ltr">
          {rows.map((row, index) => <div className="auto-sequence-strip-slot" key={row.id} style={{ flexGrow: row.endS - row.startS + row.waitBeforeS }}>
            {row.waitBeforeS > 0 && <span className="auto-sequence-strip-wait" style={{ flexGrow: row.waitBeforeS }} />}
            <span className="auto-sequence-strip-route" style={{ flexGrow: row.route.trajectory.durationS }} title={routeLabel(row.route, routes)}>{index + 1}</span>
          </div>)}
        </div>
      </div>}
      {timing && <p className="auto-sequence-timing-warning"><Icon name="warning" size={14} /><span>{t('sequence.overAuto', { t: timing.finishS.toFixed(2), auto: timing.autoPeriodS })}</span></p>}
      <p className="auto-sequence-clock" id={`${uid}-clock`}>{t('sequence.clock')}</p>
      <ol className="auto-sequence-list" ref={listRef}>
        {rows.map((row, index) => {
          const previousEndS = rows[index - 1]?.endS ?? 0;
          const startId = `${uid}-start-${row.id}`;
          const seamIssues = joins.filter((issue) => issue.fromIndex === index - 1);
          return <li key={row.id}>
            {(index > 0 || row.waitBeforeS > 0) && <div className="auto-sequence-join">
              <span>{row.waitBeforeS > 0
                ? <>{index === 0 ? t('sequence.delay') : t('sequence.wait')} <bdi>{row.waitBeforeS.toFixed(2)}</bdi> {t('sequence.seconds')}</>
                : t('sequence.immediate')}</span>
              {index > 0 && (seamIssues.length === 0
                ? <span className="auto-sequence-join-status auto-sequence-join-ok"><Icon name="check" size={12} />{t('sequence.joinOk')}</span>
                : <button type="button" className="auto-sequence-join-status auto-sequence-join-bad" title={t('checks.jump')}
                    onClick={() => onJump?.(seamIssues[0]!.seamT)}>
                    <Icon name="warning" size={12} />{seamIssues.map((issue) => <span key={issue.kind}>{joinDetail(issue)}</span>)}
                  </button>)}
            </div>}
            <div className="auto-sequence-route-row">
              <span className="auto-sequence-number" aria-hidden="true">{index + 1}</span>
              <select aria-label={`${t('sequence.route')} ${index + 1}`} value={row.routeId} title={row.route.relPath} onChange={(event) => patch(row.id, { routeId: event.target.value })}>
                {routes.map((route) => <option key={route.id} value={route.id}>{routeLabel(route, routes)}</option>)}
              </select>
              <button className="auto-sequence-icon" type="button" title={t('sequence.remove')} aria-label={`${t('sequence.remove')} ${index + 1}`} onClick={() => remove(row.id, index)}><Icon name="close" size={14} /></button>
            </div>
            <div className="auto-sequence-time-row">
              <div className="auto-sequence-time-cell">
                <label htmlFor={startId}>{t('sequence.start')} <span>({t('sequence.seconds')})</span></label>
                <StartTimeInput key={`${row.startS}:${previousEndS}`} id={startId} label={`${t('sequence.start')} ${index + 1}`} value={row.startS} min={previousEndS} descriptionId={`${uid}-clock`} onCommit={(startS) => patch(row.id, { waitBeforeS: startS - previousEndS })} />
              </div>
              <div className="auto-sequence-time-cell auto-sequence-end">
                <span>{t('sequence.end')} <span>({t('sequence.seconds')})</span></span>
                <output aria-label={`${t('sequence.end')} ${index + 1}`}><bdi>{row.endS.toFixed(2)}</bdi></output>
              </div>
              <div className="auto-sequence-order">
                <button type="button" className="auto-sequence-icon" disabled={index === 0} title={t('sequence.up')} aria-label={`${t('sequence.up')} ${index + 1}`} onClick={() => move(index, -1)}><Arrow direction="up" /></button>
                <button type="button" className="auto-sequence-icon" disabled={index === rows.length - 1} title={t('sequence.down')} aria-label={`${t('sequence.down')} ${index + 1}`} onClick={() => move(index, 1)}><Arrow direction="down" /></button>
              </div>
            </div>
          </li>;
        })}
      </ol>
      {rows.length === 0 && <p className="auto-sequence-empty">{t('sequence.empty')}</p>}
      <button ref={addRef} type="button" className="auto-sequence-add" onClick={add} disabled={routes.length === 0}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
        {t('sequence.add')}
      </button>
      <p className="auto-sequence-help">{t('sequence.moves')}</p>
      {routes.length < 2 && <p className="auto-sequence-help">{t('sequence.oneRoute')}</p>}
      {rows.length > 1 && joins.length > 0 && <p className="auto-sequence-join-note"><Icon name="warning" size={14} /><span>{t('sequence.joinFix')}</span></p>}
    </section>
  );
}

function StartTimeInput({ id, label, value, min, descriptionId, onCommit }: {
  id: string; label: string; value: number; min: number; descriptionId: string; onCommit: (value: number) => void;
}) {
  const { t } = useI18n();
  // Never render a rounded-down value below the native input's minimum.
  const formatted = Number(value.toFixed(2)) < min ? String(value) : value.toFixed(2);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState('');
  function commit() {
    // A rounded, untouched display is not a new timestamp. Preserve the
    // exact imported precision, including sub-centisecond route endings.
    if (draft === formatted) { setError(''); return; }
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) { setError(t('sequence.invalid')); return; }
    if (parsed < min) { setError(t('sequence.earliest', { time: String(min) })); return; }
    setError('');
    setDraft(Number(parsed.toFixed(2)) < min ? String(parsed) : parsed.toFixed(2));
    if (parsed !== value) onCommit(parsed);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { setDraft(formatted); setError(''); }
  }
  return <>
    <input id={id} type="number" inputMode="decimal" min={min} step="any" value={draft} aria-label={label}
      aria-invalid={!!error} aria-describedby={error ? `${id}-error` : descriptionId}
      onFocus={() => { if (!error && draft === formatted) setDraft(String(value)); }}
      onChange={(event) => { setDraft(event.target.value); setError(''); }} onBlur={commit} onKeyDown={keyDown} />
    {error && <span className="auto-sequence-error" role="alert" id={`${id}-error`}>{error}</span>}
  </>;
}

function Arrow({ direction }: { direction: 'up' | 'down' }) {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'up' ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'} /></svg>;
}

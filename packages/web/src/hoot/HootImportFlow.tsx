/**
 * Desktop .hoot conversion flow (2026-11, HOOT desktop import): status →
 * EULA consent → official owlet download (Channel progress) → per-file
 * convert. Converted products re-enter the existing WPILOG import pipeline
 * with their original directories and `{stem}.wpilog` names; the raw .hoot
 * stays in App's original-file store from the moment it was imported. This
 * flow only orchestrates the desktop commands — it never claims the bytes
 * are a valid log: inspection failures stay the WPILOG dialog's to report
 * (`wpilog.inspectFailed`). Cancel (the "Not now" button, Escape or the
 * overlay) is quiet: it stops the pipeline and reports nothing.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { probeHootFile } from '@pathblender/core';
import { Dialog } from '../components/Dialog';
import { useI18n, type TFunc } from '../i18n';
import {
  hootAcceptEula,
  hootConvert,
  hootDownloadOwlet,
  hootErrorCode,
  hootStatus,
  type DownloadProgress,
  type HootStatus,
} from './client';
import './HootImportFlow.css';

/**
 * CTRE's own terms page, opened in the system browser via `open_external`
 * (whitelist prefix `https://www.ctr-electronics.com/`). Pinned 2026-11-07:
 * the Phoenix 6 documentation (v6.docs.ctr-electronics.com, search index
 * checked) carries no license/EULA page at all, and the canonical
 * CTRE_LICENSE.txt lives in CrossTheRoadElec's GitHub distribution — outside
 * the open_external whitelist. The dialog links CTRE's official terms and
 * reproduces no license text.
 */
export const CTRE_EULA_URL = 'https://www.ctr-electronics.com/policies/terms-of-service';

export interface HootImportFlowProps {
  files: Array<{ file: File; relPath: string }>;
  onConverted: (files: Array<{ relPath: string; file: File }>) => void;
  onFailures: (failures: Array<{ relPath: string; message: string }>) => void;
  onCancel: () => void;
}

type Phase = 'loading' | 'eula' | 'downloading' | 'converting';

/** Let the desktop shell open the system browser; preserve native links on web. */
function openCtreTerms(event: { preventDefault: () => void }): void {
  if (!('__TAURI_INTERNALS__' in window || ['tauri:', 'asset:'].includes(location.protocol))) return;
  event.preventDefault();
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('open_external', { url: CTRE_EULA_URL }))
    .catch(() => { window.open(CTRE_EULA_URL, '_blank', 'noopener,noreferrer'); });
}

/** Per ledger R3 the transport keeps base64; this side owns the decode. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function errorText(err: unknown): string {
  return typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
}

/**
 * Map a command rejection to user copy: known hoot codes get their i18n key
 * (convert failures carry the converter's detail after the code), anything
 * else falls back to the raw text.
 */
function convertFailureMessage(tr: TFunc, name: string, err: unknown): string {
  const raw = errorText(err);
  const code = hootErrorCode(err);
  if (code === 'hoot-convert-failed') {
    const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
    return tr('hoot.convertFailed', { name, message: detail });
  }
  if (code === 'hoot-owlet-missing') return tr('hoot.owletMissing');
  return raw;
}

function stageFailureMessage(tr: TFunc, err: unknown): string {
  return hootErrorCode(err) === 'hoot-owlet-missing' ? tr('hoot.owletMissing') : errorText(err);
}

export function HootImportFlow({ files, onConverted, onFailures, onCancel }: HootImportFlowProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('loading');
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [convertingName, setConvertingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);
  const onConvertedRef = useRef(onConverted);
  onConvertedRef.current = onConverted;
  const onFailuresRef = useRef(onFailures);
  onFailuresRef.current = onFailures;
  const filesRef = useRef(files);
  filesRef.current = files;
  const barId = useId();

  /** Sequential per-file conversion; partial failures never drop successes. */
  const convertAll = async (status: HootStatus): Promise<void> => {
    const converted: Array<{ relPath: string; file: File }> = [];
    const failures: Array<{ relPath: string; message: string }> = [];
    for (const { file, relPath } of filesRef.current) {
      if (cancelledRef.current) return;
      setConvertingName(file.name);
      // Re-probe for the compliancy value (Task 7's gate already routed here).
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (cancelledRef.current) return;
      const probe = probeHootFile(bytes);
      if (probe.kind === 'rejected') {
        failures.push({
          relPath,
          message: probe.reason === 'compliancy-too-old' ? t('hoot.tooOld', { v: probe.compliancy! }) : t('hoot.truncated'),
        });
        continue;
      }
      if (status.compliancy != null && probe.compliancy > status.compliancy) {
        failures.push({ relPath, message: t('hoot.newerThanConverter') });
        continue;
      }
      try {
        const product = await hootConvert(file.name, bytes);
        if (cancelledRef.current) return;
        // {stem}.wpilog under the file's original directory.
        const name = `${file.name.replace(/\.hoot$/i, '')}.wpilog`;
        const slash = relPath.lastIndexOf('/');
        converted.push({
          relPath: slash >= 0 ? `${relPath.slice(0, slash + 1)}${name}` : name,
          file: new File([base64ToBytes(product.wpilogBase64)], name),
        });
      } catch (err) {
        failures.push({ relPath, message: convertFailureMessage(t, file.name, err) });
      }
    }
    if (cancelledRef.current) return;
    if (converted.length > 0) onConvertedRef.current(converted);
    if (failures.length > 0) onFailuresRef.current(failures);
  };

  /** Download (unless already in place), then convert. */
  const downloadAndConvert = async (status: HootStatus): Promise<void> => {
    let current = status;
    if (!current.downloaded) {
      setPhase('downloading');
      const onProgress = (p: DownloadProgress) => {
        setProgressPct(p.total > 0 ? Math.floor((p.downloaded / p.total) * 100) : null);
      };
      current = await hootDownloadOwlet(onProgress);
      if (cancelledRef.current) return;
    }
    setPhase('converting');
    await convertAll(current);
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const status = await hootStatus();
        if (cancelledRef.current) return;
        if (!status.eulaAccepted) {
          setPhase('eula');
          return;
        }
        await downloadAndConvert(status);
      } catch (err) {
        if (!cancelledRef.current) setError(stageFailureMessage(t, err));
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
    // The flow runs exactly once per mount; later phases live in handlers.
  }, []);

  /** Consent and continue: accept → download with progress → convert. */
  const onAgree = (): void => {
    void (async () => {
      try {
        setPhase('downloading');
        const status = await hootAcceptEula();
        if (cancelledRef.current) return;
        await downloadAndConvert(status);
      } catch (err) {
        if (!cancelledRef.current) setError(stageFailureMessage(t, err));
      }
    })();
  };

  return <Dialog title={t('hoot.title')} onClose={onCancel} className="hoot-dialog">
    <div className="hoot-body">
      {error != null && <p className="hoot-error" role="alert">{error}</p>}
      {phase === 'eula' && <>
        <h3>{t('hoot.eulaTitle')}</h3>
        <p>{t('hoot.eulaBody')}</p>
        <p><a href={CTRE_EULA_URL} onClick={openCtreTerms}>{t('hoot.eulaLink')}</a></p>
        <div className="hoot-actions">
          <button type="button" className="btn" onClick={onCancel}>{t('hoot.eulaDecline')}</button>
          <button type="button" className="btn accent" onClick={onAgree}>{t('hoot.eulaAgree')}</button>
        </div>
      </>}
      {(phase === 'downloading' || phase === 'converting') && (
        <p className="hoot-progress">
          <label htmlFor={barId}>
            {phase === 'downloading' ? t('hoot.downloading', { pct: progressPct ?? 0 }) : t('hoot.converting', { name: convertingName })}
          </label>
          {/* value omitted while no fraction is known (converting, total 0,
              or before the first event) — the native element renders
              indeterminate. */}
          <progress id={barId} value={phase === 'downloading' ? (progressPct ?? undefined) : undefined} max={100} />
        </p>
      )}
    </div>
  </Dialog>;
}

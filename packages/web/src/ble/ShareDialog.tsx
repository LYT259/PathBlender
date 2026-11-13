/**
 * Nearby-share dialog (2026-11 BLE plan, Task 11): the only UI over the pure-
 * Bluetooth exchange. Pick a role → send (files → scan → device → SAS →
 * progress → summary) or receive (advertising → SAS → per-file Accept/Reject
 * → progress → handoff). Received files leave exclusively through
 * `onReceived` — App wraps them in `new File` for the ordinary importFiles
 * pipeline, so BLE never opens a second import path. Every terminal state
 * keeps a Close button, and any close — button, Escape, overlay, unmount —
 * cancels the desktop session. The web shell runs no BLE command at all: the
 * host check happens before the first invoke (see ble/client.ts header for
 * why a non-Tauri host must not even try).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { useI18n, type TFunc } from '../i18n';
import {
  bleCancel,
  bleCapabilities,
  bleConfirmSession,
  bleErrorCode,
  bleRespondFile,
  bleSendFiles,
  bleStartReceiver,
  bleStartScan,
  bleStopScan,
  bleTakeReceivedFiles,
  type BleCapabilities,
  type BleEvent,
  type BlePeer,
} from './client';
import './ShareDialog.css';

export interface ShareDialogProps {
  onClose: () => void;
  onReceived: (files: Array<{ name: string; data: Uint8Array }>) => void;
}

/** Same host test as App.tsx's IS_DESKTOP, read live so the gate reflects
 *  the window at mount instead of the module's import time. */
const isDesktopHost = () =>
  '__TAURI_INTERNALS__' in window || location.protocol === 'tauri:' || location.protocol === 'asset:';

/** Mirrors the Rust ShareLimits::max_file_bytes cap (commands.rs). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Mode =
  | { kind: 'checking' }
  | { kind: 'unsupported'; why: 'web' | 'platform' }
  | { kind: 'pick' }
  | { kind: 'scan'; devices: BlePeer[] }
  | { kind: 'advertising' }
  | { kind: 'connecting' }
  | { kind: 'sas'; code: string }
  | { kind: 'waiting' }
  | { kind: 'transferring'; pct: number | null }
  | { kind: 'fileAsk'; fileIndex: number; name: string; size: number }
  | { kind: 'summary'; ok: number; fail: number }
  | { kind: 'error'; text: string };

/** Screens the flow never leaves: later events are noise, not news. */
const isTerminal = (m: Mode): boolean =>
  m.kind === 'error' || m.kind === 'summary' || m.kind === 'unsupported';

/** Wire error code → user copy; unknown codes keep their raw name. */
function failureText(t: TFunc, code: string | null): string {
  if (code === 'ble-disconnected') return t('ble.disconnected');
  if (code === 'ble-cancelled') return t('ble.cancelled');
  if (code === 'ble-bluetooth-off') return t('ble.bluetoothOff');
  if (code === 'ble-unsupported-platform') return t('ble.unsupportedPlatform');
  return t('ble.failed', { code: code ?? 'unknown' });
}

function formatSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function ShareDialog({ onClose, onReceived }: ShareDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>({ kind: 'checking' });
  const [caps, setCaps] = useState<BleCapabilities | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; data: Uint8Array }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const barId = useId();
  /** Latched by the user actions that spawn a desktop session (receive
   *  start, device pick) — the flow has no path back to the pick screen, so
   *  it never resets. Button-level guards on later steps (SAS confirm, file
   *  respond) rely on their mode transition instead. */
  const startedRef = useRef(false);
  /** True from the moment the dialog is closed or unmounted: events and
   *  async continuations after it must stay silent (no onReceived, no state
   *  writes). The mount effect re-arms it so StrictMode's remount survives. */
  const closedRef = useRef(false);
  const deliveredRef = useRef(false);
  const roleRef = useRef<'send' | 'receive'>('send');
  const filesRef = useRef(files);
  filesRef.current = files;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onReceivedRef = useRef(onReceived);
  onReceivedRef.current = onReceived;

  const fail = (err: unknown) => {
    if (closedRef.current) return;
    setMode((m) => isTerminal(m) ? m : { kind: 'error', text: failureText(t, bleErrorCode(err)) });
  };
  const failRef = useRef(fail);
  failRef.current = fail;

  const handleEvent = (e: BleEvent) => {
    if (closedRef.current) return;
    switch (e.kind) {
      case 'discovered':
        setMode((m) => m.kind === 'scan' ? { ...m, devices: e.devices } : m);
        return;
      case 'sasCode':
        setMode((m) => isTerminal(m) ? m : { kind: 'sas', code: e.code });
        return;
      case 'confirmed':
        setMode((m) => isTerminal(m) ? m : { kind: 'transferring', pct: null });
        return;
      case 'progress':
        setMode((m) => m.kind === 'transferring'
          ? { ...m, pct: e.total > 0 ? Math.floor((e.sent / e.total) * 100) : null }
          : m);
        return;
      case 'fileRequest':
        setMode((m) => isTerminal(m) ? m : { kind: 'fileAsk', fileIndex: e.fileIndex, name: e.name, size: e.size });
        return;
      case 'failed':
        setMode((m) => isTerminal(m) ? m : { kind: 'error', text: failureText(t, e.code) });
        return;
      case 'cancelled':
        setMode((m) => isTerminal(m) ? m : { kind: 'error', text: t('ble.cancelled') });
        return;
      case 'disconnected':
        setMode((m) => isTerminal(m) ? m : { kind: 'error', text: t('ble.disconnected') });
        return;
      case 'done':
        setMode((m) => isTerminal(m) ? m : { kind: 'summary', ok: e.okCount, fail: e.failCount });
        if (roleRef.current === 'receive' && e.okCount > 0 && !deliveredRef.current) {
          deliveredRef.current = true;
          void bleTakeReceivedFiles()
            .then((received) => { if (!closedRef.current) onReceivedRef.current(received); })
            .catch((err) => failRef.current(err));
        }
        return;
      default:
        // hello/fileResult/fileVerified/confirmPending/capabilities carry no
        // dialog step of their own; the summary and error screens above are
        // the user-visible outcomes.
        return;
    }
  };
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;
  /** Handed to the client once per session; routes to the fresh handler. */
  const sessionSink = (e: BleEvent) => { handleEventRef.current(e); };

  useEffect(() => {
    closedRef.current = false;
    if (!isDesktopHost()) {
      setMode({ kind: 'unsupported', why: 'web' });
      return;
    }
    let alive = true;
    bleCapabilities()
      .then((caps) => {
        if (!alive || closedRef.current) return;
        if (!caps.platformSupported) setMode({ kind: 'unsupported', why: 'platform' });
        else {
          setCaps(caps);
          setMode({ kind: 'pick' });
        }
      })
      .catch((err) => { if (alive) failRef.current(err); });
    return () => {
      alive = false;
      if (closedRef.current) return;
      closedRef.current = true;
      void bleCancel().catch(() => undefined);
    };
  }, []);

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (isDesktopHost()) void bleCancel().catch(() => undefined);
    onCloseRef.current();
  };

  const onSendFiles = async (list: File[]) => {
    if (!list.length) return;
    if (list.some((f) => f.size > MAX_FILE_BYTES)) {
      setMode({ kind: 'error', text: t('ble.tooLarge') });
      return;
    }
    const payload: Array<{ name: string; data: Uint8Array }> = [];
    for (const f of list) payload.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    if (closedRef.current) return;
    setFiles(payload);
    roleRef.current = 'send';
    setMode({ kind: 'scan', devices: [] });
    try {
      await bleStartScan(sessionSink);
    } catch (err) {
      failRef.current(err);
    }
  };

  const pickDevice = (deviceId: string) => {
    if (mode.kind !== 'scan' || startedRef.current) return;
    startedRef.current = true;
    setMode({ kind: 'connecting' });
    void (async () => {
      try {
        await bleStopScan();
      } catch {
        // The scan is being abandoned either way; bleSendFiles below owns
        // the real failure surface.
      }
      try {
        await bleSendFiles(deviceId, filesRef.current, sessionSink);
      } catch (err) {
        failRef.current(err);
      }
    })();
  };

  const stopScan = () => {
    setMode({ kind: 'pick' });
    void bleStopScan().catch(failRef.current);
  };

  const startReceive = () => {
    if (mode.kind !== 'pick' || startedRef.current) return;
    startedRef.current = true;
    roleRef.current = 'receive';
    setMode({ kind: 'advertising' });
    void bleStartReceiver(sessionSink).catch(failRef.current);
  };

  const confirmSas = (accepted: boolean) => {
    if (mode.kind !== 'sas') return;
    setMode(accepted ? { kind: 'waiting' } : { kind: 'error', text: t('ble.cancelled') });
    void bleConfirmSession(accepted).catch(failRef.current);
  };

  const respond = (accepted: boolean) => {
    if (mode.kind !== 'fileAsk') return;
    const fileIndex = mode.fileIndex;
    setMode({ kind: 'transferring', pct: null });
    void bleRespondFile(fileIndex, accepted).catch(failRef.current);
  };

  const unsupportedText = mode.kind === 'unsupported' && mode.why === 'web' ? t('ble.webUnsupported') : t('ble.unsupportedPlatform');

  return <Dialog title={t('ble.title')} onClose={close} className="ble-share-dialog">
    <div className="ble-share-body">
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => {
        const list = Array.from(e.currentTarget.files ?? []);
        try {
          e.currentTarget.value = '';
        } catch {
          // Some engines refuse a value write on a file input; the picker
          // keeps its selection and the read below already holds the files.
        }
        if (list.length) void onSendFiles(list);
      }} />
      {mode.kind === 'unsupported' && <>
        <p className="ble-share-error" role="status">{unsupportedText}</p>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={close}>{t('ble.close')}</button>
        </div>
      </>}
      {mode.kind === 'pick' && <>
        {caps?.centralPowered === false && <p className="ble-share-hint" role="status">{t('ble.bluetoothOff')}</p>}
        <div className="ble-share-actions">
          <button type="button" className="btn accent" onClick={() => fileInputRef.current?.click()}>{t('ble.send')}</button>
          <button type="button" className="btn" disabled={caps?.peripheralPowered === false} onClick={startReceive}>{t('ble.receive')}</button>
        </div>
        {caps?.peripheralPowered === false && <p className="ble-share-hint" role="status">{t('ble.peripheralOff')}</p>}
      </>}
      {mode.kind === 'scan' && <>
        <p role="status">{t('ble.scanning')}</p>
        {mode.devices.length === 0 && <p className="ble-share-hint">{t('ble.scanningEmpty')}</p>}
        <div className="ble-share-devices">
          {mode.devices.map((d) => (
            <button type="button" key={d.id} className="btn" onClick={() => pickDevice(d.id)}>{d.label}</button>
          ))}
        </div>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={stopScan}>{t('ble.stopScan')}</button>
        </div>
      </>}
      {mode.kind === 'advertising' && <p role="status">{t('ble.receive')}</p>}
      {mode.kind === 'connecting' && <p role="status">{t('ble.connecting')}</p>}
      {mode.kind === 'sas' && <>
        <h3 className="ble-share-heading">{t('ble.sasTitle')}</h3>
        <p>{t('ble.sasBody', { code: mode.code })}</p>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={() => confirmSas(false)}>{t('ble.sasDiffer')}</button>
          <button type="button" className="btn accent" onClick={() => confirmSas(true)}>{t('ble.sasMatch')}</button>
        </div>
      </>}
      {mode.kind === 'waiting' && <p role="status">{t('ble.waitingPeer')}</p>}
      {mode.kind === 'transferring' && (
        <p className="ble-share-progress">
          <label htmlFor={barId}>{t('ble.progress', { pct: mode.pct ?? 0 })}</label>
          {/* value omitted until a fraction is known — the native element
              renders indeterminate, as in the HOOT download progress. */}
          <progress id={barId} value={mode.pct ?? undefined} max={100} />
        </p>
      )}
      {mode.kind === 'fileAsk' && <>
        <p>{t('ble.incoming', { name: mode.name, size: formatSize(mode.size) })}</p>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={() => respond(false)}>{t('ble.reject')}</button>
          <button type="button" className="btn accent" onClick={() => respond(true)}>{t('ble.accept')}</button>
        </div>
      </>}
      {mode.kind === 'summary' && <>
        <p role="status">{t('ble.summary', { ok: mode.ok, fail: mode.fail })}</p>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={close}>{t('ble.close')}</button>
        </div>
      </>}
      {mode.kind === 'error' && <>
        <p className="ble-share-error" role="alert">{mode.text}</p>
        <div className="ble-share-actions">
          <button type="button" className="btn" onClick={close}>{t('ble.close')}</button>
        </div>
      </>}
    </div>
  </Dialog>;
}

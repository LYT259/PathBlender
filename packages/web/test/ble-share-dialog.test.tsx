/**
 * ShareDialog contract (Task 11): the pure-BLE nearby-share flow — host
 * gating (web shell never invokes a command), send chain (files → scan →
 * device → SAS → confirm → progress → summary), receive chain (advertising →
 * SAS → per-file Accept/Reject → progress → handoff via onReceived only),
 * error surfacing (failed events map their ble-… code, command rejections
 * are never swallowed), and cancellation on every close path. The client
 * module is mocked (wire contract pinned in ble-client.test.ts); pure
 * bleErrorCode stays real because the dialog's error mapping IS the behavior
 * under test. App's wiring (File → Share nearby) reuses these props
 * verbatim; onReceived hands `{name, data}` to App, which wraps them in
 * `new File` for the ordinary importFiles pipeline.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import type { BleCapabilities, BleEvent } from '../src/ble/client';

vi.mock('../src/ble/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ble/client')>();
  return {
    ...actual,
    bleCapabilities: vi.fn(),
    bleStartScan: vi.fn(),
    bleStopScan: vi.fn(),
    bleSendFiles: vi.fn(),
    bleStartReceiver: vi.fn(),
    bleConfirmSession: vi.fn(),
    bleRespondFile: vi.fn(),
    bleTakeReceivedFiles: vi.fn(),
    bleCancel: vi.fn(),
  };
});

import {
  bleCancel,
  bleCapabilities,
  bleConfirmSession,
  bleRespondFile,
  bleSendFiles,
  bleStartReceiver,
  bleStartScan,
  bleStopScan,
  bleTakeReceivedFiles,
} from '../src/ble/client';
import { ShareDialog } from '../src/ble/ShareDialog';

const CAPS_OK: BleCapabilities = { platformSupported: true, centralPowered: true, peripheralPowered: true };
const MAX = 2 * 1024 * 1024;

/** The dialog reads the host lazily, so the flag toggles per test. */
function setDesktop(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

/** Hand the hidden picker input a FileList-shaped result, as the engine does. */
function pickFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true });
  fireEvent.change(input);
}

/** Deliver a wire event inside act so the dialog's state updates flush
 *  before the assertions that read the new screen. */
function deliver(sink: (e: BleEvent) => void, e: BleEvent) {
  act(() => { sink(e); });
}

function renderDialog() {
  const onClose = vi.fn();
  const onReceived = vi.fn();
  const view = render(<I18nProvider><ShareDialog onClose={onClose} onReceived={onReceived} /></I18nProvider>);
  return { onClose, onReceived, view };
}

beforeEach(() => {
  // Command mocks default to resolved promises — handlers chain .catch on
  // every call, so an undefined return would crash instead of rejecting.
  for (const fn of [bleCapabilities, bleStartScan, bleStopScan, bleSendFiles, bleStartReceiver, bleConfirmSession, bleRespondFile, bleCancel]) {
    vi.mocked(fn).mockResolvedValue(undefined);
  }
  vi.mocked(bleTakeReceivedFiles).mockResolvedValue([]);
});

afterEach(() => {
  // Unmount BEFORE clearing: the dialog's unmount cleanup must not leak a
  // bleCancel call into the next test's zero-call assertions.
  cleanup();
  vi.clearAllMocks();
  setDesktop(false);
});

describe('ShareDialog', () => {
  it('web shell: desktop-only notice and zero BLE commands, even after unmount', async () => {
    setDesktop(false);
    renderDialog();
    expect(await screen.findByText('Nearby share runs in the PathBlender desktop app. On the web, exchange files with a USB drive instead.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(bleCapabilities).not.toHaveBeenCalled();
    expect(bleCancel).not.toHaveBeenCalled();
    expect(bleStartScan).not.toHaveBeenCalled();
    expect(bleSendFiles).not.toHaveBeenCalled();
  });

  it('desktop on an unsupported platform (Linux): platform notice, never the web one', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue({ platformSupported: false, centralPowered: null, peripheralPowered: null });
    renderDialog();
    expect(await screen.findByText('Nearby share is available on the macOS and Windows desktop apps.')).toBeTruthy();
    expect(screen.queryByText(/desktop app\. On the web/)).toBeNull();
    expect(bleStartScan).not.toHaveBeenCalled();
    expect(bleStartReceiver).not.toHaveBeenCalled();
  });

  it('send chain: files → scan → device → SAS → confirm → progress → summary', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let scanEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartScan).mockImplementation((cb) => { scanEvents = cb; return Promise.resolve(); });
    let sendEvents!: (e: BleEvent) => void;
    vi.mocked(bleSendFiles).mockImplementation((_deviceId, _files, cb) => { sendEvents = cb; return Promise.resolve(); });
    const { onReceived } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Send files' }));
    pickFiles([new File(['abc'], 'auto.traj'), new File(['de'], 'two.traj')]);
    await waitFor(() => expect(bleStartScan).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Searching for nearby PathBlender devices…')).toBeTruthy();

    deliver(scanEvents, { kind: 'discovered', devices: [{ id: 'AB:CD:EF:01:02:03', label: 'PathBlender 0.1.10-beta.17' }] });
    fireEvent.click(await screen.findByRole('button', { name: 'PathBlender 0.1.10-beta.17' }));

    await waitFor(() => expect(bleSendFiles).toHaveBeenCalledTimes(1));
    expect(bleStopScan).toHaveBeenCalledTimes(1);
    const [deviceId, files] = vi.mocked(bleSendFiles).mock.calls[0]!;
    expect(deviceId).toBe('AB:CD:EF:01:02:03');
    expect(files).toEqual([
      { name: 'auto.traj', data: new Uint8Array([97, 98, 99]) },
      { name: 'two.traj', data: new Uint8Array([100, 101]) },
    ]);
    expect(screen.getByText('Connecting…')).toBeTruthy();

    deliver(sendEvents, { kind: 'sasCode', code: '042317' });
    expect(screen.getByText(/042317/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    expect(bleConfirmSession).toHaveBeenCalledWith(true);
    expect(screen.getByText('Waiting for the other side to confirm…')).toBeTruthy();

    deliver(sendEvents, { kind: 'confirmed' });
    const start = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(start.hasAttribute('value')).toBe(false); // no fraction yet: indeterminate
    deliver(sendEvents, { kind: 'progress', fileIndex: 0, sent: 512, total: 1024 });
    expect(screen.getByText('Transferring… 50%')).toBeTruthy();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(50);

    deliver(sendEvents, { kind: 'done', okCount: 2, failCount: 0 });
    expect(screen.getByText('Done: 2 sent, 0 failed.')).toBeTruthy();
    expect(onReceived).not.toHaveBeenCalled(); // sender: no import handoff
  });

  it('receive chain: accept → sanitized name and bytes handed to onReceived only', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    // The typed client lifts serde's number arrays to Uint8Array before this
    // layer sees them (pinned in ble-client.test.ts), so the stub speaks the
    // converted shape.
    vi.mocked(bleTakeReceivedFiles).mockResolvedValue([{ name: 'evil.traj', data: new Uint8Array([7, 8, 9]) }]);
    const { onClose, onReceived } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    await waitFor(() => expect(bleStartReceiver).toHaveBeenCalledTimes(1));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    deliver(recvEvents, { kind: 'confirmed' });
    deliver(recvEvents, { kind: 'fileRequest', fileIndex: 3, name: 'evil.traj', size: 3 });
    expect(screen.getByText('“evil.traj” (3 B) wants to send a file. Accept?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(bleRespondFile).toHaveBeenCalledWith(3, true);
    deliver(recvEvents, { kind: 'progress', fileIndex: 3, sent: 3, total: 3 });
    expect(screen.getByText('Transferring… 100%')).toBeTruthy();

    deliver(recvEvents, { kind: 'done', okCount: 1, failCount: 0 });
    await waitFor(() => expect(onReceived).toHaveBeenCalledTimes(1));
    expect(onReceived).toHaveBeenCalledWith([{ name: 'evil.traj', data: new Uint8Array([7, 8, 9]) }]);
    expect(bleTakeReceivedFiles).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // closing is App's job on handoff
  });

  it('receive chain: rejecting the file answers and never hands off', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    const { onReceived } = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    deliver(recvEvents, { kind: 'confirmed' });
    deliver(recvEvents, { kind: 'fileRequest', fileIndex: 3, name: 'auto.traj', size: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(bleRespondFile).toHaveBeenCalledWith(3, false);
    deliver(recvEvents, { kind: 'done', okCount: 0, failCount: 1 });
    expect(screen.getByText('Done: 0 sent, 1 failed.')).toBeTruthy();
    expect(onReceived).not.toHaveBeenCalled();
    expect(bleTakeReceivedFiles).not.toHaveBeenCalled();
  });

  it('failed event maps its code to user copy; Close cancels and dismisses', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    const { onClose } = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'failed', code: 'ble-disconnected', detail: 'gatt went away' });
    expect(screen.getByText('The other device disconnected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(bleCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('oversized local files are refused before any transfer starts', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Send files' }));
    pickFiles([new File([new Uint8Array(512)], 'ok.traj'), new File([new Uint8Array(MAX + 1)], 'huge.traj')]);
    expect(await screen.findByText('Files over 2 MB are better shared with a USB drive — Bluetooth would be too slow.')).toBeTruthy();
    expect(bleStartScan).not.toHaveBeenCalled();
    expect(bleSendFiles).not.toHaveBeenCalled();
  });

  it('a done arriving after the user closed never triggers onReceived', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    vi.mocked(bleTakeReceivedFiles).mockResolvedValue([{ name: 'auto.traj', data: [1] }]);
    const { onReceived } = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    deliver(recvEvents, { kind: 'confirmed' });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(bleCancel).toHaveBeenCalledTimes(1);
    deliver(recvEvents, { kind: 'done', okCount: 1, failCount: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onReceived).not.toHaveBeenCalled();
    expect(bleTakeReceivedFiles).not.toHaveBeenCalled();
  });

  it('unmount without a user close still cancels the session', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    vi.mocked(bleStartReceiver).mockImplementation(() => Promise.resolve());
    const { view } = renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    await waitFor(() => expect(bleStartReceiver).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(bleCancel).toHaveBeenCalledTimes(1);
  });

  it('a confirmSession rejection surfaces as an error instead of being swallowed', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    vi.mocked(bleConfirmSession).mockRejectedValueOnce('ble-busy');
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    expect(await screen.findByText('Nearby share failed: ble-busy')).toBeTruthy();
  });

  it('a respondFile rejection surfaces as an error instead of being swallowed', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    vi.mocked(bleRespondFile).mockRejectedValueOnce('ble-busy');
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'Codes match' }));
    deliver(recvEvents, { kind: 'confirmed' });
    deliver(recvEvents, { kind: 'fileRequest', fileIndex: 0, name: 'auto.traj', size: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Nearby share failed: ble-busy')).toBeTruthy();
  });

  it('SAS mismatch answers false and lands on the cancelled screen', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    let recvEvents!: (e: BleEvent) => void;
    vi.mocked(bleStartReceiver).mockImplementation((cb) => { recvEvents = cb; return Promise.resolve(); });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Receive files' }));
    deliver(recvEvents, { kind: 'sasCode', code: '042317' });
    fireEvent.click(screen.getByRole('button', { name: 'They do not match' }));
    expect(bleConfirmSession).toHaveBeenCalledWith(false);
    expect(screen.getByText('Transfer cancelled.')).toBeTruthy();
  });

  it('double clicks start one session, not two', async () => {
    setDesktop(true);
    vi.mocked(bleCapabilities).mockResolvedValue(CAPS_OK);
    vi.mocked(bleStartReceiver).mockImplementation(() => Promise.resolve());
    renderDialog();
    const receive = await screen.findByRole('button', { name: 'Receive files' });
    fireEvent.click(receive);
    fireEvent.click(receive);
    await waitFor(() => expect(bleStartReceiver).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bleStartReceiver).toHaveBeenCalledTimes(1);
  });
});

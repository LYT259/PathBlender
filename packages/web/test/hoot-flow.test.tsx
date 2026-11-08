/**
 * HootImportFlow contract (Task 8): the desktop .hoot conversion flow —
 * status → EULA consent → official-converter download (Channel progress) →
 * per-file convert with partial failures → converted files handed to the
 * caller for the existing WPILOG pipeline. The client module is mocked
 * (invoke-level contract already pinned in hoot-client.test.ts); the pure
 * hootErrorCode stays real because the flow's error mapping IS the behavior
 * under test. Conversion products use the real wpilog sample bytes as the
 * stub payload (per ledger R3 the flow owns the base64 decode).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { HOOT_COMPLIANCY_OFFSET } from '@pathblender/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';

vi.mock('../src/hoot/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/hoot/client')>();
  return {
    ...actual,
    hootStatus: vi.fn(),
    hootAcceptEula: vi.fn(),
    hootDownloadOwlet: vi.fn(),
    hootConvert: vi.fn(),
  };
});

import {
  hootAcceptEula,
  hootConvert,
  hootDownloadOwlet,
  hootStatus,
  type DownloadProgress,
  type HootStatus,
} from '../src/hoot/client';
import { CTRE_EULA_URL, HootImportFlow } from '../src/hoot/HootImportFlow';

const SAMPLES = resolve(__dirname, '../../../samples');
/** Real DogLog/NT log bytes — the stub converter product payload. */
const FIXTURE = new Uint8Array(readFileSync(resolve(SAMPLES, 'wpilog/WPILIB_TBD_aba74b981a582b4b.wpilog')));

// Hand-written status literals, field-for-field the serde camelCase wire shape.
const NOT_ACCEPTED: HootStatus = { eulaAccepted: false, downloaded: false, version: null, compliancy: 9 };
const ACCEPTED_NOT_DOWNLOADED: HootStatus = { eulaAccepted: true, downloaded: false, version: '25.0.1', compliancy: 9 };
const READY: HootStatus = { eulaAccepted: true, downloaded: true, version: '25.0.1', compliancy: 10 };
/** Converter compliancy equal to the logs' — supported, must still convert. */
const DOWNLOADED_SAME_COMPLIANCY: HootStatus = { eulaAccepted: true, downloaded: true, version: '25.0.1', compliancy: 9 };

/** Synthetic .hoot stub (zero bytes, compliancy byte set) with a drop path. */
function hootStub(name: string, compliancy: number, relPath: string): { file: File; relPath: string } {
  const bytes = new Uint8Array(HOOT_COMPLIANCY_OFFSET + 1);
  bytes[HOOT_COMPLIANCY_OFFSET] = compliancy;
  return { file: new File([bytes], name), relPath };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function renderFlow(
  files: Array<{ file: File; relPath: string }>,
  handlers: {
    onConverted?: (files: Array<{ relPath: string; file: File }>) => void;
    onFailures?: (failures: Array<{ relPath: string; message: string }>) => void;
    onCancel?: () => void;
  } = {},
) {
  const onConverted = vi.fn(handlers.onConverted);
  const onFailures = vi.fn(handlers.onFailures);
  const onCancel = vi.fn(handlers.onCancel);
  render(<I18nProvider><HootImportFlow files={files} onConverted={onConverted} onFailures={onFailures} onCancel={onCancel} /></I18nProvider>);
  return { onConverted, onFailures, onCancel };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('HootImportFlow', () => {
  it('shows the EULA step first, then accept → download with progress → convert → {stem}.wpilog product', async () => {
    vi.mocked(hootStatus).mockResolvedValue(NOT_ACCEPTED);
    vi.mocked(hootAcceptEula).mockResolvedValue(ACCEPTED_NOT_DOWNLOADED);
    let releaseDownload!: (status: HootStatus) => void;
    let onProgress!: (p: DownloadProgress) => void;
    vi.mocked(hootDownloadOwlet).mockImplementationOnce((cb) => {
      onProgress = cb!;
      return new Promise<HootStatus>((resolve) => { releaseDownload = resolve; });
    });
    const stub = hootStub('Log.hoot', 9, 'hootdir/Log.hoot');
    vi.mocked(hootConvert).mockResolvedValue({ wpilogName: 'Log.wpilog', wpilogBase64: toBase64(FIXTURE) });
    const { onConverted, onFailures } = renderFlow([stub]);
    // EULA step: summary copy, official-terms link, and the two native buttons.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agree and download' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(screen.getByText(/downloads CTRE’s official owlet converter/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open CTRE licensing info' }) as HTMLAnchorElement;
    expect(link.href).toBe(CTRE_EULA_URL);

    fireEvent.click(screen.getByRole('button', { name: 'Agree and download' }));

    // Download step: the Channel progress callback drives the percentage and
    // the native progress element.
    await waitFor(() => expect(onProgress).toBeTruthy());
    onProgress({ downloaded: 51200, total: 102400 });
    await waitFor(() => expect(screen.getByText('Downloading official converter… 50%')).toBeTruthy());
    const bar = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(bar.value).toBe(50);

    releaseDownload(DOWNLOADED_SAME_COMPLIANCY);
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(hootAcceptEula).toHaveBeenCalledTimes(1);
    expect(hootDownloadOwlet).toHaveBeenCalledTimes(1);
    expect(hootConvert).toHaveBeenCalledTimes(1);
    expect(hootConvert).toHaveBeenCalledWith('Log.hoot', new Uint8Array(await stub.file.arrayBuffer()));
    // Strict stage order: consent, then download, then conversion.
    const order = vi.mocked(hootAcceptEula).mock.invocationCallOrder[0]!;
    expect(order).toBeLessThan(vi.mocked(hootDownloadOwlet).mock.invocationCallOrder[0]!);
    expect(vi.mocked(hootDownloadOwlet).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(hootConvert).mock.invocationCallOrder[0]!);

    const converted = onConverted.mock.calls[0]![0];
    expect(converted).toHaveLength(1);
    expect(converted[0]!.relPath).toBe('hootdir/Log.wpilog');
    expect(converted[0]!.file.name).toBe('Log.wpilog');
    expect(new Uint8Array(await converted[0]!.file.arrayBuffer())).toEqual(FIXTURE);
    expect(onFailures).not.toHaveBeenCalled();
  });

  it('reports per-file convert failures without dropping the successes', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    vi.mocked(hootConvert).mockImplementation(async (fileName: string) => {
      if (fileName === 'Bad.hoot') throw 'hoot-convert-failed:boom';
      return { wpilogName: 'Good.wpilog', wpilogBase64: toBase64(FIXTURE) };
    });
    const { onConverted, onFailures } = renderFlow([
      hootStub('Good.hoot', 9, 'a/Good.hoot'),
      hootStub('Bad.hoot', 9, 'b/Bad.hoot'),
    ]);

    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const converted = onConverted.mock.calls[0]![0];
    expect(converted.map((c) => c.relPath)).toEqual(['a/Good.wpilog']);
    expect(converted[0]!.file.name).toBe('Good.wpilog');
    expect(onFailures).toHaveBeenCalledTimes(1);
    expect(onFailures.mock.calls[0]![0]).toEqual([
      { relPath: 'b/Bad.hoot', message: 'Conversion failed for Bad.hoot: boom' },
    ]);
  });

  it('skips the EULA and download entirely when consent and converter are already in place', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    let releaseConvert!: (value: { wpilogName: string; wpilogBase64: string }) => void;
    vi.mocked(hootConvert).mockImplementationOnce(() => new Promise((resolve) => { releaseConvert = resolve; }));
    const { onConverted } = renderFlow([hootStub('Log.hoot', 9, 'Log.hoot')]);

    // Straight to converting: no EULA controls, no consent/download commands.
    await waitFor(() => expect(screen.getByText('Converting Log.hoot…')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByRole('button', { name: 'Agree and download' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(hootAcceptEula).not.toHaveBeenCalled();
    expect(hootDownloadOwlet).not.toHaveBeenCalled();
    // Converting is open-ended: the native progress element stays indeterminate.
    const bar = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(bar.hasAttribute('value')).toBe(false);

    releaseConvert({ wpilogName: 'Log.wpilog', wpilogBase64: toBase64(new Uint8Array([1, 2, 3])) });
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1));
  });

  it('fails a file newer than the downloaded converter instead of converting it', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY); // compliancy 10
    const { onConverted, onFailures } = renderFlow([hootStub('New.hoot', 99, 'dir/New.hoot')]);

    await waitFor(() => expect(onFailures).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onFailures.mock.calls[0]![0]).toEqual([
      { relPath: 'dir/New.hoot', message: 'This log is newer than the downloaded converter — update PathBlender and retry.' },
    ]);
    expect(hootConvert).not.toHaveBeenCalled();
    expect(onConverted).not.toHaveBeenCalled();
  });

  it('re-probes and rejects a truncated file that reached the flow anyway', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    const truncated = new File([new Uint8Array(8)], 'Half.hoot');
    const { onConverted, onFailures } = renderFlow([{ file: truncated, relPath: 'Half.hoot' }]);

    await waitFor(() => expect(onFailures).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onFailures.mock.calls[0]![0]).toEqual([
      { relPath: 'Half.hoot', message: 'This file is too short to be a .hoot log.' },
    ]);
    expect(hootConvert).not.toHaveBeenCalled();
    expect(onConverted).not.toHaveBeenCalled();
  });

  it('hands even garbage converter output to the caller — inspection is the WPILOG dialog’s job', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    vi.mocked(hootConvert).mockResolvedValue({ wpilogName: 'junk.wpilog', wpilogBase64: toBase64(garbage) });
    const { onConverted, onFailures } = renderFlow([hootStub('junk.hoot', 9, 'junk.hoot')]);

    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const converted = onConverted.mock.calls[0]![0];
    expect(converted[0]!.file.name).toBe('junk.wpilog');
    expect(new Uint8Array(await converted[0]!.file.arrayBuffer())).toEqual(garbage);
    expect(onFailures).not.toHaveBeenCalled();
  });

  it('exits quietly on Not now: cancel only, no failure report, no conversion', async () => {
    vi.mocked(hootStatus).mockResolvedValue(NOT_ACCEPTED);
    const { onConverted, onFailures, onCancel } = renderFlow([hootStub('Log.hoot', 9, 'Log.hoot')]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConverted).not.toHaveBeenCalled();
    expect(onFailures).not.toHaveBeenCalled();
    expect(hootConvert).not.toHaveBeenCalled();
  });

  it('falls back to the raw error text when a rejection carries no known hoot code', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    vi.mocked(hootConvert).mockRejectedValue('plain failure');
    const { onConverted, onFailures } = renderFlow([hootStub('Log.hoot', 9, 'Log.hoot')]);

    await waitFor(() => expect(onFailures).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onFailures.mock.calls[0]![0]).toEqual([{ relPath: 'Log.hoot', message: 'plain failure' }]);
    expect(onConverted).not.toHaveBeenCalled();
  });

  it('StrictMode setup→cleanup→setup revives the pipeline instead of stranding it in loading', async () => {
    vi.mocked(hootStatus).mockResolvedValue(NOT_ACCEPTED);
    vi.mocked(hootAcceptEula).mockResolvedValue(ACCEPTED_NOT_DOWNLOADED);
    vi.mocked(hootDownloadOwlet).mockResolvedValue(DOWNLOADED_SAME_COMPLIANCY);
    vi.mocked(hootConvert).mockResolvedValue({ wpilogName: 'Log.wpilog', wpilogBase64: toBase64(new Uint8Array([1, 2, 3])) });
    const onConverted = vi.fn();
    render(
      <StrictMode>
        <I18nProvider>
          <HootImportFlow
            files={[hootStub('Log.hoot', 9, 'Log.hoot')]}
            onConverted={onConverted}
            onFailures={() => undefined}
            onCancel={() => undefined}
          />
        </I18nProvider>
      </StrictMode>,
    );
    // The remount simulation must actually run the status read twice, and the
    // second setup's pipeline must reach the EULA step — the first setup's
    // cleanup may poison only its own run, not the mounted component.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agree and download' })).toBeTruthy(), { timeout: 3000 });
    expect(hootStatus).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Agree and download' }));
    await waitFor(() => expect(onConverted).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // The cancelled twin never reached a mutating command — exactly one of each.
    expect(hootAcceptEula).toHaveBeenCalledTimes(1);
    expect(hootDownloadOwlet).toHaveBeenCalledTimes(1);
    expect(hootConvert).toHaveBeenCalledTimes(1);
  });

  it('a READY mount under StrictMode converts and reports exactly once — the twin dies on its own predicate', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY); // accepted + downloaded: straight to converting
    vi.mocked(hootConvert).mockResolvedValue({ wpilogName: 'Log.wpilog', wpilogBase64: toBase64(new Uint8Array([1, 2, 3])) });
    const onConverted = vi.fn();
    render(
      <StrictMode>
        <I18nProvider>
          <HootImportFlow
            files={[hootStub('Log.hoot', 9, 'Log.hoot')]}
            onConverted={onConverted}
            onFailures={() => undefined}
            onCancel={() => undefined}
          />
        </I18nProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(onConverted).toHaveBeenCalled(), { timeout: 3000 });
    // Both setups' status reads resolved; give the twin's continuation the
    // same microtask schedule before pinning the counts (20 ms settle bound,
    // as in the App gate tests).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hootConvert).toHaveBeenCalledTimes(1);
    expect(onConverted).toHaveBeenCalledTimes(1);
  });

  it('a real unmount still cancels: a convert resolving afterwards reports nothing', async () => {
    vi.mocked(hootStatus).mockResolvedValue(READY);
    let releaseConvert!: (value: { wpilogName: string; wpilogBase64: string }) => void;
    vi.mocked(hootConvert).mockImplementationOnce(() => new Promise((resolve) => { releaseConvert = resolve; }));
    const onConverted = vi.fn();
    const onFailures = vi.fn();
    const view = render(
      <I18nProvider>
        <HootImportFlow
          files={[hootStub('Log.hoot', 9, 'Log.hoot')]}
          onConverted={onConverted}
          onFailures={onFailures}
          onCancel={() => undefined}
        />
      </I18nProvider>,
    );
    await waitFor(() => expect(hootConvert).toHaveBeenCalledTimes(1), { timeout: 3000 });
    view.unmount();
    releaseConvert({ wpilogName: 'Log.wpilog', wpilogBase64: toBase64(new Uint8Array([1, 2, 3])) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onConverted).not.toHaveBeenCalled();
    expect(onFailures).not.toHaveBeenCalled();
  });
});

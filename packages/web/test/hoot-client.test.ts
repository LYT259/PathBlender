/**
 * Desktop HOOT client wire contract (packages/desktop src-tauri/src/hoot.rs):
 * the commands speak snake_case names with Tauri v2's default camelCase
 * argument mapping and reject with plain `hoot-…:detail` strings. These
 * tests pin that wire shape — a snake_case key here reproduces the silent
 * "missing required key" class of bug found with save_file on Linux
 * 2026-10-02. Per ledger R3, `wpilogBase64` stays a base64 string on this
 * side; Task 8's flow owns any decoding when it constructs the File.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  // Mirrors @tauri-apps/api Channel: the handler handed to the constructor
  // is what the runtime invokes for every IPC message on the channel.
  class FakeChannel {
    onmessage: (message: unknown) => void;
    constructor(onmessage?: (message: unknown) => void) {
      this.onmessage = onmessage ?? (() => {});
    }
  }
  return {
    invoke: vi.fn((_command: string, ..._args: unknown[]) => Promise.resolve()),
    Channel: FakeChannel,
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: native.Channel }));

import {
  hootAcceptEula,
  hootConvert,
  hootDownloadOwlet,
  hootErrorCode,
  hootStatus,
} from '../src/hoot/client';

// Hand-written wire literals — field-for-field what the Rust serde
// camelCase serializers actually emit, never built by the code under test.
const STATUS_WIRE = {
  eulaAccepted: true,
  downloaded: false,
  version: '25.0.1',
  compliancy: 9,
};

const lastCall = () => native.invoke.mock.calls.at(-1) as [string, Record<string, unknown>];

afterEach(() => {
  vi.clearAllMocks();
});

describe('hoot status commands', () => {
  it('hootStatus invokes hoot_status and resolves the payload untouched', async () => {
    native.invoke.mockResolvedValueOnce(STATUS_WIRE);
    await expect(hootStatus()).resolves.toEqual(STATUS_WIRE);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(lastCall()[0]).toBe('hoot_status');
  });

  it('hootAcceptEula invokes hoot_accept_eula and resolves the new status', async () => {
    native.invoke.mockResolvedValueOnce({ ...STATUS_WIRE, downloaded: true });
    await expect(hootAcceptEula()).resolves.toEqual({ ...STATUS_WIRE, downloaded: true });
    expect(lastCall()[0]).toBe('hoot_accept_eula');
  });
});

describe('hootConvert', () => {
  it('invokes hoot_convert with camelCase {fileName, data}; base64 passes through undecoded', async () => {
    const convertedWire = { wpilogName: 'match.wpilog', wpilogBase64: 'AAECAwQ=' };
    native.invoke.mockResolvedValueOnce(convertedWire);
    const data = new Uint8Array([0, 1, 2, 3]);
    await expect(hootConvert('match.hoot', data)).resolves.toEqual(convertedWire);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    const [command, args] = lastCall();
    expect(command).toBe('hoot_convert');
    expect(Object.keys(args).sort()).toEqual(['data', 'fileName']);
    expect(args.fileName).toBe('match.hoot');
    expect(args.data).toBeInstanceOf(Uint8Array);
    expect(args.data).toEqual(data);
  });

  it('passes command rejections through untouched for upstream error mapping', async () => {
    native.invoke.mockRejectedValueOnce('hoot-eula-required');
    await expect(hootConvert('match.hoot', new Uint8Array())).rejects.toBe('hoot-eula-required');
  });
});

describe('hootDownloadOwlet', () => {
  it('forwards Rust progress events through a Channel passed as onProgress', async () => {
    native.invoke.mockResolvedValueOnce({ ...STATUS_WIRE, downloaded: true });
    const onProgress = vi.fn();
    const done = hootDownloadOwlet(onProgress);
    const [command, args] = lastCall();
    expect(command).toBe('hoot_download_owlet');
    expect(Object.keys(args).sort()).toEqual(['onProgress']);
    // Delivering on the very channel handed to invoke is what the Tauri
    // runtime does for every progress event the Rust side sends.
    const channel = args.onProgress as InstanceType<typeof native.Channel>;
    expect(channel).toBeInstanceOf(native.Channel);
    channel.onmessage({ downloaded: 512, total: 1024 });
    channel.onmessage({ downloaded: 1024, total: 1024 });
    expect(onProgress).toHaveBeenNthCalledWith(1, { downloaded: 512, total: 1024 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { downloaded: 1024, total: 1024 });
    await expect(done).resolves.toEqual({ ...STATUS_WIRE, downloaded: true });
  });

  it('still passes a Channel when no callback is given — the Rust arg is required', async () => {
    native.invoke.mockResolvedValueOnce(STATUS_WIRE);
    await expect(hootDownloadOwlet()).resolves.toEqual(STATUS_WIRE);
    const [command, args] = lastCall();
    expect(command).toBe('hoot_download_owlet');
    expect(args.onProgress).toBeInstanceOf(native.Channel);
  });
});

describe('hootErrorCode', () => {
  it('extracts the hoot-… code from an Error message up to the first colon', () => {
    expect(hootErrorCode(new Error('hoot-eula-required'))).toBe('hoot-eula-required');
    expect(hootErrorCode(new Error('hoot-download-failed:fetch index: boom'))).toBe('hoot-download-failed');
    expect(hootErrorCode(new Error('hoot-hash-mismatch:owlet-25.0.1-macosuniversal'))).toBe('hoot-hash-mismatch');
    expect(hootErrorCode(new Error('hoot-convert-failed:owlet exited 1'))).toBe('hoot-convert-failed');
  });

  it('reads bare-string rejections — Tauri v2 rejects Result<_, String> with the raw string', () => {
    expect(hootErrorCode('hoot-owlet-missing')).toBe('hoot-owlet-missing');
    expect(hootErrorCode('hoot-unsupported-platform')).toBe('hoot-unsupported-platform');
  });

  it('returns null for errors without a hoot- code at the start of the message', () => {
    expect(hootErrorCode(new Error('plain failure'))).toBeNull();
    expect(hootErrorCode(new Error('cannot invoke hoot_convert: missing key'))).toBeNull();
    expect(hootErrorCode('no codes here')).toBeNull();
    expect(hootErrorCode(undefined)).toBeNull();
  });
});

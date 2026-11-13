/**
 * Desktop BLE nearby-share client wire contract (packages/desktop
 * src-tauri/src/ble/commands.rs): nine snake_case commands speaking Tauri
 * v2's default camelCase argument mapping, events arriving on a Channel in
 * the internally tagged `{ kind, …fields… }` camelCase shape the Rust
 * `BleEvent` serde attributes emit (web performs no event conversion), and
 * `ble_take_received_files` resolving serde `Vec<u8>` as JSON number arrays
 * that this client lifts into Uint8Array. Rejections stay the raw
 * `ble-…:detail` strings — `bleErrorCode` maps the prefix.
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
} from '../src/ble/client';

// Hand-written wire literals — field-for-field what the Rust serde
// camelCase serializers actually emit, never built by the code under test.
const CAPS_WIRE = {
  platformSupported: true,
  centralPowered: true,
  peripheralPowered: null,
};

const EVENT_WIRE = [
  { kind: 'discovered', devices: [{ id: 'AB:CD:EF:01:02:03', label: 'PathBlender 0.1.10-beta.17' }] },
  { kind: 'hello', peerLabel: 'Pit 3', peerVersion: '0.1.10-beta.17' },
  { kind: 'sasCode', code: '042317' },
  { kind: 'confirmPending' },
  { kind: 'confirmed' },
  { kind: 'fileRequest', fileIndex: 3, name: 'auto.traj', size: 42 },
  { kind: 'fileResult', fileIndex: 3, accepted: true },
  { kind: 'progress', fileIndex: 3, sent: 512, total: 1024 },
  { kind: 'fileVerified', fileIndex: 3, ok: false },
  { kind: 'done', okCount: 2, failCount: 1 },
  { kind: 'failed', code: 'ble-protocol-error', detail: 'BadFrame' },
  { kind: 'cancelled' },
  { kind: 'disconnected' },
  { kind: 'capabilities', caps: { platformSupported: true, centralPowered: null, peripheralPowered: true } },
];

const RECEIVED_WIRE = [
  { name: 'auto.traj', data: [1, 2, 3] },
  { name: 'empty.txt', data: [] },
];

const lastCall = () => native.invoke.mock.calls.at(-1) as [string, Record<string, unknown>];

const channelOf = (args: Record<string, unknown>) =>
  args.onEvent as InstanceType<typeof native.Channel>;

afterEach(() => {
  vi.clearAllMocks();
});

describe('bleCapabilities', () => {
  it('invokes ble_capabilities and resolves the payload untouched', async () => {
    native.invoke.mockResolvedValueOnce(CAPS_WIRE);
    await expect(bleCapabilities()).resolves.toEqual(CAPS_WIRE);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(lastCall()[0]).toBe('ble_capabilities');
  });
});

describe('sessionless commands', () => {
  it('bleStopScan, bleConfirmSession, bleRespondFile and bleCancel use camelCase keys', async () => {
    await bleStopScan();
    expect(lastCall()[0]).toBe('ble_stop_scan');

    await bleConfirmSession(true);
    expect(lastCall()[0]).toBe('ble_confirm_session');
    expect(lastCall()[1]).toEqual({ accepted: true });

    await bleRespondFile(3, false);
    expect(lastCall()[0]).toBe('ble_respond_file');
    expect(lastCall()[1]).toEqual({ fileIndex: 3, accepted: false });

    await bleCancel();
    expect(lastCall()[0]).toBe('ble_cancel');
  });

  it('passes command rejections through untouched for bleErrorCode mapping', async () => {
    native.invoke.mockRejectedValueOnce('ble-busy');
    await expect(bleStartReceiver(() => {})).rejects.toBe('ble-busy');
  });
});

describe('channel commands forward wire events verbatim', () => {
  it('bleStartScan passes an onEvent Channel and delivers every kind-tagged event as-is', async () => {
    const onEvent = vi.fn();
    await bleStartScan(onEvent);
    const [command, args] = lastCall();
    expect(command).toBe('ble_start_scan');
    expect(Object.keys(args)).toEqual(['onEvent']);
    const channel = channelOf(args);
    expect(channel).toBeInstanceOf(native.Channel);
    for (const event of EVENT_WIRE) channel.onmessage(event);
    expect(onEvent).toHaveBeenCalledTimes(EVENT_WIRE.length);
    EVENT_WIRE.forEach((event, i) =>
      expect(onEvent).toHaveBeenNthCalledWith(i + 1, event),
    );
  });

  it('bleSendFiles sends { deviceId, files, onEvent } with file bytes untouched', async () => {
    const onEvent = vi.fn();
    const files = [
      { name: 'auto.traj', data: new Uint8Array([1, 2, 3]) },
      { name: 'empty.txt', data: new Uint8Array([]) },
    ];
    await bleSendFiles('AB:CD:EF:01:02:03', files, onEvent);
    const [command, args] = lastCall();
    expect(command).toBe('ble_send_files');
    expect(Object.keys(args).sort()).toEqual(['deviceId', 'files', 'onEvent']);
    expect(args.deviceId).toBe('AB:CD:EF:01:02:03');
    expect(args.files).toEqual(files);
    const channel = channelOf(args);
    expect(channel).toBeInstanceOf(native.Channel);
    channel.onmessage(EVENT_WIRE[2]);
    channel.onmessage(EVENT_WIRE[8]);
    expect(onEvent).toHaveBeenNthCalledWith(1, EVENT_WIRE[2]);
    expect(onEvent).toHaveBeenNthCalledWith(2, EVENT_WIRE[8]);
  });

  it('bleStartReceiver passes an onEvent Channel for receiver-side events', async () => {
    const onEvent = vi.fn();
    await bleStartReceiver(onEvent);
    const [command, args] = lastCall();
    expect(command).toBe('ble_start_receiver');
    expect(Object.keys(args)).toEqual(['onEvent']);
    const channel = channelOf(args);
    channel.onmessage(EVENT_WIRE[13]);
    expect(onEvent).toHaveBeenCalledWith(EVENT_WIRE[13]);
  });
});

describe('bleTakeReceivedFiles', () => {
  it('lifts the serde number-array bytes into Uint8Array per file', async () => {
    native.invoke.mockResolvedValueOnce(RECEIVED_WIRE);
    const files = await bleTakeReceivedFiles();
    expect(lastCall()[0]).toBe('ble_take_received_files');
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe('auto.traj');
    expect(files[0].data).toBeInstanceOf(Uint8Array);
    expect(files[0].data).toEqual(new Uint8Array([1, 2, 3]));
    expect(files[1].data).toBeInstanceOf(Uint8Array);
    expect(files[1].data).toEqual(new Uint8Array([]));
  });
});

describe('bleErrorCode', () => {
  it('extracts the ble-… code from an Error message up to the first colon', () => {
    expect(bleErrorCode(new Error('ble-busy'))).toBe('ble-busy');
    expect(bleErrorCode(new Error('ble-radio-error:connect timeout after 15000ms'))).toBe('ble-radio-error');
    expect(bleErrorCode(new Error('ble-protocol-error:BadFrame'))).toBe('ble-protocol-error');
  });

  it('reads bare-string rejections — Tauri v2 rejects Result<_, String> with the raw string', () => {
    expect(bleErrorCode('ble-unsupported-platform')).toBe('ble-unsupported-platform');
    expect(bleErrorCode('ble-cancelled')).toBe('ble-cancelled');
  });

  it('returns null for errors without a ble- code at the start of the message', () => {
    expect(bleErrorCode(new Error('plain failure'))).toBeNull();
    expect(bleErrorCode(new Error('cannot invoke ble_send_files: missing key deviceId'))).toBeNull();
    expect(bleErrorCode('no codes here')).toBeNull();
    expect(bleErrorCode(undefined)).toBeNull();
  });
});

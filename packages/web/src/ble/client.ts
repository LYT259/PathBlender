/**
 * Typed wrappers for the desktop BLE nearby-share commands (packages/desktop
 * src-tauri/src/ble/commands.rs). Desktop-only: every function goes straight
 * through `invoke`, so a non-Tauri host rejects the same way any other desktop
 * command would — callers gate on `IS_DESKTOP` before reaching this module.
 *
 * Tauri v2 maps command arguments camelCase by default (`deviceId`,
 * `fileIndex`, `onEvent`) and `Result<_, String>` commands reject with the raw
 * `ble-…:detail` string — use `bleErrorCode` to map that prefix to an i18n
 * key. Events arrive on a Channel already in the internally tagged
 * `{ kind, …camelCase fields }` shape the Rust `BleEvent` serde attributes
 * emit, so they are forwarded untouched; only `ble_take_received_files`
 * converts (serde `Vec<u8>` crosses the wire as a JSON number array).
 */
import { Channel, invoke } from '@tauri-apps/api/core';

export interface BleCapabilities {
  platformSupported: boolean;
  centralPowered: boolean | null;
  peripheralPowered: boolean | null;
}

export interface BlePeer {
  id: string;
  label: string;
}

export type BleEvent =
  | { kind: 'discovered'; devices: BlePeer[] }
  | { kind: 'hello'; peerLabel: string; peerVersion: string }
  | { kind: 'sasCode'; code: string }
  | { kind: 'confirmPending' }
  | { kind: 'confirmed' }
  | { kind: 'fileRequest'; fileIndex: number; name: string; size: number }
  | { kind: 'fileResult'; fileIndex: number; accepted: boolean }
  | { kind: 'progress'; fileIndex: number; sent: number; total: number }
  | { kind: 'fileVerified'; fileIndex: number; ok: boolean }
  | { kind: 'done'; okCount: number; failCount: number }
  | { kind: 'failed'; code: string; detail: string }
  | { kind: 'cancelled' }
  | { kind: 'disconnected' }
  | { kind: 'capabilities'; caps: BleCapabilities };

export function bleCapabilities(): Promise<BleCapabilities> {
  return invoke<BleCapabilities>('ble_capabilities');
}

export function bleStartScan(onEvent: (e: BleEvent) => void): Promise<void> {
  return invoke('ble_start_scan', { onEvent: new Channel<BleEvent>(onEvent) });
}

export function bleStopScan(): Promise<void> {
  return invoke('ble_stop_scan');
}

export function bleSendFiles(
  deviceId: string,
  files: Array<{ name: string; data: Uint8Array }>,
  onEvent: (e: BleEvent) => void,
): Promise<void> {
  return invoke('ble_send_files', {
    deviceId,
    files,
    onEvent: new Channel<BleEvent>(onEvent),
  });
}

export function bleStartReceiver(onEvent: (e: BleEvent) => void): Promise<void> {
  return invoke('ble_start_receiver', { onEvent: new Channel<BleEvent>(onEvent) });
}

export function bleConfirmSession(accepted: boolean): Promise<void> {
  return invoke('ble_confirm_session', { accepted });
}

export function bleRespondFile(fileIndex: number, accepted: boolean): Promise<void> {
  return invoke('ble_respond_file', { fileIndex, accepted });
}

export async function bleTakeReceivedFiles(): Promise<
  Array<{ name: string; data: Uint8Array }>
> {
  const files = await invoke<Array<{ name: string; data: number[] }>>('ble_take_received_files');
  return files.map((file) => ({ name: file.name, data: new Uint8Array(file.data) }));
}

export function bleCancel(): Promise<void> {
  return invoke('ble_cancel');
}

const BLE_CODE = /^(ble-[a-z0-9-]+?)(?::|$)/;

export function bleErrorCode(err: unknown): string | null {
  const message =
    typeof err === 'string' ? err : err instanceof Error ? err.message : null;
  if (message == null) return null;
  return BLE_CODE.exec(message)?.[1] ?? null;
}

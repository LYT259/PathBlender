/**
 * Typed wrappers for the desktop HOOT conversion commands (packages/desktop
 * src-tauri/src/hoot.rs). Desktop-only: every function goes straight through
 * `invoke`, so a non-Tauri host rejects the same way any other desktop
 * command would — callers gate on `IS_DESKTOP` before reaching this module.
 *
 * Tauri v2 maps command arguments camelCase by default (see download.ts:
 * snake_case keys silently reject with "missing required key"), and
 * `Result<_, String>` commands reject with the raw `hoot-…:detail` string —
 * use `hootErrorCode` to map that prefix to an i18n key. Per ledger R3,
 * `wpilogBase64` is kept as the base64 string the Rust side sent; the Task 8
 * flow owns decoding when it constructs the File.
 */
import { Channel, invoke } from '@tauri-apps/api/core';

export interface HootStatus {
  eulaAccepted: boolean;
  downloaded: boolean;
  version: string | null;
  compliancy: number | null;
}

export interface HootConvertedFile {
  wpilogName: string;
  wpilogBase64: string;
}

export type DownloadProgress = { downloaded: number; total: number };

export function hootStatus(): Promise<HootStatus> {
  return invoke<HootStatus>('hoot_status');
}

export function hootAcceptEula(): Promise<HootStatus> {
  return invoke<HootStatus>('hoot_accept_eula');
}

export function hootDownloadOwlet(onProgress?: (p: DownloadProgress) => void): Promise<HootStatus> {
  // The Rust side takes a required Channel argument — an absent callback
  // still needs a (silent) channel or the invoke rejects with a missing key.
  const channel = new Channel<DownloadProgress>(onProgress);
  return invoke<HootStatus>('hoot_download_owlet', { onProgress: channel });
}

export function hootConvert(fileName: string, data: Uint8Array): Promise<HootConvertedFile> {
  return invoke<HootConvertedFile>('hoot_convert', { fileName, data });
}

const HOOT_CODE = /^(hoot-[a-z0-9]+(?:-[a-z0-9]+)*?)(?::|$)/;

export function hootErrorCode(err: unknown): string | null {
  const message =
    typeof err === 'string' ? err : err instanceof Error ? err.message : null;
  if (message == null) return null;
  return HOOT_CODE.exec(message)?.[1] ?? null;
}

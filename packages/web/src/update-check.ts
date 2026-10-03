/**
 * Desktop update runner. The channel→feed decision happens in the Rust
 * shell's `check_update` command (the plugin's JS `check()` accepts no
 * endpoint override — an unknown `url` option is silently dropped by the
 * Rust deserializer, so a JS-side override would quietly re-check the
 * configured stable feed). This module only drives the native commands and
 * reports status; the UI maps events to toasts.
 */

import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import type { UpdateChannel } from './update-channel';

export type UpdateEvent =
  | { kind: 'found'; version: string }
  | { kind: 'upToDate' }
  | { kind: 'installed' }
  | { kind: 'failed' };

export async function runUpdateCheck(
  channel: UpdateChannel,
  onEvent: (e: UpdateEvent) => void,
): Promise<void> {
  try {
    // null = the channel's feed is reachable and we're current; a rejected
    // promise = feed unreachable (offline, 404) — surfaced as 'failed', never
    // lied away as "up to date".
    const meta = await invoke<{ version: string } | null>('check_update', { channel });
    if (meta == null) {
      onEvent({ kind: 'upToDate' });
      return;
    }
    onEvent({ kind: 'found', version: meta.version });
    await invoke('install_update');
    // On Windows the installer exits the app itself, so the relaunch call may
    // never resolve — best effort only.
    await relaunch().catch(() => undefined);
    onEvent({ kind: 'installed' });
  } catch {
    onEvent({ kind: 'failed' });
  }
}

/**
 * Preferences-window "Check for updates" — the query half of a two-step
 * flow (unlike the native menu's one-shot runUpdateCheck above). This only
 * ASKS the feed: the Rust `check_update` command stashes any update it
 * finds in `PendingUpdate`, and nothing is downloaded, installed or
 * relaunched until the user explicitly clicks "Install and relaunch"
 * (installPendingUpdate below).
 */
export type CheckEvent =
  | { kind: 'found'; version: string }
  | { kind: 'upToDate' }
  | { kind: 'failed' };

export async function checkForUpdate(
  channel: UpdateChannel,
  onEvent: (e: CheckEvent) => void,
): Promise<void> {
  try {
    // Same null/reject semantics as runUpdateCheck: null = reachable and
    // current; a rejection = feed unreachable — reported as 'failed', never
    // disguised as up to date.
    const meta = await invoke<{ version: string } | null>('check_update', { channel });
    if (meta == null) {
      onEvent({ kind: 'upToDate' });
      return;
    }
    onEvent({ kind: 'found', version: meta.version });
  } catch {
    onEvent({ kind: 'failed' });
  }
}

/** Installs the update stashed by checkForUpdate, then relaunches. */
export async function installPendingUpdate(): Promise<void> {
  await invoke('install_update');
  // On Windows the installer exits the app itself, so the relaunch call may
  // never resolve — best effort only.
  await relaunch().catch(() => undefined);
}

/**
 * Desktop update runner. The channel→feed decision happens in the Rust
 * shell's `check_update` command (the plugin's JS `check()` accepts no
 * endpoint override — an unknown `url` option is silently dropped by the
 * Rust deserializer, so a JS-side override would quietly re-check the
 * configured stable feed). This module only drives the native commands and
 * reports status; the UI maps events to toasts.
 */

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
    const { invoke } = await import('@tauri-apps/api/core');
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
    const { relaunch } = await import('@tauri-apps/plugin-process');
    // On Windows the installer exits the app itself, so the relaunch call may
    // never resolve — best effort only.
    await relaunch().catch(() => undefined);
    onEvent({ kind: 'installed' });
  } catch {
    onEvent({ kind: 'failed' });
  }
}

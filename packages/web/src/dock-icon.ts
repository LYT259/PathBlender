/**
 * Desktop: apply the app-icon appearance choice (app-icon.tsx) to the
 * running app's Dock tile (macOS). Always explicit artwork via
 * `setApplicationIconImage`: fixed light/dark pins that artwork regardless
 * of the OS; 'system' pushes the artwork matching the CURRENT OS
 * appearance (systemDark) and the provider re-invokes on every OS flip,
 * so the tile tracks the system by construction. Finder / Launchpad icons
 * are always rendered from the bundle catalog by macOS and cannot be
 * pinned here. Quiet no-op on other platforms and when the artwork is
 * absent, so callers never need to care.
 *
 * The mode parameter mirrors IconAppearanceMode (app-icon.tsx); it stays
 * structural so this low-level bridge remains import-cycle-free.
 */

export function syncDockIcon(mode: 'system' | 'light' | 'dark', systemDark: boolean, desktop: boolean): void {
  if (!desktop) return;
  const dark = mode === 'system' ? systemDark : mode === 'dark';
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_dock_icon', { dark }))
    .catch(() => undefined);
}

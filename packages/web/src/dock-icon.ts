/**
 * Desktop: mirror the app's resolved theme onto the running app's Dock
 * tile (macOS). The bundle's icon catalog already tracks the OS
 * appearance; this runtime override makes the tile track the in-app
 * theme choice instead — explicit artwork, no appearance pipeline
 * involved. The shell command is a quiet no-op on other platforms and
 * when the artwork is absent, so callers never need to care.
 */

export function syncDockIcon(resolved: 'dark' | 'light', desktop: boolean): void {
  if (!desktop) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_dock_icon', { dark: resolved === 'dark' }))
    .catch(() => undefined);
}

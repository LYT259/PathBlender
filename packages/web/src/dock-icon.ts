/**
 * Desktop: apply the app-icon preferences (app-icon.tsx) to the running
 * app's Dock tile (macOS). Always explicit artwork via
 * `setApplicationIconImage`: fixed light/dark pins that artwork regardless
 * of the OS; 'system' pushes the artwork matching the CURRENT OS
 * appearance (systemDark) and the provider re-invokes on every OS flip,
 * so the tile tracks the system by construction. The style picks the
 * artwork family (classic red/black, monochrome white/black); the shell
 * maps it to a fixed set of bundled resources. Finder / Launchpad icons
 * are always rendered from the bundle catalog by macOS and cannot be
 * pinned here. Quiet no-op on other platforms, so callers never need to
 * care.
 *
 * Both parameters stay structural (they mirror IconAppearanceMode /
 * IconStyle from app-icon.tsx) so this low-level bridge remains
 * import-cycle-free.
 */

export type DockIconStyle = 'classic' | 'monochrome';

export function syncDockIcon(
  mode: 'system' | 'light' | 'dark',
  systemDark: boolean,
  desktop: boolean,
  style: DockIconStyle = 'classic',
): void {
  if (!desktop) return;
  const dark = mode === 'system' ? systemDark : mode === 'dark';
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_dock_icon', { dark, style }))
    .catch(() => undefined);
}

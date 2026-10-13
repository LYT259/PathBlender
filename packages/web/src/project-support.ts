/** Release-owned switch. Enable only after the repository is approved and public.
 * No remote status lookup, GitHub SDK, analytics, or authentication is needed. */
export const PUBLIC_REPOSITORY_READY = false;
export const GITHUB_URL = 'https://github.com/LYT259/pathblender';

export function supportEnabled(publicReady: boolean, dev: boolean, search: string): boolean {
  return publicReady || (dev && new URLSearchParams(search).get('support-preview') === '1');
}

export const SHOW_PROJECT_SUPPORT = supportEnabled(
  PUBLIC_REPOSITORY_READY, import.meta.env.DEV, window.location.search,
);

/** Let the desktop shell open the system browser; preserve native links on web. */
export function openProjectOnDesktop(event: { preventDefault: () => void }): void {
  if (!('__TAURI_INTERNALS__' in window || ['tauri:', 'asset:'].includes(location.protocol))) return;
  event.preventDefault();
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('open_external', { url: GITHUB_URL }))
    .catch(() => { window.open(GITHUB_URL, '_blank', 'noopener,noreferrer'); });
}

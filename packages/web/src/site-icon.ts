/**
 * Browser tab icon: the same day/night artwork the macOS Dock tile uses
 * (dock-icon.ts), chosen by the same app-icon preference. The artwork must be
 * full-bleed — a transparent margin makes Chrome composite a white plate behind
 * the mark at 16px, which reads as a stray ring around the logo.
 *
 * Structural parameters mirror syncDockIcon so both surfaces converge from one
 * (mode, systemDark) pair; 'system' tracks the OS by re-invoking on every flip.
 */

export function applySiteIcon(
  mode: 'system' | 'light' | 'dark',
  systemDark: boolean,
  hrefs: { day: string; night: string },
  browser: boolean,
): void {
  if (!browser) return;
  const href = (mode === 'system' ? systemDark : mode === 'dark') ? hrefs.night : hrefs.day;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    document.head.appendChild(link);
  }
  // getAttribute, not link.href: the getter resolves to an absolute URL, so
  // comparing it against a relative href would never settle and re-write forever.
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

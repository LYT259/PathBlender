/**
 * Browser tab icon: the same day/night artwork the macOS Dock tile uses
 * (dock-icon.ts), chosen by the same app-icon preference. The artwork must be
 * full-bleed — a transparent margin makes Chrome composite a white plate behind
 * the mark at 16px, which reads as a stray ring around the logo.
 *
 * Structural parameters mirror syncDockIcon so both surfaces converge from one
 * (mode, systemDark) pair; 'system' tracks the OS by re-invoking on every flip.
 *
 * The document ships a static night-first/day-last media pair (index.html) so
 * Chromium resolves the plate natively before any JS runs. This module then
 * rewrites the href of EVERY icon link to the resolved artwork, which overrides
 * the media pair for the fixed light/dark choices and keeps the pair inert
 * (both links carry the same href). Browsers that ignore media on favicons
 * (Firefox, Safari) also fall back to the last static link — day — and only
 * reach the artwork this module resolves.
 */

export function applySiteIcon(
  mode: 'system' | 'light' | 'dark',
  systemDark: boolean,
  hrefs: { day: string; night: string },
  browser: boolean,
): void {
  if (!browser) return;
  const href = (mode === 'system' ? systemDark : mode === 'dark') ? hrefs.night : hrefs.day;
  let links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    document.head.appendChild(link);
    links = [link];
  }
  for (const link of links) {
    // getAttribute, not link.href: the getter resolves to an absolute URL, so
    // comparing it against a relative href would never settle and re-write forever.
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
}

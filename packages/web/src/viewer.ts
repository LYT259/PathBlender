/**
 * Viewer-only deployments (pathblender.pages.dev): import + playback +
 * collision preview only — routes stay as imported and nothing is exported
 * (no session save, no PNG, no GIF, no solution package). Since the
 * 2026-09-30 viewer-only pivot the PRODUCT is a viewer everywhere; the website
 * carries every import channel the app has, whole-folder import included
 * (2026-10-06 — the site is meant to behave like the app, down to its home
 * screen), and desktop adds session save/open on top. The flag is set only in
 * the website build (VITE_VIEWER_ONLY=1) so one codebase serves both shapes.
 */
export const VIEWER_ONLY = import.meta.env.VITE_VIEWER_ONLY === '1';

/**
 * Site flavor: which public website this build deploys to. The stable site
 * (pathblender.pages.dev) shows a β badge to the preview site; the preview
 * site (pathblender-preview.pages.dev) shows a return-to-stable banner.
 * Desktop and dev builds set neither and show nothing.
 */
export const SITE_PREVIEW = import.meta.env.VITE_SITE_PREVIEW === '1';
export const SITE_URLS = {
  stable: 'https://pathblender.pages.dev',
  preview: 'https://pathblender-preview.pages.dev',
} as const;

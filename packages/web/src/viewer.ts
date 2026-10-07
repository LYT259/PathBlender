/**
 * Viewer-only deployments (pathblender.pages.dev): import + playback +
 * collision preview only — routes stay as imported and nothing is exported
 * (no session save, no PNG, no GIF, no solution package). Since the
 * 2026-09-30 viewer-only pivot the PRODUCT is a viewer everywhere; the website
 * carries every import channel the app has, whole-folder import included
 * (2026-10-06 — the site is meant to behave like the app, down to its home
 * screen), and desktop adds session save/open on top. The flag is set only in
 * the website build (VITE_VIEWER_ONLY=1) so one codebase serves both shapes.
 *
 * The separate site-flavor switch (VITE_SITE_PREVIEW, preview-site cross
 * links and banner) was removed 2026-10-07: the website itself is the beta
 * channel, so it no longer advertises a second, preview deployment.
 */
export const VIEWER_ONLY = import.meta.env.VITE_VIEWER_ONLY === '1';

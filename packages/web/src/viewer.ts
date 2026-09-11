/**
 * Viewer-only deployments (pathblender.pages.dev): import + playback +
 * collision preview only — routes stay as imported and nothing is exported
 * (no path files, no session file, no PNG). Desktop and dev builds are the
 * full authoring tool; the flag is set only in the website build
 * (VITE_VIEWER_ONLY=1) so one codebase serves both shapes.
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

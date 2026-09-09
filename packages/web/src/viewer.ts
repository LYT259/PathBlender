/**
 * Viewer-only deployments (pathblender.pages.dev): import + playback +
 * collision preview only — routes stay as imported and nothing is exported
 * (no path files, no session file, no PNG). Desktop and dev builds are the
 * full authoring tool; the flag is set only in the website build
 * (VITE_VIEWER_ONLY=1) so one codebase serves both shapes.
 */
export const VIEWER_ONLY = import.meta.env.VITE_VIEWER_ONLY === '1';

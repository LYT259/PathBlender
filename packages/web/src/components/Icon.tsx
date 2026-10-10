import type { CSSProperties } from 'react';

const paths = {
  back: <path d="m14 5-7 7 7 7" />,
  timeline: <><path d="M4 4v16M4 8h16M4 16h16"/><rect x="7" y="5" width="7" height="6" rx="1.5"/><rect x="12" y="13" width="8" height="6" rx="1.5"/></>,
  mirror: <g fill="currentColor" stroke="none" transform="rotate(35 12 12)"><path d="M7 2 1.5 7.5H5V15a5 5 0 0 0 5 5h1v-4h-1a1 1 0 0 1-1-1V7.5h3.5Z"/><path transform="rotate(180 12 12)" d="M7 2 1.5 7.5H5V15a5 5 0 0 0 5 5h1v-4h-1a1 1 0 0 1-1-1V7.5h3.5Z"/></g>,
  trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
  recenter: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/><path d="M8 12h8m-4-4v8"/><circle cx="12" cy="12" r="2"/></>,
  github: <path fill="currentColor" stroke="none" d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1 1.53 1.88 3.28 1.27.1-.73.39-1.23.71-1.51-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.09 1.16A10.7 10.7 0 0 1 12 6.48c.96 0 1.92.13 2.82.38 2.15-1.46 3.09-1.16 3.09-1.16.61 1.55.23 2.7.11 2.98.73.79 1.16 1.8 1.16 3.03 0 4.33-2.63 5.29-5.14 5.57.41.35.76 1.03.76 2.09v2.76c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z"/>,
  mouse: <><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7m-6 1h12"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-10v.1"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/></>,
  import: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 14v6h14v-6"/></>,
  undo: <><path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 6 6v2"/></>,
  redo: <><path d="m16 5 5 5-5 5m5-5h-10a6 6 0 0 0-6 6v2"/></>,
  home: <><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/></>,
  fit: <><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/></>,
  path: <><path d="M5 18c0-7 14-5 14-12M5 18h.01M19 6h.01"/><rect x="2" y="15" width="6" height="6" rx="1.5"/><rect x="16" y="3" width="6" height="6" rx="1.5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5m-2-2 2 2 2-2"/></>,
} as const;

export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}

import type { CSSProperties } from 'react';

const paths = {
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-10v.1"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/></>,
  import: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 14v6h14v-6"/></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></>,
  inspector: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></>,
  undo: <><path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 6 6v2"/></>,
  redo: <><path d="m16 5 5 5-5 5m5-5h-10a6 6 0 0 0-6 6v2"/></>,
  share: <><path d="M12 15V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
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

/**
 * App-icon preferences, independent from the interface theme (theme.tsx):
 * a style (classic / monochrome artwork family) plus an appearance mode
 * (system / light / dark) that applies to whichever family is selected.
 * Both persist under their own localStorage keys ('pb.appIconStyle',
 * 'pb.appIcon' — deliberately NOT the theme's storage key) and sync between
 * the main and preferences windows over the pref bridge (pref-sync.ts).
 * Switching either choice never resets the other, and an existing saved
 * appearance survives upgrades: the style key is new and defaults to
 * 'classic', so pre-style users keep exactly what they had.
 *
 * Scope (macOS): the choices drive the RUNNING app's Dock tile through
 * dock-icon.ts, always with explicit artwork. 'system' mirrors the OS via
 * a live prefers-color-scheme listener that re-pushes the matching
 * artwork on every flip — the tile tracks the OS by construction, with no
 * reliance on Dock re-render behavior after a cleared override. Fixed
 * light/dark ignores the OS. Finder / Launchpad icons are rendered by
 * macOS from the bundle catalog and always follow the OS appearance; no
 * per-app runtime override exists for them. Browser builds never reach
 * native code (syncDockIcon no-ops) but resolve the same artwork for the
 * tab icon (site-icon.ts), so one preference covers both surfaces. The
 * browser exposes no icon settings UI, so a browser tab always resolves
 * the classic favicons — the style choice is a desktop-only entry.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { broadcastPref, isDesktop, listenPrefs } from './pref-sync';
import { syncDockIcon } from './dock-icon';
import { applySiteIcon } from './site-icon';
import faviconDay from './assets/favicon-day.png';
import faviconNight from './assets/favicon-night.png';
import dayIcon from './assets/app-icon-day.png';
import nightIcon from './assets/app-icon-night.png';
import monoDayIcon from './assets/app-icon-mono-day.png';
import monoNightIcon from './assets/app-icon-mono-night.png';

export type IconAppearanceMode = 'system' | 'light' | 'dark';
export type IconStyle = 'classic' | 'monochrome';

/** Preview artwork per style family, keyed by resolved light/dark. */
export const ICON_STYLE_ARTWORK = {
  classic: { light: dayIcon, dark: nightIcon },
  monochrome: { light: monoDayIcon, dark: monoNightIcon },
} satisfies Record<IconStyle, { light: string; dark: string }>;

const STORAGE_KEY = 'pb.appIcon';
const STYLE_STORAGE_KEY = 'pb.appIconStyle';

interface AppIconCtx {
  mode: IconAppearanceMode;
  style: IconStyle;
  systemDark: boolean;
  setMode: (m: IconAppearanceMode) => void;
  setStyle: (s: IconStyle) => void;
}

const Ctx = createContext<AppIconCtx>({
  mode: 'system', style: 'classic', systemDark: true, setMode: () => {}, setStyle: () => {},
});

function readStored(): IconAppearanceMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeStored(m: IconAppearanceMode): void {
  try {
    if (m === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, m);
  } catch {
    /* storage unavailable — session-only choice */
  }
}

function readStoredStyle(): IconStyle {
  try {
    return localStorage.getItem(STYLE_STORAGE_KEY) === 'monochrome' ? 'monochrome' : 'classic';
  } catch {
    return 'classic';
  }
}

function writeStoredStyle(s: IconStyle): void {
  try {
    if (s === 'classic') localStorage.removeItem(STYLE_STORAGE_KEY);
    else localStorage.setItem(STYLE_STORAGE_KEY, s);
  } catch {
    /* storage unavailable — session-only choice */
  }
}

export function AppIconProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<IconAppearanceMode>(readStored);
  const [style, setStyleState] = useState<IconStyle>(readStoredStyle);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  );

  // Live OS-appearance tracking for 'system' mode (same mechanism as
  // theme.tsx).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return; // jsdom
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Converge the icon surface with the choices on mount (restart restore) and
  // on every choice/OS flip: the Dock tile on desktop, the tab icon in a
  // browser. Both windows mount this provider, so a change arrives twice with
  // the same value — both sinks are idempotent.
  useEffect(() => {
    syncDockIcon(mode, systemDark, isDesktop, style);
    applySiteIcon(mode, systemDark, { day: faviconDay, night: faviconNight }, !isDesktop);
  }, [mode, systemDark, style]);

  const setMode = useCallback((m: IconAppearanceMode) => {
    setModeState(m);
    writeStored(m);
    broadcastPref('appIcon', m); // the other window applies instantly
  }, []);

  const setStyle = useCallback((s: IconStyle) => {
    setStyleState(s);
    writeStoredStyle(s);
    broadcastPref('appIconStyle', s);
  }, []);

  // Apply a choice saved in the other window (no re-broadcast — the echo
  // is a same-value no-op and stops the loop).
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key === 'appIcon') {
          const m: IconAppearanceMode = v === 'light' || v === 'dark' ? v : 'system';
          setModeState(m);
          writeStored(m);
        } else if (key === 'appIconStyle') {
          const s: IconStyle = v === 'monochrome' ? 'monochrome' : 'classic';
          setStyleState(s);
          writeStoredStyle(s);
        }
      }),
    [],
  );

  const value = useMemo(
    () => ({ mode, style, systemDark, setMode, setStyle }),
    [mode, style, systemDark, setMode, setStyle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppIcon(): AppIconCtx {
  return useContext(Ctx);
}

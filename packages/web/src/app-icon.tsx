/**
 * App-icon appearance preference: system / light / dark, independent from the
 * interface theme (theme.tsx). Persisted to localStorage 'pb.appIcon' —
 * deliberately NOT the theme's storage key — and synced between the main and
 * preferences windows over the pref bridge (pref-sync.ts).
 *
 * Scope (macOS): the choice drives the RUNNING app's Dock tile through
 * dock-icon.ts, always with explicit artwork. 'system' mirrors the OS via
 * a live prefers-color-scheme listener that re-pushes the matching
 * artwork on every flip — the tile tracks the OS by construction, with no
 * reliance on Dock re-render behavior after a cleared override. Fixed
 * light/dark ignores the OS. Finder / Launchpad icons are rendered by
 * macOS from the bundle catalog and always follow the OS appearance; no
 * per-app runtime override exists for them. Browser builds never reach
 * native code (syncDockIcon no-ops) but resolve the same artwork for the
 * tab icon (site-icon.ts), so one preference covers both surfaces.
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

export type IconAppearanceMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pb.appIcon';

interface AppIconCtx {
  mode: IconAppearanceMode;
  systemDark: boolean;
  setMode: (m: IconAppearanceMode) => void;
}

const Ctx = createContext<AppIconCtx>({ mode: 'system', systemDark: true, setMode: () => {} });

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

export function AppIconProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<IconAppearanceMode>(readStored);
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

  // Converge the icon surface with the choice on mount (restart restore) and on
  // every choice/OS flip: the Dock tile on desktop, the tab icon in a browser.
  // Both windows mount this provider, so a change arrives twice with the same
  // value — both sinks are idempotent.
  useEffect(() => {
    syncDockIcon(mode, systemDark, isDesktop);
    applySiteIcon(mode, systemDark, { day: faviconDay, night: faviconNight }, !isDesktop);
  }, [mode, systemDark]);

  const setMode = useCallback((m: IconAppearanceMode) => {
    setModeState(m);
    writeStored(m);
    broadcastPref('appIcon', m); // the other window applies instantly
  }, []);

  // Apply a choice saved in the other window (no re-broadcast — the echo
  // is a same-value no-op and stops the loop).
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key !== 'appIcon') return;
        const m: IconAppearanceMode = v === 'light' || v === 'dark' ? v : 'system';
        setModeState(m);
        writeStored(m);
      }),
    [],
  );

  const value = useMemo(() => ({ mode, systemDark, setMode }), [mode, systemDark, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppIcon(): AppIconCtx {
  return useContext(Ctx);
}

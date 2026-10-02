/**
 * Theme system (report v1.7 §7.4): dark/light palettes, default follows the
 * OS (`prefers-color-scheme`, live), Preferences can override with a
 * remembered choice (localStorage 'ghpb.theme').
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { broadcastPref, isDesktop, listenPrefs } from './pref-sync';
import { syncDockIcon } from './dock-icon';

export type ThemeMode = 'system' | 'dark' | 'light';

const STORAGE_KEY = 'ghpb.theme';

interface ThemeCtx {
  mode: ThemeMode;
  resolved: 'dark' | 'light';
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ mode: 'system', resolved: 'dark', setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return; // jsdom
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: 'dark' | 'light' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Layout effect: data-theme must land on <html> before any child's passive
  // effect reads computed styles (the 3D scene retints from CSS tokens) and
  // before the browser paints (no wrong-theme flash on mount).
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // Desktop: the running Dock tile follows the resolved theme (explicit
  // artwork via dock-icon.ts). Both windows mount this provider, so a
  // change converges with the same value from both — idempotent.
  useEffect(() => {
    syncDockIcon(resolved, isDesktop);
  }, [resolved]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      if (m === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage unavailable — session-only theme */
    }
    broadcastPref('theme', m); // other windows (desktop prefs) apply instantly
  }, []);

  // Apply theme changed in another window (no re-broadcast — the echo is a
  // same-value no-op and stops the loop).
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key !== 'theme') return;
        const m = (v === 'dark' || v === 'light' ? v : 'system') as ThemeMode;
        setModeState(m);
        try {
          if (m === 'system') localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, m);
        } catch {
          /* session-only */
        }
      }),
    [],
  );

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

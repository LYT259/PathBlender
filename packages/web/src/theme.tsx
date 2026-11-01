/**
 * Theme system (report v1.7 §7.4): dark/light palettes, default follows the
 * OS (`prefers-color-scheme`, live), Preferences can override with a
 * remembered choice (localStorage 'pb.theme').
 *
 * The interface theme is deliberately decoupled from the app-icon
 * appearance: the Dock tile is driven by the independent preference in
 * app-icon.tsx, not by the palette resolved here.
 *
 * The accent color (2026-10-17) is a THIRD independent axis: blue (default,
 * no CSS overrides), brand red or silver, persisted under its own
 * 'pb.accent' key and written to <html data-accent> for the CSS variant
 * blocks. It never touches the theme mode, the icon preferences, or any
 * data color (alliance/heatmap/bumper/path palettes all read their own
 * tokens — see the heatmap decoupling in robot-identity.ts).
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
import { broadcastPref, listenPrefs } from './pref-sync';

export type ThemeMode = 'system' | 'dark' | 'light';
export type AccentColor = 'blue' | 'red' | 'steel' | 'bronze' | 'silver';

const STORAGE_KEY = 'pb.theme';
const ACCENT_STORAGE_KEY = 'pb.accent';

/** Picker order (2026-10-17 user spec): azure, crimson, steel blue, bronze,
 *  silver gray — also the single source of valid stored values. */
export const ACCENT_CHOICES: readonly AccentColor[] = ['blue', 'red', 'steel', 'bronze', 'silver'];

function parseAccent(v: string | null): AccentColor {
  return (ACCENT_CHOICES as readonly string[]).includes(v ?? '') ? (v as AccentColor) : 'blue';
}

function readStoredAccent(): AccentColor {
  try {
    return parseAccent(localStorage.getItem(ACCENT_STORAGE_KEY)); // missing/invalid → blue
  } catch {
    return 'blue'; // storage unavailable — session-only accent
  }
}

function writeStoredAccent(a: AccentColor): void {
  try {
    if (a === 'blue') localStorage.removeItem(ACCENT_STORAGE_KEY); // default stays keyless
    else localStorage.setItem(ACCENT_STORAGE_KEY, a);
  } catch {
    /* storage unavailable — session-only choice */
  }
}

interface ThemeCtx {
  mode: ThemeMode;
  resolved: 'dark' | 'light';
  setMode: (m: ThemeMode) => void;
  accent: AccentColor;
  setAccent: (a: AccentColor) => void;
}

const Ctx = createContext<ThemeCtx>({
  mode: 'system', resolved: 'dark', setMode: () => {}, accent: 'blue', setAccent: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'dark' || v === 'light' ? v : 'system';
    } catch {
      return 'system';
    }
  });
  const [accent, setAccentState] = useState<AccentColor>(readStoredAccent);
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
  // before the browser paints (no wrong-theme flash on mount). data-accent
  // rides the same effect for the same two reasons — the ViewCube retints
  // from tokens too, and a restart straight into red/silver must not flash
  // blue first.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useLayoutEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

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

  const setAccent = useCallback((a: AccentColor) => {
    setAccentState(a);
    writeStoredAccent(a);
    broadcastPref('accent', a);
  }, []);

  // Apply theme/accent changed in another window (no re-broadcast — the echo
  // is a same-value no-op and stops the loop).
  useEffect(
    () =>
      listenPrefs((key, v) => {
        if (key === 'theme') {
          const m = (v === 'dark' || v === 'light' ? v : 'system') as ThemeMode;
          setModeState(m);
          try {
            if (m === 'system') localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, m);
          } catch {
            /* session-only */
          }
        } else if (key === 'accent') {
          const a = parseAccent(v);
          setAccentState(a);
          writeStoredAccent(a);
        }
      }),
    [],
  );

  const value = useMemo(
    () => ({ mode, resolved, setMode, accent, setAccent }),
    [mode, resolved, setMode, accent, setAccent],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}

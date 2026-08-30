import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider, LANGUAGES, langLabel, useI18n, type Lang } from './i18n';
import { ThemeProvider, useTheme, type ThemeMode } from './theme';
import './app.css';

// Desktop ⌘, Preferences opens a second webview on the same bundle,
// distinguished only by the ?window=prefs query param — it renders the
// language card and nothing else (AI provider settings live in the AI panel).
const isPrefsWindow = new URLSearchParams(location.search).get('window') === 'prefs';

// Desktop (Tauri) shell marker: the overlay title bar's traffic lights sit
// inside the toolbar's left padding (see .desktop .toolbar in app.css).
if (typeof window !== 'undefined' && (window.location.protocol === 'tauri:' || window.location.protocol === 'asset:')) {
  document.body.classList.add('desktop');
}

function PrefsOnly() {
  const { lang, setLang } = useI18n();
  const [value, setValue] = useState<Lang>(lang);
  return (
    <div className="prefs-only">
      <div className="prefs-modal static">
        <h3>Preferences</h3>
        <label className="prefs-row">
          <span>Language / 语言</span>
          <select
            value={value}
            onChange={(e) => {
              setValue(e.target.value as Lang);
              setLang(e.target.value as Lang);
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {langLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <ThemeRow />
        <p className="prefs-note">
          {/* Static text is fine here: the window lives outside the main UI. */}
          Preferences are shared with the main window.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>{isPrefsWindow ? <PrefsOnly /> : <App />}</I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);

// PWA: static-asset service worker, production builds only (study §7.1).
// Browser contexts only — the Tauri desktop shell serves from tauri://,
// where service workers don't register (and aren't needed: assets are local).
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  location.protocol.startsWith('http')
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href)
      .catch(() => {
        /* offline install is a bonus, never fatal */
      });
  });
}


function ThemeRow() {
  const { mode, setMode } = useTheme();
  return (
    <label className="prefs-row">
      <span>Theme / 主题</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
        <option value="system">System / 跟随系统</option>
        <option value="dark">Dark / 深色</option>
        <option value="light">Light / 浅色</option>
      </select>
    </label>
  );
}

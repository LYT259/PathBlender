import { StrictMode } from 'react';
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
  const { lang, setLang, t } = useI18n();
  return (
    <div className="prefs-only">
      <div className="prefs-modal static">
        <h3>{t('prefs.title')}</h3>
        <label className="prefs-row">
          <span>{t('prefs.language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {langLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <ThemeRow />
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
  const { t } = useI18n();
  return (
    <label className="prefs-row">
      <span>{t('prefs.theme')}</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
        <option value="system">{t('theme.system')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="light">{t('theme.light')}</option>
      </select>
    </label>
  );
}

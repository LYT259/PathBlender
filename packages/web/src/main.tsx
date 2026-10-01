import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import { UpdateChannelProvider } from './update-channel';
import { PrefsWindow } from './prefs-window';
import './app.css';
import './workspace.css';

// Desktop ⌘, Preferences opens a second webview on the same bundle,
// distinguished only by the ?window=prefs query param. It renders its own
// small card set — language / theme / update channel — see prefs-window.tsx.
const isPrefsWindow = new URLSearchParams(location.search).get('window') === 'prefs';

// Desktop (Tauri) shell marker: the overlay title bar's traffic lights sit
// inside the toolbar's left padding (see .desktop .toolbar in app.css).
if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || window.location.protocol === 'tauri:' || window.location.protocol === 'asset:')) {
  document.body.classList.add('desktop');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <UpdateChannelProvider>
        <I18nProvider>{isPrefsWindow ? <PrefsWindow /> : <App />}</I18nProvider>
      </UpdateChannelProvider>
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

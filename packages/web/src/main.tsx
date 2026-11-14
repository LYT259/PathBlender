import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Must stay the first local import: it copies pre-rename `ghpb.*`
// localStorage entries to their `pb.*` names before anything reads them.
import './legacy-storage';
import { App } from './App';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import { AppIconProvider } from './app-icon';
import { UpdateChannelProvider } from './update-channel';
import { PrefsWindow } from './prefs-window';
import { installFocusModality } from './focus-modality';
import './app.css';
import './workspace.css';
import { isDesktop } from './pref-sync';
import { registerServiceWorker } from './pwa';

// Ring-or-not follows the physical input (mouse vs keyboard), not the
// browser's :focus-visible guess — see focus-modality.ts. Covers the prefs
// webview too: it runs this same bundle in its own document.
installFocusModality();

// Desktop ⌘, Preferences opens a second webview on the same bundle,
// distinguished only by the ?window=prefs query param. It renders its own
// shared settings interface — see prefs-window.tsx.
const isPrefsWindow = new URLSearchParams(location.search).get('window') === 'prefs';

// Desktop (Tauri) shell marker: the overlay title bar's traffic lights sit
// inside the toolbar's left padding (see .desktop .toolbar in app.css).
// desktop-macos marks the platforms that actually render that overlay title
// bar — Windows keeps native decorations (titleBarStyle/trafficLightPosition
// are macOS-only), so it must not reserve traffic-light space or inherit the
// macOS vibrancy transparency (body would fall back to opaque --bg).
if (isDesktop) {
  document.body.classList.add('desktop');
  if (/Macintosh/.test(navigator.userAgent)) document.body.classList.add('desktop-macos');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AppIconProvider>
        <UpdateChannelProvider>
          <I18nProvider>{isPrefsWindow ? <PrefsWindow /> : <App />}</I18nProvider>
        </UpdateChannelProvider>
      </AppIconProvider>
    </ThemeProvider>
  </StrictMode>,
);

// PWA belongs to the browser. The desktop shell already serves local assets;
// on Windows its http origin must not be intercepted by a service worker.
registerServiceWorker(import.meta.env.PROD);

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from './i18n';
import { PreferencesPanel } from './components/PreferencesPanel';

/** The toolbar and ⌘, open the same native settings window. */
export function PrefsWindow() {
  const { t } = useI18n();
  const [closeFailed, setCloseFailed] = useState(false);
  // The window opens with DOM focus on <body>, which left the panel's
  // Escape handler deaf until the user clicked something (keyboard pass
  // 2026-10-06). Land focus on the panel itself, and back up Escape with a
  // window-level listener for whenever focus sits outside the panel.
  const close = () => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())
      .catch(() => setCloseFailed(true));
  };
  useEffect(() => {
    document.querySelector<HTMLElement>('.preferences-panel')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.repeat) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The overlay title bar leaves no native drag area, so a transparent layer
  // covers the top strip. Besides the injected data-tauri-drag-region
  // handler we call startDragging() directly: the attribute path silently
  // no-ops in this window (user report 2026-10-04), the API path is
  // deterministic. When the injected handler does fire it calls
  // stopImmediatePropagation(), so the two never double-invoke.
  const startDrag = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch(() => {});
  };
  return <div className="prefs-only preferences-window">
    <div className="prefs-drag-layer" data-tauri-drag-region onMouseDown={startDrag} />
    <PreferencesPanel desktop onClose={close} />
    {closeFailed && <div className="toast error" role="alert">{t('prefs.closeFailed')}</div>}
  </div>;
}

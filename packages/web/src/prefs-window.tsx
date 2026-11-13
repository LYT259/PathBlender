import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { PreferencesPanel } from './components/PreferencesPanel';
import { disableWindowBackgroundDrag, startWindowDrag, updateWindowBackgroundDrag } from './window-chrome';

/** The toolbar and ⌘, open the same native settings window. */
export function PrefsWindow() {
  const { t } = useI18n();
  const [closeFailed, setCloseFailed] = useState(false);
  // The shell creates this window with ?go=updates for the menu's "Check
  // for Updates" (fresh-window path; an already-open window is re-targeted
  // by the pb-prefs-go-updates CustomEvent handled inside the panel).
  const goUpdates = new URLSearchParams(location.search).get('go') === 'updates';
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
  // The overlay title bar leaves no native drag area. The transparent layer
  // enables AppKit background dragging only while hovered and keeps the
  // explicit startDragging() fallback for the injected attribute path.
  return <div className="prefs-only preferences-window">
    <div
      className="prefs-drag-layer"
      data-tauri-drag-region
      onPointerOver={updateWindowBackgroundDrag}
      onPointerLeave={disableWindowBackgroundDrag}
      onMouseDown={startWindowDrag}
    />
    <PreferencesPanel desktop initialSection={goUpdates ? 'updates' : undefined} autoCheckUpdates={goUpdates} onClose={close} />
    {closeFailed && <div className="toast error" role="alert">{t('prefs.closeFailed')}</div>}
  </div>;
}

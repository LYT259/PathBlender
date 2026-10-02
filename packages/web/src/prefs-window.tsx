import { useState } from 'react';
import { useI18n } from './i18n';
import { PreferencesPanel } from './components/PreferencesPanel';

/** The toolbar and ⌘, open the same native settings window. */
export function PrefsWindow() {
  const { t } = useI18n();
  const [closeFailed, setCloseFailed] = useState(false);
  return <div className="prefs-only preferences-window">
    <PreferencesPanel desktop onClose={() => {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())
        .catch(() => setCloseFailed(true));
    }} />
    {closeFailed && <div className="toast error" role="alert">{t('prefs.closeFailed')}</div>}
  </div>;
}

import { useId } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  onImport: () => void;
  onImportFolder?: () => void;
  onOpenSession: () => void;
  onTryExample: () => void;
  exampleLoading?: boolean;
}

function RowArrow() {
  return <svg className="start-row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
}

export function WelcomeScreen({ onImport, onImportFolder, onOpenSession, onTryExample, exampleLoading = false }: WelcomeScreenProps) {
  const { t } = useI18n();
  const id = useId();

  return (
    <section className="workspace-empty start-screen" aria-labelledby={`${id}-title`}>
      <div className="start-content">
        <h1 id={`${id}-title`}>{t('welcome.title')}</h1>
        <div className="start-actions">
          <button type="button" className="start-action start-action-primary welcome-import" onClick={onImport} aria-label={t('welcome.importFile')} aria-describedby={`${id}-file-hint`}>
            <Icon name="import" size={22} />
            <span className="start-action-copy">
              <span className="start-action-title">{t('welcome.importFile')}</span>
              <span className="start-action-hint" id={`${id}-file-hint`}>{t('welcome.importFileHint')}</span>
            </span>
            <RowArrow />
          </button>
          {onImportFolder && <button type="button" className="start-action welcome-folder-import" onClick={onImportFolder} aria-label={t('library.importFolder')} aria-describedby={`${id}-folder-hint`}>
            <Icon name="folder" size={22} />
            <span className="start-action-copy">
              <span className="start-action-title">{t('library.importFolder')}</span>
              <span className="start-action-hint" id={`${id}-folder-hint`}>{t('welcome.importFolderHint')}</span>
            </span>
            <RowArrow />
          </button>}
          <button type="button" className="start-action welcome-open-session" onClick={onOpenSession} aria-label={t('welcome.openSession')} aria-describedby={`${id}-session-hint`}>
            <svg className="ui-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>
            <span className="start-action-copy">
              <span className="start-action-title">{t('welcome.openSession')}</span>
              <span className="start-action-hint" id={`${id}-session-hint`}>{t('welcome.openSessionHint')}</span>
            </span>
            <RowArrow />
          </button>
        </div>
        <p className="start-drop-hint">{t('welcome.dropHint')}</p>
        <div className="start-example">
          <button type="button" className="start-action welcome-try-example" onClick={onTryExample} disabled={exampleLoading} aria-busy={exampleLoading} aria-label={t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')} aria-describedby={`${id}-example-hint`}>
            <svg className="ui-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></svg>
            <span className="start-action-copy">
              <span className="start-action-title">{t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')}</span>
              <span className="start-action-hint" id={`${id}-example-hint`}>{t('welcome.exampleHint')}</span>
            </span>
            <RowArrow />
          </button>
        </div>
      </div>
    </section>
  );
}

import { useI18n } from '../i18n';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  onImport: () => void;
  onImportFolder?: () => void;
  onOpenSession: () => void;
  onTryExample: () => void;
  exampleLoading?: boolean;
}

function WelcomeIcon({ name }: { name: 'file' | 'folder' | 'session' | 'example' }) {
  return <svg className="start-icon" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'file' && <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" /><path d="M14 3v5h5M12 17v-6m-3 3 3-3 3 3" /></>}
    {name === 'folder' && <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 10h18" /></>}
    {name === 'session' && <><path d="M10 20H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 10h13" /><circle cx="17" cy="17" r="5" /><path d="M17 14v3h2" /></>}
    {name === 'example' && <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" fill="currentColor" stroke="none" /></>}
  </svg>;
}

function RowArrow() {
  return <svg className="start-row-arrow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
}

export function WelcomeScreen({ onImport, onImportFolder, onOpenSession, onTryExample, exampleLoading = false }: WelcomeScreenProps) {
  const { t } = useI18n();

  return (
    <section className="workspace-empty start-screen" aria-label={t('welcome.title')}>
      <div className="start-content">
        <div className="start-imports">
          <button type="button" className="start-action start-action-primary welcome-import" onClick={onImport} aria-label={t('welcome.importFile')} aria-description={t('welcome.importFileHint')}>
            <WelcomeIcon name="file" />
            <span className="start-action-title">{t('welcome.importFile')}</span>
            <RowArrow />
          </button>
          {onImportFolder && <button type="button" className="start-action start-action-primary welcome-folder-import" onClick={onImportFolder} aria-label={t('library.importFolder')} aria-description={t('welcome.importFolderHint')}>
            <WelcomeIcon name="folder" />
            <span className="start-action-title">{t('library.importFolder')}</span>
            <RowArrow />
          </button>}
        </div>
        <div className="start-secondary">
          <button type="button" className="start-action welcome-open-session" onClick={onOpenSession} aria-label={t('welcome.openSession')} aria-description={t('welcome.openSessionHint')}>
            <WelcomeIcon name="session" />
            <span className="start-action-title">{t('welcome.openSession')}</span>
            <RowArrow />
          </button>
          <button type="button" className="start-action welcome-try-example" onClick={onTryExample} disabled={exampleLoading} aria-busy={exampleLoading} aria-label={t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')} aria-description={t('welcome.exampleHint')}>
            <WelcomeIcon name="example" />
            <span className="start-action-title">{t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')}</span>
            <RowArrow />
          </button>
        </div>
      </div>
    </section>
  );
}

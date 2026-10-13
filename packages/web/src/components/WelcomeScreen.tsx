import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import dayIcon from '../assets/app-icon-day.png';
import nightIcon from '../assets/app-icon-night.png';
import './WelcomeScreen.css';
import { StarLink } from './ProjectSupport';
import { engagementText } from '../engagement-copy';

interface WelcomeScreenProps {
  onImport: () => void;
  onImportFolder?: () => void;
  onOpenSession: () => void;
  onTryExample: () => void;
  exampleLoading?: boolean;
  /** Opens the in-app quick guide; the Help menu carries the same entry. */
  onOpenGuide?: () => void;
  onFirstCheck?: () => void;
}

function WelcomeIcon({ name }: { name: 'file' | 'folder' | 'session' | 'example' }) {
  return <svg className="start-icon" width="32" height="32" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'file' && <><path d="M14 50H10a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5h20l6 5" /><path d="M43 13H22a5 5 0 0 0-5 5v39a5 5 0 0 0 5 5h30a5 5 0 0 0 5-5V27Z" /><path d="M43 13v9a5 5 0 0 0 5 5h9M29 51c13 0 1-15 15-18" /><circle cx="27" cy="52" r="2.5" fill="var(--bg-panel)" /><circle cx="45" cy="32" r="2.5" fill="var(--bg-panel)" /></>}
    {(name === 'folder' || name === 'session') && <><path d="M5 18a5 5 0 0 1 5-5h12a6 6 0 0 1 4 2l4 3h24a5 5 0 0 1 5 5v29a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z" /><path d="M5 26h54" /></>}
    {name === 'example' && <><circle cx="32" cy="32" r="26" /><path d="m27 22 15 10-15 10Z" /></>}
  </svg>;
}

export function WelcomeScreen({ onImport, onImportFolder, onOpenSession, onTryExample, exampleLoading = false, onOpenGuide, onFirstCheck }: WelcomeScreenProps) {
  const { t, lang } = useI18n();
  const { resolved } = useTheme();

  return (
    <section className="workspace-empty start-screen" aria-label={t('welcome.title')}>
      <div className="start-content">
        <header className="start-brand">
          <img className="start-brand-icon" src={resolved === 'dark' ? nightIcon : dayIcon} alt="" width="136" height="136" draggable={false} />
          <h1>PathBlender</h1>
        </header>
        <div className="start-imports">
          <button type="button" className="start-action start-action-primary welcome-import" onClick={onImport} aria-label={t('welcome.importFile')} aria-description={t('welcome.importFileHint')}>
            <WelcomeIcon name="file" />
            <span className="start-action-title">{t('welcome.importFile')}</span>
          </button>
          {onImportFolder && <button type="button" className="start-action start-action-primary welcome-folder-import" onClick={onImportFolder} aria-label={t('library.importFolder')} aria-description={t('welcome.importFolderHint')}>
            <WelcomeIcon name="folder" />
            <span className="start-action-title">{t('library.importFolder')}</span>
          </button>}
        </div>
        <div className="start-secondary">
          <button type="button" className="start-action welcome-open-session" onClick={onOpenSession} aria-label={t('welcome.openSession')} aria-description={t('welcome.openSessionHint')}>
            <WelcomeIcon name="session" />
            <span className="start-action-title">{t('welcome.openSession')}</span>
          </button>
          <button type="button" className="start-action welcome-try-example" onClick={onTryExample} disabled={exampleLoading} aria-busy={exampleLoading} aria-label={t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')} aria-description={t('welcome.exampleHint')}>
            <WelcomeIcon name="example" />
            <span className="start-action-title">{t(exampleLoading ? 'welcome.loadingExample' : 'welcome.tryExample')}</span>
          </button>
        </div>
        <div className="start-guide">
          {onFirstCheck && <button type="button" className="start-guide-link" onClick={onFirstCheck} aria-description={engagementText(lang, 'firstCheckHint')}>{engagementText(lang, 'firstCheck')}</button>}
          {onOpenGuide && <button type="button" className="start-guide-link" onClick={onOpenGuide}>{t('menu.userGuide')}</button>}
          <StarLink />
        </div>
      </div>
    </section>
  );
}

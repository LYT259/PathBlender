import { useState } from 'react';
import { useI18n } from '../i18n';
import { engagementText } from '../engagement-copy';
import { GITHUB_URL, SHOW_PROJECT_SUPPORT, openProjectOnDesktop } from '../project-support';
import { Icon } from './Icon';
import './ProjectSupport.css';

const DISMISSED_KEY = 'pb.support-invitation.dismissed.v1';

export function StarLink({ className = '' }: { className?: string }) {
  const { lang } = useI18n();
  if (!SHOW_PROJECT_SUPPORT) return null;
  return <a className={`project-star ${className}`} href={GITHUB_URL} target="_blank" rel="noopener noreferrer"
    onClick={openProjectOnDesktop}><Icon name="star" size={16} /><span>{engagementText(lang, 'star')}</span></a>;
}

/** Only mounted at an earned moment. No timer, modal, star-status guessing or telemetry. */
export function ProjectSupport({ dismissible = false }: { dismissible?: boolean }) {
  const { lang } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
  });
  if (!SHOW_PROJECT_SUPPORT || (dismissible && dismissed)) return null;
  return <aside className="project-support" aria-label={engagementText(lang, 'support')}>
    <div><strong>{engagementText(lang, 'support')}</strong><p>{engagementText(lang, 'supportBody')}</p><StarLink /></div>
    {dismissible && <button type="button" className="tool-btn square" aria-label={engagementText(lang, 'dismiss')}
      onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* session only */ } }}>
      <Icon name="close" size={16} />
    </button>}
  </aside>;
}

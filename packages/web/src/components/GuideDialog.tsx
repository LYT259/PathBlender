import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { GUIDE_TOPICS, guideUrlForLang, pickLocalized } from '../guide-content';
import './GuideDialog.css';

/**
 * In-app quick guide (onboarding plan §5): the always-findable entry to what
 * the app is for and how each core operation works, shipped with the app so
 * it reads offline. Topic copy lives in guide-content.ts (EN + zh-Hans +
 * zh-Hant); every other UI language reads the English body.
 */
export function GuideDialog({ onClose, onOpenShortcuts, onOpenUrl }: {
  onClose: () => void;
  onOpenShortcuts: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const { t, lang } = useI18n();
  return <Dialog title={t('menu.userGuide')} onClose={onClose} className="guide-dialog">
    <div className="guide-topics">
      {GUIDE_TOPICS.map((topic) => <section key={topic.id} className="guide-topic">
        <h3>{pickLocalized(topic.title, lang)}</h3>
        <p>{pickLocalized(topic.intro, lang)}</p>
        {topic.points.length > 0 && <ul>
          {topic.points.map((point, i) => <li key={i}>{pickLocalized(point, lang)}</li>)}
        </ul>}
      </section>)}
    </div>
    <footer className="guide-footer">
      <button type="button" className="btn small" onClick={onOpenShortcuts}>{t('help.title')}</button>
      <a href={guideUrlForLang(lang)} target="_blank" rel="noopener noreferrer"
        onClick={(e) => { e.preventDefault(); onOpenUrl(guideUrlForLang(lang)); }}>{t('guide.fullOnline')}</a>
    </footer>
  </Dialog>;
}

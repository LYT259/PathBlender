import { useCallback, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import './UsageTip.css';

/** Remember completion locally; unavailable storage must not block the app. */
export function useUsageTip(topic: 'play' | 'checks') {
  const key = `ghpb.tip.${topic}.v1`;
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(key) !== 'done'; } catch { return true; }
  });
  const dismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(key, 'done'); } catch { /* session-only dismissal */ }
  }, [key]);
  return { visible, dismiss };
}

export function UsageTip({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useI18n();
  return <div className="usage-tip" role="note">
    <span>{text}</span>
    <button type="button" aria-label={t('onboarding.dismiss')} title={t('onboarding.dismiss')} onClick={onDismiss}>
      <Icon name="close" size={14} />
    </button>
  </div>;
}

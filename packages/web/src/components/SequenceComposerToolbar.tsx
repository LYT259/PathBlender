import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** Arrangement edits commit and autosave immediately (2026-10-05), so the
 *  toolbar carries no draft Save/Cancel/Reset actions anymore — Back is all
 *  it needs. `trailing` lands in the header's empty right half
 * (space-between absorbs it — nothing existing moves). */
export function SequenceComposerToolbar({ name, color, onBack, trailing }: {
  name: string;
  color: string;
  onBack: () => void;
  trailing?: ReactNode;
}) {
  const { t } = useI18n();
  return <header className="sequence-composer-header">
    <div className="sequence-composer-navigation">
      <button className="btn small sequence-back" type="button" onClick={onBack}>
        <Icon name="back" size={15} />{t('sequence.back')}
      </button>
      <div className="sequence-composer-heading">
        <h2>{t('sequence.arrange')}</h2>
        <span className="sequence-active-name"><i style={{ background: color }} />{name}</span>
      </div>
    </div>
    {trailing}
  </header>;
}

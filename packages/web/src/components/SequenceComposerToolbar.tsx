import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** UI contract only. The owner supplies semantic dirty state and draft/history actions. */
export interface SequenceDraftActions {
  hasChanges: boolean;
  canReset: boolean;
  onReset: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function SequenceComposerToolbar({ name, color, onBack, draft }: {
  name: string;
  color: string;
  onBack: () => void;
  draft?: SequenceDraftActions;
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
    <div className="sequence-composer-actions">
      <button className="btn small sequence-reset" type="button" disabled={!draft?.hasChanges || !draft.canReset} onClick={draft?.onReset}>
        <Icon name="refresh" size={14} />{t('sequence.reset')}
      </button>
      {draft?.hasChanges && <>
        <button className="btn small accent sequence-save" type="button" onClick={draft.onSave}>{t('prefs.save')}</button>
        <button className="btn small sequence-cancel" type="button" onClick={draft.onCancel}>{t('prefs.cancel')}</button>
      </>}
    </div>
  </header>;
}

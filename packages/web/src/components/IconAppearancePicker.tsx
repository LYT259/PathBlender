import { useId } from 'react';
import { useI18n } from '../i18n';
import type { IconAppearanceMode } from '../app-icon';
import dayIcon from '../assets/app-icon-day.png';
import nightIcon from '../assets/app-icon-night.png';

/** Controlled picker for the independent app-icon appearance preference
 * (app-icon.tsx) — separate from the interface theme on purpose. The parent
 * stages the draft; Save applies and persists it, Cancel discards it. */
export type { IconAppearanceMode };

export function IconAppearancePicker({ value, onChange }: {
  value: IconAppearanceMode;
  onChange: (value: IconAppearanceMode) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return <fieldset className="preferences-appearance preferences-icon-appearance" aria-describedby={`${id}-hint`}>
    <legend>{t('prefs.appIcon')}</legend>
    <div className="preferences-theme-options">
      {(['system', 'light', 'dark'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
        <input type="radio" name={`${id}-icon-appearance`} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
        <span className={`preferences-icon-preview ${choice}`} aria-hidden="true">
          {choice === 'system' ? <span className="preferences-icon-pair">
            <img src={dayIcon} alt="" draggable={false} width="48" height="48" />
            <img src={nightIcon} alt="" draggable={false} width="48" height="48" />
          </span> : <img src={choice === 'light' ? dayIcon : nightIcon} alt="" draggable={false} width="56" height="56" />}
        </span>
        <span>{t(`theme.${choice}`)}</span>
      </label>)}
    </div>
    <p className="preferences-icon-hint" id={`${id}-hint`}>{t('prefs.appIconHint')}</p>
  </fieldset>;
}

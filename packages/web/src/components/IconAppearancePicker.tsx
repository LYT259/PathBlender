import { useId } from 'react';
import { useI18n } from '../i18n';
import { ICON_STYLE_ARTWORK, type IconAppearanceMode, type IconStyle } from '../app-icon';

/** Controlled picker for the independent app-icon preferences
 * (app-icon.tsx) — a style family (classic / monochrome) plus the
 * appearance mode (system / light / dark) applied to whichever family is
 * selected. Both stay separate from the interface theme on purpose, and
 * from each other: choosing one never resets the other. The parent stages
 * drafts; Save applies and persists them, Cancel discards them. */
export type { IconAppearanceMode, IconStyle };

export function IconAppearancePicker({ value, onChange, style, onStyleChange }: {
  value: IconAppearanceMode;
  onChange: (value: IconAppearanceMode) => void;
  style: IconStyle;
  onStyleChange: (value: IconStyle) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const artwork = ICON_STYLE_ARTWORK[style];
  return <fieldset className="preferences-appearance preferences-icon-appearance">
    <legend>{t('prefs.appIcon')}</legend>
    <fieldset className="preferences-icon-subgroup">
      <legend>{t('prefs.iconStyle')}</legend>
      <div className="preferences-theme-options preferences-icon-style-options">
        {(['classic', 'monochrome'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
          <input type="radio" name={`${id}-icon-style`} value={choice} checked={style === choice} onChange={() => onStyleChange(choice)} />
          <span className="preferences-icon-preview" aria-hidden="true">
            <IconPair light={ICON_STYLE_ARTWORK[choice].light} dark={ICON_STYLE_ARTWORK[choice].dark} />
          </span>
          <span>{t(`prefs.iconStyle.${choice}`)}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="preferences-icon-subgroup">
      <legend>{t('prefs.iconAppearance')}</legend>
      <div className="preferences-theme-options">
        {(['system', 'light', 'dark'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
          <input type="radio" name={`${id}-icon-appearance`} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
          <span className={`preferences-icon-preview ${choice}`} aria-hidden="true">
            {choice === 'system' ? <IconPair light={artwork.light} dark={artwork.dark} />
              : <img src={artwork[choice]} alt="" draggable={false} width="56" height="56" />}
          </span>
          <span>{t(`theme.${choice}`)}</span>
        </label>)}
      </div>
    </fieldset>
  </fieldset>;
}

function IconPair({ light, dark }: { light: string; dark: string }) {
  return <span className="preferences-icon-pair">
    <img src={light} alt="" draggable={false} width="48" height="48" />
    <img src={dark} alt="" draggable={false} width="48" height="48" />
  </span>;
}

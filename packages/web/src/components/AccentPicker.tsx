import { useId } from 'react';
import { useI18n } from '../i18n';
import { ACCENT_CHOICES, type AccentColor } from '../theme';

/** Swatch fills are the fixed base chips (the user-specified values), not the
 *  theme-derived tokens — a preview must show the accent's identity, not its
 *  per-mode adjustment, and must stay visible in both modes on its own. */
export const ACCENT_SWATCH: Record<AccentColor, string> = {
  blue: '#007aff',
  red: '#911d23',
  steel: '#355c7d',
  bronze: '#b08d57',
  silver: '#b5b8bb',
};

/**
 * Controlled picker for the interface accent color (theme.tsx, 2026-10-17).
 * Five named swatch radios in the user-fixed order (ACCENT_CHOICES): azure,
 * crimson, steel blue, bronze, silver gray. The default (azure) carries a
 * localized "Default" mark next to its name. Selection shows through the
 * radio's checked outline (an explicit border, never color alone) and works
 * with keyboard and screen readers via the native radio group. The parent
 * stages drafts; Save applies and persists, Cancel discards. Independent
 * from the theme mode and the app-icon preferences on purpose. Display
 * names are product vocabulary — the stored ids never change with them.
 */
export function AccentPicker({ value, onChange }: {
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  return <fieldset className="preferences-appearance preferences-accent-appearance">
    <legend>{t('prefs.accent')}</legend>
    <div className="preferences-theme-options preferences-accent-options">
      {ACCENT_CHOICES.map((choice) => <label key={choice} className="preferences-theme-choice">
        <input type="radio" name={`${id}-accent`} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
        <span className="preferences-accent-swatch" aria-hidden="true" style={{ background: ACCENT_SWATCH[choice] }} />
        <span>{t(`accent.${choice}`)}
          {choice === 'blue' && <span className="preferences-accent-default">{t('accent.default')}</span>}
        </span>
      </label>)}
    </div>
  </fieldset>;
}

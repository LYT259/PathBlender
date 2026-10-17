import { useId } from 'react';
import { useI18n } from '../i18n';
import type { AccentColor } from '../theme';

/** Swatch fills are the fixed base chips (the icon palette values), not the
 *  theme-derived tokens — a preview must show the accent's identity, not its
 *  per-mode adjustment, and must stay visible in both modes on its own. */
export const ACCENT_SWATCH: Record<AccentColor, string> = {
  blue: '#007aff',
  red: '#911d23',
  silver: '#b5b8bb',
};

/**
 * Controlled picker for the interface accent color (theme.tsx, 2026-10-17).
 * Three named swatch radios: selection shows through the radio's checked
 * outline (an explicit border, never color alone) and works with keyboard
 * and screen readers via the native radio group. The parent stages drafts;
 * Save applies and persists, Cancel discards. Independent from the theme
 * mode and the app-icon preferences on purpose.
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
      {(['blue', 'red', 'silver'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
        <input type="radio" name={`${id}-accent`} value={choice} checked={value === choice} onChange={() => onChange(choice)} />
        <span className="preferences-accent-swatch" aria-hidden="true" style={{ background: ACCENT_SWATCH[choice] }} />
        <span>{t(`accent.${choice}`)}</span>
      </label>)}
    </div>
  </fieldset>;
}

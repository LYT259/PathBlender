import { useI18n } from '../i18n';
import type { MouseControlsScheme } from '../mouse-controls';

/** Flat mouse illustration; leader lines remain physically left/right in RTL. */
export function MouseControlsDiagram({ scheme }: { scheme: MouseControlsScheme }) {
  const { t } = useI18n();
  return <figure className="mouse-controls-diagram" aria-label={t('prefs.mouse.table')}>
    <svg className="mouse-controls-drawing" viewBox="0 0 480 240" aria-hidden="true" focusable="false">
      <path className="mouse-shell" d="M240 18 C207 18 186 41 184 76 L181 157 C180 198 203 222 240 222 C277 222 300 198 299 157 L296 76 C294 41 273 18 240 18Z" />
      <path className="mouse-seam" d="M240 19V53 M185 104Q240 117 295 104" />
      <rect className="mouse-wheel" x="233" y="51" width="14" height="39" rx="7" />
      <path className="mouse-wheel-grooves" d="M236 61H244 M236 68H244 M236 75H244 M236 82H244" />
      <g className="mouse-leaders">
        <path d="M215 60H144 M265 60H336 M238 84L144 177 M244 61L336 177" />
      </g>
      <g className="mouse-anchors">
        <circle cx="215" cy="60" r="3" /><circle cx="265" cy="60" r="3" />
        <circle cx="238" cy="84" r="3" /><circle cx="244" cy="61" r="3" />
      </g>
    </svg>
    {(['left', 'right', 'middle', 'wheel'] as const).map((button) => <div key={button} className={`mouse-callout mouse-callout-${button}`}>
      <span>{t(`prefs.mouse.btn.${button}`)}</span>
      <strong>{t(`prefs.mouse.${scheme}.${button}`)}</strong>
    </div>)}
  </figure>;
}

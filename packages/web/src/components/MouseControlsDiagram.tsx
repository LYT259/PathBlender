import { useEffect, useState } from 'react';
import type { IconAppearanceMode } from '../app-icon';
import dayIcon from '../assets/app-icon-day.png';
import nightIcon from '../assets/app-icon-night.png';
import { useI18n } from '../i18n';
import type { MouseControlsScheme } from '../mouse-controls';

/** Flat mouse illustration; leader lines remain physically left/right in RTL. */
export function MouseControlsDiagram({ scheme, iconMode = 'system' }: { scheme: MouseControlsScheme; iconMode?: IconAppearanceMode }) {
  const { t } = useI18n();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const darkIcon = iconMode === 'dark' || (iconMode === 'system' && systemDark);
  return <figure className="mouse-controls-diagram" aria-label={t('prefs.mouse.table')}>
    <svg className="mouse-controls-drawing" viewBox="0 0 480 240" aria-hidden="true" focusable="false">
      <path className="mouse-shell" d="M240 18 C207 18 186 41 184 76 L181 157 C180 198 203 222 240 222 C277 222 300 198 299 157 L296 76 C294 41 273 18 240 18Z" />
      <path className="mouse-seam" d="M240 19V53 M185 104Q240 117 295 104" />
      <rect className="mouse-wheel" x="233" y="51" width="14" height="39" rx="7" />
      <path className="mouse-wheel-grooves" d="M236 61H244 M236 68H244 M236 75H244 M236 82H244" />
      <g className="mouse-leaders">
        <path d="M215 60H144 M265 60H336 M240 70.5L144 177 M244 57L336 177 M244 84L336 177" />
      </g>
      <g className="mouse-anchors">
        <circle cx="215" cy="60" r="3" /><circle cx="265" cy="60" r="3" />
        <circle cx="240" cy="70.5" r="3" />
      </g>
      <path className="mouse-scroll-arrows" d="M237 60l3-3 3 3 M237 81l3 3 3-3" />
      <image href={darkIcon ? nightIcon : dayIcon} x="221" y="145" width="38" height="38" />
    </svg>
    {(['left', 'right', 'middle', 'wheel'] as const).map((button) => <div key={button} className={`mouse-callout mouse-callout-${button}`}>
      <span>{t(`prefs.mouse.btn.${button}`)}</span>
      <strong>{t(`prefs.mouse.${scheme}.${button}`)}</strong>
    </div>)}
  </figure>;
}

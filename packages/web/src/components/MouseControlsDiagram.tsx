import { useEffect, useState } from 'react';
import { ICON_STYLE_ARTWORK, type IconAppearanceMode, type IconStyle } from '../app-icon';
import { useI18n } from '../i18n';
import { resolveMouseAction, type CustomMouseMap, type MouseControlsScheme } from '../mouse-controls';

type MouseCallout = { button: 'left' | 'right' | 'middle' | 'wheel'; action: 'rotate' | 'constrained' | 'pan' | 'zoom' | 'roll' };

/** Flat mouse illustration; leader lines remain physically left/right in RTL. */
export function MouseControlsDiagram({ scheme, iconMode = 'system', iconStyle = 'classic', constrained = false, custom }: { scheme: MouseControlsScheme; iconMode?: IconAppearanceMode; iconStyle?: IconStyle; constrained?: boolean; custom?: CustomMouseMap }) {
  const { t } = useI18n();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const buttons = (['left', 'right', 'middle', 'wheel'] as const).flatMap<MouseCallout>((button) => {
    if (button === 'wheel') return [{ button, action: 'zoom' as const }];
    const action = resolveMouseAction(scheme, { left: 0, middle: 1, right: 2 }[button], { ctrlKey: false, altKey: false, shiftKey: false }, constrained, custom);
    if (action.kind === 'none') return [];
    // Plain buttons never produce 'roll' (Alt-only) or 'dragZoom'
    // (Shift-only); the mapping stays exhaustive so a future scheme that
    // puts either on a bare button renders correctly.
    const callout: MouseCallout['action'] =
      action.kind === 'orbit' ? (action.constrained ? 'constrained' : 'rotate')
        : action.kind === 'pan' ? 'pan'
          : action.kind === 'roll' ? 'roll'
            : 'zoom';
    return [{ button, action: callout }];
  });
  const leaders = {
    left: 'M215 60H144', right: 'M265 60H336',
    middle: 'M240 70.5L144 177', wheel: 'M244 57L336 177 M244 84L336 177',
  };
  const anchors = { left: [215, 60], right: [265, 60], middle: [240, 70.5] };
  const darkIcon = iconMode === 'dark' || (iconMode === 'system' && systemDark);
  // The pad the mouse drags around is the app icon itself, so it mirrors the
  // icon preference (mode + style), not the interface theme.
  const artwork = ICON_STYLE_ARTWORK[iconStyle];
  return <figure className="mouse-controls-diagram" aria-label={t('prefs.mouse.table')}>
    <svg className="mouse-controls-drawing" viewBox="0 0 480 240" aria-hidden="true" focusable="false">
      <path className="mouse-shell" d="M240 18 C207 18 186 41 184 76 L181 157 C180 198 203 222 240 222 C277 222 300 198 299 157 L296 76 C294 41 273 18 240 18Z" />
      <path className="mouse-seam" d="M240 19V53 M185 104Q240 117 295 104" />
      <rect className="mouse-wheel" x="233" y="51" width="14" height="39" rx="7" />
      <path className="mouse-wheel-grooves" d="M236 61H244 M236 68H244 M236 75H244 M236 82H244" />
      {buttons.map(({ button }) => <g key={button} data-mouse-button={button}>
        <path className="mouse-leaders" d={leaders[button]} />
        {button !== 'wheel' && <circle className="mouse-anchors" cx={anchors[button][0]} cy={anchors[button][1]} r="3" />}
      </g>)}
      <path className="mouse-scroll-arrows" d="M237 60l3-3 3 3 M237 81l3 3 3-3" />
      <image href={darkIcon ? artwork.dark : artwork.light} x="221" y="145" width="38" height="38" />
    </svg>
    {buttons.map(({ button, action }) => <div key={button} className={`mouse-callout mouse-callout-${button}`}>
      <span>{t(`prefs.mouse.btn.${button}`)}</span>
      <strong>{t(`prefs.mouse.${action}`)}</strong>
    </div>)}
  </figure>;
}

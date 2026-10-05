import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** Selection/history/mirror persistence belong to the owner; this component only presents actions. */
export function RobotContextMenu({ name, x, y, mirrored = false, onArrange, onMirror, onRemove, onClose }: {
  name: string;
  x: number;
  y: number;
  mirrored?: boolean;
  onArrange?: () => void;
  onMirror?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = menuRef.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) });
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const run = (action: (() => void) | undefined) => { action?.(); onClose(); };
  return createPortal(<div ref={menuRef} className="robot-context-menu" role="menu" aria-label={name}
    style={{ left: position.x, top: position.y }} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); returnFocus.current?.focus(); onClose(); return; }
      if (event.key === 'Tab') { onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <div className="robot-context-name" role="presentation">{name}</div>
    <button type="button" role="menuitem" disabled={!onArrange} onClick={() => run(onArrange)}><Icon name="timeline" size={16} />{t('sequence.arrange')}</button>
    <button type="button" role="menuitemcheckbox" aria-checked={mirrored} disabled={!onMirror} onClick={() => run(onMirror)}><Icon name="mirror" size={16} />{t('robots.mirror')}<span className="robot-menu-check">{mirrored && <Icon name="check" size={14} />}</span></button>
    <div className="robot-context-divider" role="separator" />
    <button type="button" role="menuitem" className="is-destructive" disabled={!onRemove} onClick={() => run(onRemove)}><Icon name="trash" size={16} />{t('robots.removeFromSession')}</button>
  </div>, document.body);
}

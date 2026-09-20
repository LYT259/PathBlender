import { useEffect, useRef, type ReactNode } from 'react';

/** Shared modal: move focus in, keep keyboard navigation inside, return it on close. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="prefs-overlay" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="prefs-modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const elements = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
      const first = elements[0], last = elements.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
    }}>{children}</div>
  </div>;
}

import { Children, isValidElement, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './LanguagePicker.css';
import './SelectControl.css';

type Option = { value: string; label: ReactNode; disabled?: boolean; hidden?: boolean; title?: string };
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children' | 'multiple' | 'size'> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

/** Single-select dropdown sharing the language picker's visual language.
 * Takes plain flat <option> children and reports picks through onValueChange
 * with the same string values as the native <select> it replaced. */
export function SelectControl({ value, onValueChange, children, ...native }: Props) {
  const options = Children.toArray(children).filter(isValidElement).map((child) => {
    const option = child.props as { value: string; children: ReactNode; disabled?: boolean; hidden?: boolean; title?: string };
    return { value: String(option.value), label: option.children, disabled: option.disabled, hidden: option.hidden, title: option.title };
  });
  return <SelectDropdown value={value} onValueChange={onValueChange} options={options} native={native} />;
}

function SelectDropdown({ value, onValueChange, options, native }: {
  value: string; onValueChange: (value: string) => void; options: Option[];
  native: Omit<Props, 'value' | 'onValueChange' | 'children'>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const visible = options.filter((option) => !option.hidden);
  const enabled = visible.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value);
  const label = native['aria-label'];
  const labelledBy = native['aria-labelledby'];
  const close = () => { setOpen(false); setActive(null); };
  function expand(last = false) {
    if (native.disabled) return;
    setActive(enabled.find((option) => option.value === value)?.value ?? (last ? enabled.at(-1)?.value : enabled[0]?.value) ?? null);
    setPosition({ visibility: 'hidden' });
    setOpen(true);
  }
  function pick(option: Option) {
    if (option.disabled) return;
    onValueChange(option.value); close(); trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = trigger.current, panel = popover.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const rtl = getComputedStyle(anchor).direction === 'rtl';
      const margin = 8, gap = 8;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - margin * 2);
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const desired = Math.min(panel.scrollHeight, 192);
      const up = below < desired && above > below;
      const maxHeight = Math.max(0, Math.min(192, up ? above : below));
      const height = Math.min(desired, maxHeight);
      setPosition({ width, maxHeight,
        left: Math.max(margin, Math.min(rtl ? rect.left : rect.right - width, window.innerWidth - width - margin)),
        top: up ? rect.top - gap - height : rect.bottom + gap,
        direction: rtl ? 'rtl' : 'ltr',
      });
    }
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popover.current?.contains(event.target)) return;
      place();
    };
    place();
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const container = list.current;
    const row = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !row) return;
    if (row.offsetTop < container.scrollTop) container.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight;
    }
  }, [open, active, position]);

  return <>
    <button ref={trigger} type="button" role="combobox" id={native.id} name={native.name}
      className={`language-picker-trigger select-control-trigger ${native.className ?? ''}`}
      style={native.style} title={native.title} disabled={native.disabled} tabIndex={native.tabIndex}
      aria-label={label} aria-labelledby={labelledBy} aria-describedby={native['aria-describedby']}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open && active !== null ? `${id}-option-${visible.findIndex((option) => option.value === active)}` : undefined}
      onClick={() => open ? close() : expand()}
      onBlur={(event) => { if (!popover.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onKeyDown={(event) => {
        // Tab still reaches a parent dialog's focus trap. A second Escape
        // (with the list closed) belongs to that parent, as on a native select.
        if (event.key === 'Tab') { close(); return; }
        if (event.key === 'Escape' && !open) return;
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { if (open) event.preventDefault(); close(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { expand(event.key === 'ArrowUp'); return; }
          const current = enabled.findIndex((option) => option.value === active);
          const next = Math.max(0, Math.min(enabled.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
          setActive(enabled[next]?.value ?? null); return;
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); if (!open) expand();
          setActive((event.key === 'Home' ? enabled[0] : enabled.at(-1))?.value ?? null); return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!open) expand();
          else { const option = enabled.find((item) => item.value === active); if (option) pick(option); }
        }
      }}>
      <span dir="auto">{selected?.label ?? value}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {open && createPortal(<div ref={popover} className="language-picker-popover select-control-popover" style={position}
      onMouseDown={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()}>
      <div ref={list} className="language-picker-results select-control-results" role="listbox" id={`${id}-list`}
        aria-label={label} aria-labelledby={labelledBy}>
        {visible.map((option, index) => <button type="button" role="option" tabIndex={-1} key={option.value}
          id={`${id}-option-${index}`} data-value={option.value} className={`language-picker-option${option.value === active ? ' language-picker-active' : ''}`}
          aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          data-active={option.value === active} title={option.title}
          onClick={(event) => { event.stopPropagation(); pick(option); }}>
          <span className="language-picker-names"><span dir="auto">{option.label}</span>
            {option.title && <small dir="auto">{option.title}</small>}
          </span>
          <span className="language-picker-check">{option.value === value && <Icon name="check" size={16} />}</span>
        </button>)}
      </div>
    </div>, document.body)}
  </>;
}

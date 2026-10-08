import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LANG_META, langLabel, useI18n, type LangChoice } from '../i18n';
import { searchLanguages } from '../i18n/language-search';
import { Icon } from './Icon';
import './LanguagePicker.css';

/**
 * The settings language control: a trigger plus a searchable listbox. The
 * search matches the target language's name in any of the 40 UI languages
 * (language-search.ts), the result order is the registry's stable order, and
 * picking a row only reports through `onChange` — the panel's draft/save
 * semantics decide when it takes effect.
 */
/** Scroll one option into view inside the list — manually, because
 * scrollIntoView() also scrolls ancestor containers and would drag the
 * anchored popover's measurements out from under the placement effect. */
function scrollOptionIntoList(list: HTMLElement, index: number) {
  const el = list.children[index] as HTMLElement | undefined;
  if (!el) return;
  const top = el.offsetTop, bottom = top + el.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

export function LanguagePicker({ value, onChange, labelledBy }: {
  value: LangChoice;
  onChange: (value: LangChoice) => void;
  labelledBy: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Index into `results` of the arrow-key cursor; null while resting in the input. */
  const [active, setActive] = useState<number | null>(null);
  const [flipUp, setFlipUp] = useState(false);
  const results = useMemo(() => searchLanguages(query), [query]);
  const selectedIndex = results.indexOf(value);
  const label = (choice: LangChoice) => choice === 'system' ? t('prefs.langSystem') : langLabel(choice);

  function close(focusTrigger = true) {
    setOpen(false);
    setQuery('');
    setActive(null);
    if (focusTrigger) trigger.current?.focus();
  }

  // Combobox pattern: DOM focus stays in the input; arrows move aria-activedescendant.
  function moveActive(step: 1 | -1) {
    if (!results.length) return;
    setActive((current) => {
      if (current === null) {
        const anchor = step === 1 ? selectedIndex : results.length - 1;
        return anchor >= 0 ? anchor : 0;
      }
      return Math.min(results.length - 1, Math.max(0, current + step));
    });
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
        setActive(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  // On open: keep the popover inside the viewport — flip above the trigger
  // when only there is room, otherwise shrink the scrolling list by exactly
  // the deficit — and bring the current choice into view (it can be 40 rows
  // down). Runs once per open; query changes only shrink the list, never
  // grow it past the capped height, so the placement stays valid.
  useLayoutEffect(() => {
    if (!open) return;
    const pop = popover.current, trig = trigger.current, list = listbox.current;
    if (pop && trig) {
      const popRect = pop.getBoundingClientRect();
      const trigRect = trig.getBoundingClientRect();
      const GAP = 8;
      const fitsBelow = trigRect.bottom + GAP + popRect.height <= window.innerHeight;
      const fitsAbove = trigRect.top - GAP >= popRect.height;
      setFlipUp(!fitsBelow && fitsAbove);
      if (list) {
        list.style.maxHeight = '';
        if (!fitsBelow && !fitsAbove) {
          const deficit = trigRect.bottom + GAP + popRect.height - window.innerHeight;
          const clamped = Math.max(64, list.getBoundingClientRect().height - deficit);
          list.style.maxHeight = `${clamped}px`;
        }
      }
    }
    if (selectedIndex >= 0 && listbox.current) {
      scrollOptionIntoList(listbox.current, selectedIndex);
    }
  }, [open]);

  // Keep the arrow cursor in view while walking the list.
  useLayoutEffect(() => {
    if (active === null || !listbox.current) return;
    scrollOptionIntoList(listbox.current, active);
  }, [active]);

  return <div className="language-picker" ref={root} onKeyDown={(event) => {
    // During IME composition the keys belong to the input method, not us.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation(); // Escape closes the picker, not the settings panel behind it.
      close();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(results.length ? 0 : null); }
    else if (event.key === 'End') { event.preventDefault(); setActive(results.length ? results.length - 1 : null); }
    else if (event.key === 'Enter' && active !== null) {
      event.preventDefault();
      const picked = results[active];
      if (picked !== undefined) { onChange(picked); close(); }
    }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setQuery('');
      setActive(null);
    }
  }}>
    <button type="button" className="language-picker-trigger" ref={trigger}
      aria-labelledby={`${labelledBy} ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={`${id}-listbox`}
      onClick={() => open ? close(false) : setOpen(true)}>
      <span id={`${id}-value`} dir="auto">{label(value)}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
    </button>
    {open && <div className={`language-picker-popover${flipUp ? ' language-picker-popover-up' : ''}`} ref={popover}>
      <div className="language-picker-search-area">
        <div className="language-picker-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={input} type="text" inputMode="search" value={query} dir="auto"
            role="combobox" aria-expanded aria-controls={`${id}-listbox`} aria-autocomplete="list"
            aria-label={t('prefs.languageSearch')}
            aria-activedescendant={active !== null ? `${id}-opt-${active}` : undefined}
            placeholder={t('prefs.languageSearchPlaceholder')} autoComplete="off" spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setActive(null); }} />
          {query && <button type="button" className="language-picker-clear" aria-label={t('prefs.languageSearchClear')}
            onClick={() => { setQuery(''); setActive(null); input.current?.focus(); }}><Icon name="close" size={14} /></button>}
        </div>
      </div>
      {results.length ? <div className="language-picker-results" role="listbox" ref={listbox}
        id={`${id}-listbox`} aria-labelledby={labelledBy}>
        {results.map((choice, index) => <button type="button" role="option" tabIndex={-1} key={choice}
          id={`${id}-opt-${index}`}
          className={`language-picker-option${choice === 'system' ? ' language-picker-system' : ''}${index === active ? ' language-picker-active' : ''}`}
          aria-selected={choice === value} onClick={() => { onChange(choice); close(); }}>
          <span className="language-picker-names"><span dir="auto">{label(choice)}</span>
            {choice !== 'system' && LANG_META[choice].englishName !== label(choice) &&
              <small dir="ltr">{LANG_META[choice].englishName}</small>}
          </span>
          <span className="language-picker-check">{choice === value && <Icon name="check" size={16} />}</span>
        </button>)}
      </div> : <div className="language-picker-empty" role="status">
        <strong>{t('prefs.languageSearchEmpty')}</strong><p>{t('prefs.languageSearchEmptyHint')}</p>
        <button type="button" onClick={() => { setQuery(''); setActive(null); input.current?.focus(); }}>{t('prefs.languageSearchClear')}</button>
      </div>}
    </div>}
  </div>;
}

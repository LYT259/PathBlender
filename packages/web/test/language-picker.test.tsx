import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguagePicker } from '../src/components/LanguagePicker';
import { I18nProvider, LANGUAGES, langLabel, type LangChoice } from '../src/i18n';

/**
 * LanguagePicker behaviour: the search input actually filters (in any of the
 * 43 UI languages, whatever the UI is showing), the list and selection obey
 * the panel's draft semantics (pick reports through onChange; typing never
 * selects), the empty state clears back to the full list, and the combobox
 * keyboard contract holds — arrows/Home/End walk options, Enter picks,
 * Escape closes the picker without closing the panel behind it, and IME
 * composition keys are left alone.
 */

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

function renderPicker(props: Partial<Parameters<typeof LanguagePicker>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(<I18nProvider>
    <LanguagePicker value={props.value ?? 'en'} onChange={onChange} labelledBy="lang-label" {...props} />
  </I18nProvider>);
  // Closed: the trigger is a plain button (the combobox input only exists open).
  const trigger = screen.getByRole('button', { expanded: false }) as HTMLButtonElement;
  return { onChange, trigger, ...view };
}

const open = async (trigger: HTMLElement) => {
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
  return screen.getByRole('combobox') as HTMLInputElement;
};

describe('language picker', () => {
  it('opens the full list: system first, then the registry order', async () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(LANGUAGES.length);
    expect(options[0]).toHaveTextContent('Follow system');
    // Registry order pinned by the i18n tests: Albanian leads the languages.
    expect(options[1]).toHaveTextContent(langLabel('sq'));
  });

  it('renders every language row’s mark chip as decoration, hidden from AT', async () => {
    // The mark (简/繁/EN/あ…) is a visual disambiguator for rows whose endonyms
    // look alike; screen readers already get the full endonym, so the chip is
    // aria-hidden decoration — and never empty, or it would paint a blank chip.
    const { trigger } = renderPicker();
    fireEvent.click(trigger);
    await screen.findAllByRole('option');
    const marks = document.querySelectorAll('.language-picker-mark');
    expect(marks).toHaveLength(LANGUAGES.length - 1); // every row but 'system'
    for (const mark of marks) {
      expect(mark).toHaveAttribute('aria-hidden', 'true');
      expect(mark.textContent?.trim()).not.toBe('');
    }
    // Spot-pin the two families the chip exists to disambiguate.
    const byValue = (v: string) => document.querySelector(`[data-value="${v}"] .language-picker-mark`);
    expect(byValue('zh-tw')).toHaveTextContent('繁');
    expect(byValue('zh-mo')).toHaveTextContent('繁');
    expect(byValue('en-GB')).toHaveTextContent('EN');
  });

  it('typing filters to the matching languages and shows their names', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Deutsch');
  });

  it('filters in a language other than the UI language', async () => {
    // UI is English; the query is Chinese and French. Same result.
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: '德语' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Deutsch');
    fireEvent.change(input, { target: { value: 'allemand' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
  });

  it('partial and accent-folded queries match', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'Germ' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'francais' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Français');
  });

  it('the system row is findable by its label', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'Follow system' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Follow system');
  });

  it('a query with no matches shows the empty state, and clearing restores the list', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'zzzznotalanguage' } });
    const empty = await screen.findByRole('status');
    expect(empty).toHaveTextContent('No matching languages');
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(LANGUAGES.length));
    // Clearing hands focus back to the input so the user can keep typing.
    expect(document.activeElement).toBe(input);
  });

  it('the inline clear button empties the query and restores the list', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    const clear = screen.getByRole('button', { name: 'Clear search' });
    // The empty-state clear is only rendered when nothing matches; the
    // inline × sits inside the search row.
    fireEvent.click(clear);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(LANGUAGES.length));
    expect(input).toHaveValue('');
    expect(document.activeElement).toBe(input);
  });

  it('typing never selects — only a click reports through onChange', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option'));
    expect(onChange).toHaveBeenCalledWith('de');
    // Picking closes the picker and returns focus to the trigger.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('arrow keys walk the options from the current selection, Enter picks, Escape closes', async () => {
    const { trigger, onChange } = renderPicker({ value: 'en' });
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // The cursor anchors on the current choice first…
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { selected: true }).id,
    );
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // …then steps within the filtered results (en → fil in registry order).
    const active = screen.getByRole('option', { name: /Filipino/ });
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('fil');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // Enter-pick closes and returns focus to the trigger, like a click-pick.
    expect(document.activeElement).toBe(trigger);
  });

  it('Home and End jump to the ends of the list', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'End' });
    const last = screen.getAllByRole('option').at(-1)!;
    expect(input.getAttribute('aria-activedescendant')).toBe(last.id);
    fireEvent.keyDown(input, { key: 'Home' });
    const first = screen.getAllByRole('option')[0]!;
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('system');
  });

  it('Escape closes the picker without closing the panel behind it', async () => {
    const panelKey = vi.fn();
    const windowKey = vi.fn();
    // The desktop prefs window listens natively at the window level
    // (prefs-window.tsx), past the React root — stopPropagation must reach it.
    window.addEventListener('keydown', windowKey);
    const onChange = vi.fn();
    try {
      render(<I18nProvider>
        <div onKeyDown={panelKey}>
          <LanguagePicker value={'en' as LangChoice} onChange={onChange} labelledBy="lang-label" />
        </div>
      </I18nProvider>);
      const trigger = screen.getByRole('button', { expanded: false });
      const input = await open(trigger);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(panelKey).not.toHaveBeenCalled();
      expect(windowKey).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    } finally {
      window.removeEventListener('keydown', windowKey);
    }
  });

  it('keys during IME composition do not navigate or select', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true } as never);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    // Escape mid-composition cancels the IME session; it must not close the picker.
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closing wipes the query, so reopening starts from the full list', async () => {
    const { trigger } = renderPicker();
    let input = await open(trigger);
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.click(trigger); // toggle closed
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    input = await open(trigger);
    expect(input).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(LANGUAGES.length);
  });

  it('shows its copy in the active UI language', async () => {
    localStorage.setItem('pb.lang', 'zh');
    const onChange = vi.fn();
    render(<I18nProvider>
      <LanguagePicker value="en" onChange={onChange} labelledBy="lang-label" />
    </I18nProvider>);
    const input = await open(screen.getByRole('button', { expanded: false }));
    expect(input).toHaveAttribute('placeholder', '输入语言名称…');
    expect(screen.getByRole('option', { selected: false, name: /简体中文/ })).toBeInTheDocument();
  });

  it('opening lands focus in the search box', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    expect(document.activeElement).toBe(input);
  });

  it('wires the combobox contract across trigger, input, listbox and options', async () => {
    const { trigger } = renderPicker();
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const input = await open(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    // aria-controls is the glue both the trigger and the input share with the list.
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    // The list takes its accessible name from the same settings label as the trigger.
    expect(listbox).toHaveAttribute('aria-labelledby', 'lang-label');
    // At rest the cursor is nowhere, and exactly the current choice is selected.
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    const selected = screen.getAllByRole('option', { selected: true });
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute('data-value', 'en');
  });

  it('typing resets the arrow cursor', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).not.toBeNull();
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    // A new result list invalidates the old index; the cursor restarts in the input.
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('the first ArrowUp anchors on the current selection, then walks up', async () => {
    const { trigger } = renderPicker({ value: 'en' });
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Same anchor as ArrowDown: the current choice…
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { selected: true }).id,
    );
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // …then steps up the registry order (en-GB sits directly above en).
    const above = screen.getByRole('option', { name: 'English (United Kingdom)' });
    expect(input.getAttribute('aria-activedescendant')).toBe(above.id);
  });

  it('with the selection filtered out, Down starts at the top and Up at the end', async () => {
    const { trigger } = renderPicker({ value: 'en' });
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'chinese' } });
    // The four Chinese rows (zh, zh-hk, zh-mo, zh-tw); 'en' is not among them.
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option').at(-1)!.id);
    // Retyping drops the cursor back into the input, so Down anchors afresh at the top.
    fireEvent.change(input, { target: { value: 'chines' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id);
  });

  it('arrow keys clamp at both ends of the list without wrapping', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    const first = () => screen.getAllByRole('option')[0]!;
    const last = () => screen.getAllByRole('option').at(-1)!;
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toBe(first().id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(first().id);
    fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toBe(last().id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(last().id);
  });

  it('Enter without a cursor neither picks nor closes', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('navigation keys are safe on an empty result set', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'zzzznotalanguage' } });
    await screen.findByRole('status');
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
      fireEvent.keyDown(input, { key });
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a pointerdown outside closes the picker and wipes the query', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    fireEvent.change(input, { target: { value: 'german' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // Reopening starts from the full list, as after any other close.
    await open(trigger);
    expect(screen.getAllByRole('option')).toHaveLength(LANGUAGES.length);
  });

  it('focus moving out of the picker closes it; focus moving inside it does not', async () => {
    const { trigger } = renderPicker();
    const input = await open(trigger);
    // Input → option (e.g. a real mouse click landing on a row) keeps the list open…
    fireEvent.focusOut(input, { relatedTarget: screen.getAllByRole('option')[0]! });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // …but focus leaving the picker entirely dismisses it.
    fireEvent.focusOut(input, { relatedTarget: document.body });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('Escape with the picker closed bubbles to the panel and the window behind it', () => {
    const panelKey = vi.fn();
    const windowKey = vi.fn();
    window.addEventListener('keydown', windowKey);
    try {
      render(<I18nProvider>
        <div onKeyDown={panelKey}>
          <LanguagePicker value={'en' as LangChoice} onChange={() => undefined} labelledBy="lang-label" />
        </div>
      </I18nProvider>);
      const trigger = screen.getByRole('button', { expanded: false });
      fireEvent.keyDown(trigger, { key: 'Escape' });
      // The picker owns Escape only while open; closed, the key belongs to the
      // settings panel — and to the desktop prefs window's native listener.
      expect(panelKey).toHaveBeenCalled();
      expect(windowKey).toHaveBeenCalled();
      expect(screen.queryByRole('listbox')).toBeNull();
    } finally {
      window.removeEventListener('keydown', windowKey);
    }
  });

  it('reopening also clears the arrow cursor', async () => {
    const { trigger } = renderPicker();
    let input = await open(trigger);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    input = await open(trigger);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('paints the check icon on the selected row only, and the system row has no mark', async () => {
    const { trigger } = renderPicker({ value: 'en' });
    fireEvent.click(trigger);
    await screen.findAllByRole('option');
    const checks = document.querySelectorAll('.language-picker-check svg');
    expect(checks).toHaveLength(1);
    expect(checks[0].closest('[data-value]')).toHaveAttribute('data-value', 'en');
    expect(document.querySelector('[data-value="system"] .language-picker-mark')).toBeNull();
  });
});

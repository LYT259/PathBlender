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
    const onChange = vi.fn();
    render(<I18nProvider>
      <div onKeyDown={panelKey}>
        <LanguagePicker value={'en' as LangChoice} onChange={onChange} labelledBy="lang-label" />
      </div>
    </I18nProvider>);
    const trigger = screen.getByRole('button', { expanded: false });
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(panelKey).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('keys during IME composition do not navigate or select', async () => {
    const { trigger, onChange } = renderPicker();
    const input = await open(trigger);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true } as never);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
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
});

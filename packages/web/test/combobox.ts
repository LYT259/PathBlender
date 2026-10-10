/**
 * SelectControl renders its options in a document.body portal only while
 * open, so tests drive it through the same interactions a user has — click
 * the trigger, then click/inspect an option — instead of the native
 * select's fireEvent.change / .value shortcuts.
 */
import { expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

/** Open the dropdown and return its listbox. */
export function openCombobox(control: HTMLElement) {
  fireEvent.click(control);
  return screen.getByRole('listbox');
}

/** Pick the option carrying `value` — the replacement for
 * fireEvent.change(select, { target: { value } }). */
export function pickComboboxValue(control: HTMLElement, value: string) {
  const list = openCombobox(control);
  const option = within(list).getAllByRole('option').find((o) => o.getAttribute('data-value') === value);
  if (!option) throw new Error(`combobox has no option "${value}"`);
  fireEvent.click(option);
}

/** Assert which value the control currently shows, then close it again. */
export function expectComboboxValue(control: HTMLElement, value: string) {
  const list = openCombobox(control);
  const option = within(list).getAllByRole('option').find((o) => o.getAttribute('data-value') === value);
  expect(option?.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(control, { key: 'Escape' });
}

/** Every rendered option value in order (placeholder included) — the
 * equivalent of reading a native select's `.options`. */
export function comboboxValues(control: HTMLElement): string[] {
  const list = openCombobox(control);
  const values = within(list).getAllByRole('option').map((o) => o.getAttribute('data-value') ?? '');
  fireEvent.keyDown(control, { key: 'Escape' });
  return values;
}

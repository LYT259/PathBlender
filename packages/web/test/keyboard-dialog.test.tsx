/**
 * Dialog focus trap (2026-10-06 keyboard pass): hidden inputs and other
 * non-focusables must not join the Tab cycle — the custom-field panel's
 * trailing data-field-id marker used to become the last tab stop and broke
 * the loop.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Dialog } from '../src/components/Dialog';
import { I18nProvider } from '../src/i18n';

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

function Trap() {
  return <I18nProvider>
    <Dialog title="trap" onClose={() => {}}>
      <input type="hidden" data-testid="hidden" />
      <button type="button">first</button>
      <button type="button">last</button>
    </Dialog>
  </I18nProvider>;
}

describe('dialog focus trap', () => {
  it('cycles through visible focusables only — the hidden input is invisible to Tab', () => {
    render(<Trap />);
    const modal = screen.getByRole('dialog', { name: 'trap' });
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    // Container focused on mount: Tab lands on the first focusable.
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Forward from the last wraps to the first.
    last.focus();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Backward from the first wraps to the last — never the hidden input.
    fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(document.activeElement).not.toBe(screen.getByTestId('hidden'));
  });
});

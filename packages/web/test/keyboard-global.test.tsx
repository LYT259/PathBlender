/**
 * Workspace keyboard shortcuts (2026-10-06 keyboard pass): E enters the
 * composer, Esc leaves, H hides, M mirrors, ,/. switch robots, V toggles
 * 3D, End jumps to the range end, ? opens the shortcut help — and all of
 * them yield to text fields and modal dialogs. Playback speed keys ride
 * the same speed list the transport buttons render.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

async function importTwo() {
  render(<App />);
  fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto'), new File([raw], 'B.ghostauto')] } });
  await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(2));
}
const press = (target: EventTarget, init: KeyboardEventInit) => fireEvent.keyDown(target, init);
const composerOpen = () => document.querySelector('.sequence-composer') !== null;

describe('workspace shortcuts', () => {
  it('E enters the composer and Escape returns with focus restored', async () => {
    await importTwo();
    const opener = screen.getAllByRole('button', { name: /arrange/i })[0]!;
    fireEvent.click(opener);
    await waitFor(() => expect(composerOpen()).toBe(true));
    press(document.querySelector('.sequence-track-lane')!, { key: 'Escape' });
    expect(composerOpen()).toBe(false);
  });

  it('H hides and unhides the selected robot; M mirrors it', async () => {
    await importTwo();
    const eye = document.querySelector('.robot-library-visibility') as HTMLButtonElement;
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    press(window, { key: 'h' });
    await waitFor(() => expect(eye.getAttribute('aria-pressed')).toBe('false'));
    press(window, { key: 'h' });
    await waitFor(() => expect(eye.getAttribute('aria-pressed')).toBe('true'));
    const mirror = document.querySelector('.robot-mirror-button') as HTMLButtonElement;
    press(window, { key: 'm' });
    await waitFor(() => expect(mirror.getAttribute('aria-pressed')).toBe('true'));
    press(window, { key: 'm' });
    await waitFor(() => expect(mirror.getAttribute('aria-pressed')).toBe('false'));
  });

  it(', and . switch the selected robot in session order', async () => {
    await importTwo();
    const selected = () => document.querySelector('.robot-library-select[aria-pressed="true"]');
    const before = selected();
    press(window, { key: ',', code: 'Comma' });
    const mid = selected();
    expect(mid).not.toBe(before);
    press(window, { key: '.', code: 'Period' });
    expect(selected()).toBe(before);
  });

  it('V toggles the 2D/3D view only where 3D exists', async () => {
    await importTwo();
    const buttons = () => document.querySelectorAll('.view-toggle button');
    expect(buttons()[1]!.getAttribute('aria-pressed')).toBe('false');
    press(window, { key: 'v' });
    await waitFor(() => expect(buttons()[1]!.getAttribute('aria-pressed')).toBe('true'));
    press(window, { key: 'v' });
    await waitFor(() => expect(buttons()[1]!.getAttribute('aria-pressed')).toBe('false'));
  });

  it('End jumps to the range end; Shift+, / Shift+. step the shared speed list', async () => {
    await importTwo();
    press(window, { key: 'End' });
    await waitFor(() => expect(screen.getByText(/\/ 20\.00 s/)).not.toBeNull());
    const active = () => document.querySelector('.timeline-speeds button[aria-pressed="true"]')!.textContent;
    expect(active()).toBe('1×');
    press(window, { code: 'Comma', key: '<', shiftKey: true });
    expect(active()).toBe('0.5×');
    press(window, { code: 'Comma', key: '<', shiftKey: true });
    expect(active()).toBe('0.25×');
    press(window, { code: 'Period', key: '>', shiftKey: true });
    expect(active()).toBe('0.5×');
  });

  it('? opens the shortcut help; Escape closes it', async () => {
    await importTwo();
    press(window, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('every workspace key yields to a focused text field', async () => {
    await importTwo();
    const menu = document.querySelector('.workspace-menu') as HTMLDetailsElement;
    menu.open = true;
    const more = menu.querySelector('summary')!;
    fireEvent.click(more);
    // A select inside the workspace (timeline range) owns its keys.
    const range = screen.getByRole('combobox', { name: 'Playback range' });
    range.focus();
    const label = range.textContent;
    press(range, { key: 'e' });
    press(range, { key: 'h' });
    press(range, { key: 'm' });
    press(range, { code: 'Comma', key: ',' });
    expect(range.textContent).toBe(label);
    expect(composerOpen()).toBe(false);
    expect((document.querySelector('.robot-library-visibility') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
  });

  it('the robot card is one Tab stop and the status count is no control', async () => {
    await importTwo();
    // The identity button is programmatic-focus only (tabindex=-1): the row
    // <li> is the card's single Tab stop, so one card never costs two stops.
    const select = document.querySelector('.robot-library-select') as HTMLElement;
    expect(select.getAttribute('tabindex')).toBe('-1');
    const row = document.querySelector('.robot-library-row') as HTMLElement;
    expect(row.getAttribute('tabindex')).toBe('0');
    // The issue count in the status bar is a pure indicator — no ring, no click.
    const status = document.querySelector('.workspace-status .status-check')!;
    expect(status.tagName).toBe('SPAN');
    expect((status as HTMLElement).tabIndex).toBe(-1);
    const before = document.querySelector('.conflict-panel');
    fireEvent.click(status);
    expect(document.querySelector('.conflict-panel')).toBe(before);
  });

  it('keys are inert while a modal dialog is open, and ? does not open help beneath it', async () => {
    await importTwo();
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    const dialog = screen.getByRole('dialog', { name: /preferences/i });
    press(dialog, { key: '?' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    press(dialog, { key: 'e' });
    expect(composerOpen()).toBe(false);
  });
});

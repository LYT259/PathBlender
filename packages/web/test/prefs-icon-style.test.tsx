/**
 * PreferencesPanel integration for the two-level app-icon setting: style
 * drafts stage like every other preference (Save persists + applies, Cancel
 * discards), the two choices never reset each other, the interface theme
 * stays independent, drafts survive section switches, and the About page
 * icon follows the staged family. Storage assertions prove Save-time (not
 * click-time) persistence — the staging contract of this panel.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { AppIconProvider } from '../src/app-icon';
import { PreferencesPanel } from '../src/components/PreferencesPanel';

vi.mock('../src/dock-icon', () => ({ syncDockIcon: vi.fn() }));
let dark = false;
let changed: ((event: { matches: boolean }) => void) | undefined;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('pb.lang', 'en'); dark = false; changed = undefined;
  vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: (_: string, callback: typeof changed) => { changed = callback; }, removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const onClose = vi.fn();
function mount() {
  onClose.mockClear();
  render(
    <AppIconProvider><ThemeProvider><I18nProvider><PreferencesPanel desktop onClose={onClose} /></I18nProvider></ThemeProvider></AppIconProvider>,
  );
}
const styleGroup = () => screen.getByRole('group', { name: 'Icon style' });
const appearanceGroup = () => screen.getByRole('group', { name: 'Icon appearance' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('icon style setting in PreferencesPanel', () => {
  it('a style-only change dirties the panel, persists on Save, not before', () => {
    mount();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    expect(saveButton()).toBeEnabled();
    expect(localStorage.getItem('pb.appIconStyle')).toBeNull(); // staged, not saved
    fireEvent.click(saveButton());
    expect(localStorage.getItem('pb.appIconStyle')).toBe('monochrome');
    expect(localStorage.getItem('pb.appIcon')).toBeNull(); // default appearance untouched
    expect(saveButton()).toBeDisabled(); // clean again after Save
  });

  it('Cancel discards the drafts and keeps stored preferences unchanged', () => {
    mount();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    fireEvent.click(within(appearanceGroup()).getByRole('radio', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('pb.appIconStyle')).toBeNull();
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
    // A reopened panel (fresh drafts, old one unmounted) reads back defaults.
    cleanup();
    mount();
    expect(within(styleGroup()).getByRole('radio', { name: 'Classic' })).toBeChecked();
    expect(within(appearanceGroup()).getByRole('radio', { name: 'Follow system' })).toBeChecked();
  });

  it('switching the style never resets the appearance, and vice versa', () => {
    mount();
    fireEvent.click(within(appearanceGroup()).getByRole('radio', { name: 'Light' }));
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    expect(within(appearanceGroup()).getByRole('radio', { name: 'Light' })).toBeChecked();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Classic' }));
    expect(within(appearanceGroup()).getByRole('radio', { name: 'Light' })).toBeChecked();
    fireEvent.click(within(appearanceGroup()).getByRole('radio', { name: 'Dark' }));
    expect(within(styleGroup()).getByRole('radio', { name: 'Classic' })).toBeChecked();
  });

  it('reverting the draft back to the saved value restores the clean state', () => {
    localStorage.setItem('pb.appIconStyle', 'monochrome');
    mount();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Classic' }));
    expect(saveButton()).toBeEnabled();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    expect(saveButton()).toBeDisabled();
    expect(localStorage.getItem('pb.appIconStyle')).toBe('monochrome'); // never touched
  });

  it('drafts survive switching sections, and the About icon follows the draft family', () => {
    mount();
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(within(styleGroup()).getByRole('radio', { name: 'Monochrome' })).toBeChecked();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));
    expect(document.querySelector('.preferences-product-icon'))
      .toHaveAttribute('src', expect.stringContaining('mono-day'));
  });

  it('saving the interface theme leaves both icon keys untouched', () => {
    mount();
    fireEvent.click(within(screen.getByRole('group', { name: 'Theme' })).getByRole('radio', { name: 'Dark' }));
    fireEvent.click(saveButton());
    expect(localStorage.getItem('pb.theme')).toBe('dark');
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
    expect(localStorage.getItem('pb.appIconStyle')).toBeNull();
  });

  it('restores a pre-style fixed-appearance user (legacy preference compatibility)', () => {
    localStorage.setItem('pb.appIcon', 'dark');
    mount();
    expect(within(styleGroup()).getByRole('radio', { name: 'Classic' })).toBeChecked();
    expect(within(appearanceGroup()).getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  it('the Controls-tab mouse diagram logo follows the icon style (user report 2026-10-16)', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
    expect(document.querySelector('.mouse-controls-drawing image'))
      .toHaveAttribute('href', expect.stringContaining('app-icon-day')); // classic by default
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.click(within(styleGroup()).getByRole('radio', { name: 'Monochrome' }));
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
    expect(document.querySelector('.mouse-controls-drawing image'))
      .toHaveAttribute('href', expect.stringContaining('app-icon-mono-day'));
  });
});

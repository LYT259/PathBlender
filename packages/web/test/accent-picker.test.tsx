/**
 * Accent-color picker in Preferences (2026-10-17): three named swatch radios
 * that STAGE like every shared setting — a click only drafts; Save applies,
 * persists and (on desktop) broadcasts; Cancel/Escape/close drop the draft;
 * switching settings sections keeps it. Accent stays independent from the
 * theme mode staged right above it.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { ThemeProvider } from '../src/theme';
import { AppIconProvider } from '../src/app-icon';
import { UpdateChannelProvider } from '../src/update-channel';
import { I18nProvider } from '../src/i18n';

function mountPanel() {
  return render(
    <ThemeProvider>
      <AppIconProvider>
        <UpdateChannelProvider>
          <I18nProvider>
            <PreferencesPanel desktop={false} onClose={() => undefined} />
          </I18nProvider>
        </UpdateChannelProvider>
      </AppIconProvider>
    </ThemeProvider>,
  );
}

const radios = () => ({
  blue: screen.getByRole('radio', { name: 'Blue' }),
  red: screen.getByRole('radio', { name: 'Red' }),
  silver: screen.getByRole('radio', { name: 'Silver' }),
});

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.accent;
  delete document.documentElement.dataset.theme;
});

describe('accent picker presentation', () => {
  it('shows three named radios under Accent color with Blue checked by default', () => {
    mountPanel();
    const group = screen.getByRole('group', { name: 'Accent color' });
    expect(within(group).getByRole('radio', { name: 'Blue' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Red' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Silver' })).not.toBeChecked();
  });

  it('carries the localized labels', () => {
    localStorage.setItem('pb.lang', 'zh');
    mountPanel();
    expect(screen.getByRole('group', { name: '强调色' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '蓝色' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '红色' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '银灰色' })).toBeInTheDocument();
  });

  it('navigates the radio group with the keyboard', async () => {
    const user = userEvent.setup();
    mountPanel();
    radios().blue.focus();
    await user.keyboard('{ArrowRight}');
    expect(radios().red).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(radios().silver).toBeChecked();
    // The draft is live in the control; nothing applied yet.
    expect(document.documentElement.dataset.accent).toBe('blue');
  });
});

describe('accent picker staging', () => {
  it('drafts without applying; Save applies and persists', () => {
    mountPanel();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.click(radios().red);
    expect(save).toBeEnabled(); // accent alone enables Save
    expect(document.documentElement.dataset.accent).toBe('blue'); // still applied blue
    expect(localStorage.getItem('pb.accent')).toBeNull();
    fireEvent.click(save);
    expect(document.documentElement.dataset.accent).toBe('red');
    expect(localStorage.getItem('pb.accent')).toBe('red');
    expect(save).toBeDisabled(); // draft consumed
  });

  it('Cancel drops the draft without applying or persisting', () => {
    mountPanel();
    fireEvent.click(radios().silver);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(localStorage.getItem('pb.accent')).toBeNull();
  });

  it('Escape closes without applying the draft', () => {
    mountPanel();
    fireEvent.click(radios().red);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Save' }), { key: 'Escape' });
    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(localStorage.getItem('pb.accent')).toBeNull();
  });

  it('keeps the draft across settings sections', () => {
    mountPanel();
    fireEvent.click(radios().silver);
    fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(radios().silver).toBeChecked();
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('saving an accent draft leaves the theme mode and its key untouched', () => {
    mountPanel();
    fireEvent.click(radios().red);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem('pb.accent')).toBe('red');
    expect(localStorage.getItem('pb.theme')).toBeNull();
    // The theme radios above still read Follow system — the two axes never
    // steered each other.
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
  });

  it('restores a saved accent on the next mount', () => {
    localStorage.setItem('pb.accent', 'silver');
    mountPanel();
    expect(radios().silver).toBeChecked();
    expect(document.documentElement.dataset.accent).toBe('silver');
  });
});

/**
 * Accent-color picker in Preferences (2026-10-17, five options): five named
 * swatch radios in the user-fixed order — Azure (default), Crimson, Steel
 * Blue, Bronze, Silver Gray — that STAGE like every shared setting: a click
 * only drafts; Save applies, persists and (on desktop) broadcasts;
 * Cancel/Escape/close drop the draft; switching settings sections keeps it.
 * Accent stays independent from the theme mode staged right above it, and
 * existing stored ids survive the display-name change untouched. Azure is
 * the default option (checked when nothing is stored) — without any extra
 * Default text mark (removed at the user's request, 2026-10-17).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { ThemeProvider, ACCENT_CHOICES } from '../src/theme';
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

/** All five radios by their localized accessible names (en). */
const radios = () => ({
  azure: screen.getByRole('radio', { name: /Azure/ }),
  crimson: screen.getByRole('radio', { name: 'Crimson' }),
  steel: screen.getByRole('radio', { name: 'Steel Blue' }),
  bronze: screen.getByRole('radio', { name: 'Bronze' }),
  silver: screen.getByRole('radio', { name: 'Silver Gray' }),
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
  it('shows five named radios under Accent Color with Azure checked by default', () => {
    mountPanel();
    const group = screen.getByRole('group', { name: 'Accent Color' });
    const all = within(group).getAllByRole('radio');
    expect(all.map((r) => (r as HTMLInputElement).value)).toEqual([...ACCENT_CHOICES]);
    expect(within(group).getByRole('radio', { name: /Azure/ })).toBeChecked();
    for (const name of ['Crimson', 'Steel Blue', 'Bronze', 'Silver Gray']) {
      expect(within(group).getByRole('radio', { name })).not.toBeChecked();
    }
  });

  it('carries the localized labels (Simplified Chinese)', () => {
    localStorage.setItem('pb.lang', 'zh');
    mountPanel();
    expect(screen.getByRole('group', { name: '强调色' })).toBeInTheDocument();
    for (const name of ['蔚蓝', '绛红', '钢蓝', '古铜', '银灰']) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeInTheDocument();
    }
    // No extra mark next to the default option's name (user request).
    expect(screen.getByRole('radio', { name: /蔚蓝/ }).closest('label')!.textContent).toBe('蔚蓝');
  });

  it('navigates the radio group with the keyboard through all five', async () => {
    const user = userEvent.setup();
    mountPanel();
    radios().azure.focus();
    await user.keyboard('{ArrowRight}');
    expect(radios().crimson).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(radios().steel).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(radios().bronze).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(radios().silver).toBeChecked();
    // The draft is live in the control; nothing applied yet.
    expect(document.documentElement.dataset.accent).toBe('blue');
  });
});

describe('accent picker staging', () => {
  it('drafts without applying; Save applies and persists the new ids', () => {
    mountPanel();
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    expect(save).toBeDisabled();
    fireEvent.click(radios().steel);
    expect(save).toBeEnabled(); // accent alone enables Save
    expect(document.documentElement.dataset.accent).toBe('blue'); // still applied blue
    expect(localStorage.getItem('pb.accent')).toBeNull();
    fireEvent.click(save);
    expect(document.documentElement.dataset.accent).toBe('steel');
    expect(localStorage.getItem('pb.accent')).toBe('steel');
    expect(save).toBeDisabled(); // draft consumed
  });

  it('Cancel drops the draft without applying or persisting', () => {
    mountPanel();
    fireEvent.click(radios().bronze);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(localStorage.getItem('pb.accent')).toBeNull();
  });

  it('Escape closes without applying the draft', () => {
    mountPanel();
    fireEvent.click(radios().crimson);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Save', exact: true }), { key: 'Escape' });
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
    fireEvent.click(radios().bronze);
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(localStorage.getItem('pb.accent')).toBe('bronze');
    expect(localStorage.getItem('pb.theme')).toBeNull();
    // The theme radios above still read Follow system — the two axes never
    // steered each other.
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
  });

  it('restores every saved accent id on the next mount — old ids kept their meaning through the rename', () => {
    for (const id of ['blue', 'red', 'steel', 'bronze', 'silver']) {
      cleanup();
      localStorage.clear();
      localStorage.setItem('pb.accent', id);
      mountPanel();
      const checked = document.querySelector<HTMLInputElement>('.preferences-accent-options input:checked');
      expect(checked?.value).toBe(id);
      expect(document.documentElement.dataset.accent).toBe(id);
    }
  });
});

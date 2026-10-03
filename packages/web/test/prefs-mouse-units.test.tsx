/**
 * The Mouse-controls and Length-unit settings follow the panel's staging
 * discipline (see prefs-channel.test.tsx): selects show drafts, Save
 * enables only when dirty, and saving persists to localStorage.
 */
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function panel() {
  return render(
    <ThemeProvider>
      <UpdateChannelProvider>
        <I18nProvider>
          <PreferencesPanel desktop={false} onClose={() => {}} />
        </I18nProvider>
      </UpdateChannelProvider>
    </ThemeProvider>,
  );
}

describe('mouse controls & units settings', () => {
  it('shows both groups with their defaults (onshape, meters)', () => {
    panel();
    const mouse = screen.getByLabelText(/mouse controls/i, { selector: 'select' }) as HTMLSelectElement;
    const units = screen.getByLabelText(/length unit/i, { selector: 'select' }) as HTMLSelectElement;
    expect(mouse.value).toBe('onshape');
    expect(units.value).toBe('m');
    // The onshape map previews what each button does.
    expect(screen.getByText('Rotate')).toBeInTheDocument();
    expect(screen.getByText('Pan')).toBeInTheDocument();
  });

  it('updates the labelled mouse diagram when the control scheme changes', () => {
    panel();
    expect(screen.getByRole('figure', { name: 'Button map' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SOLIDWORKS', exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/mouse controls/i, { selector: 'select' }), { target: { value: 'solidworks' } });
    expect(screen.getByText('Rotate (Ctrl: pan)')).toBeInTheDocument();
    expect(screen.queryByText('Pan', { exact: true })).not.toBeInTheDocument();
    expect(localStorage.getItem('pb.mouseControls')).toBeNull();
  });

  it('stages drafts, then persists on Save', () => {
    panel();
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/length unit/i, { selector: 'select' }), { target: { value: 'in' } });
    fireEvent.change(screen.getByLabelText(/mouse controls/i, { selector: 'select' }), { target: { value: 'solidworks' } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    expect(localStorage.getItem('pb.lengthUnit')).toBe('in');
    expect(localStorage.getItem('pb.mouseControls')).toBe('solidworks');
    expect(save.disabled).toBe(true); // drafts became current
  });
});

/**
 * The Mouse-controls and Length-unit settings follow the panel's staging
 * discipline (see prefs-channel.test.tsx): selects show drafts, Save
 * enables only when dirty, and saving persists to localStorage. The last
 * two tests pin the persistence contract of the existing mouse-controls.ts
 * store itself: a saved scheme survives a reopen (app restart), while an
 * unsaved draft never leaks into it.
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
  const result = render(
    <ThemeProvider>
      <UpdateChannelProvider>
        <I18nProvider>
          <PreferencesPanel desktop={false} onClose={() => {}} />
        </I18nProvider>
      </UpdateChannelProvider>
    </ThemeProvider>,
  );
  expect(screen.queryByLabelText(/mouse controls/i, { selector: 'select' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
  return result;
}

describe('mouse controls & units settings', () => {
  it('shows the scheme select, the verified function table and checkbox defaults', () => {
    panel();
    const mouse = screen.getByLabelText(/mouse controls/i, { selector: 'select' }) as HTMLSelectElement;
    const units = screen.getByLabelText(/length unit/i, { selector: 'select' }) as HTMLSelectElement;
    expect(mouse.value).toBe('onshape');
    expect(units.value).toBe('m');
    // Function rows carry the verified Onshape bindings (2026-10-03).
    expect(screen.getByText('Right mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Alt + Right mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Right mouse button drag or Middle mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Scroll wheel in/out')).toBeInTheDocument();
    // Checkbox defaults: reverse off, constrained off, pen-as-mouse on.
    expect((screen.getByLabelText('Reverse scroll wheel zoom direction') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Set default rotation behavior to constrained rotate') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Use pen input as mouse') as HTMLInputElement).checked).toBe(true);
  });

  it('swaps the diagram and table to the verified SOLIDWORKS bindings', () => {
    panel();
    expect(screen.getByRole('figure', { name: 'Button map' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SOLIDWORKS', exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/mouse controls/i, { selector: 'select' }), { target: { value: 'solidworks' } });
    expect(screen.getByText('Middle mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Middle mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Scroll wheel in/out or Shift + Middle mouse button drag')).toBeInTheDocument();
    expect(localStorage.getItem('pb.mouseControls')).toBeNull();
  });

  it('omits inactive mouse buttons and their leader lines for each scheme', () => {
    const { container } = panel();
    expect(container.querySelector('[data-mouse-button="left"]')).toBeNull();
    expect(container.querySelector('.mouse-callout-left')).toBeNull();
    expect(container.querySelector('[data-mouse-button="right"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/mouse controls/i, { selector: 'select' }), { target: { value: 'solidworks' } });
    expect(container.querySelector('[data-mouse-button="right"]')).toBeNull();
    expect(container.querySelector('.mouse-callout-right')).toBeNull();
    expect(container.querySelector('[data-mouse-button="middle"]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Set default rotation behavior to constrained rotate'));
    expect(container.querySelector('.mouse-callout-middle strong')).toHaveTextContent('Constrained rotate');
  });

  it('orders the five unit choices like the reference and never saves preview-only units', () => {
    panel();
    const units = screen.getByLabelText(/length unit/i, { selector: 'select' }) as HTMLSelectElement;
    expect(Array.from(units.options).map(option => option.value)).toEqual(['cm', 'ft', 'in', 'm', 'yd']);
    fireEvent.change(units, { target: { value: 'ft' } });
    expect(screen.getByText('Preview: 3.04 ft. This unit is not applied yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Reverse scroll wheel zoom direction'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem('pb.lengthUnit')).toBeNull();
    expect(localStorage.getItem('pb.reverseScroll')).toBe('on');
    fireEvent.change(units, { target: { value: 'yd' } });
    expect(screen.getByText('Preview: 1.01 yd. This unit is not applied yet.')).toBeInTheDocument();
  });

  it('stages checkbox drafts and persists them on Save', () => {
    panel();
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Reverse scroll wheel zoom direction'));
    fireEvent.click(screen.getByLabelText('Use pen input as mouse'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(localStorage.getItem('pb.reverseScroll')).toBe('on');
    expect(localStorage.getItem('pb.penAsMouse')).toBe('off');
    expect(save.disabled).toBe(true);
  });

  it('restores the persisted checkboxes on open (app restart)', () => {
    localStorage.setItem('pb.reverseScroll', 'on');
    localStorage.setItem('pb.penAsMouse', 'off');
    panel();
    expect((screen.getByLabelText('Reverse scroll wheel zoom direction') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Use pen input as mouse') as HTMLInputElement).checked).toBe(false);
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

  it('restores the persisted mouse scheme on open (simulating an app restart)', () => {
    // Written before the panel mounts, as a previous session's Save would.
    localStorage.setItem('pb.mouseControls', 'solidworks');
    panel();
    const mouse = screen.getByLabelText(/mouse controls/i, { selector: 'select' }) as HTMLSelectElement;
    expect(mouse.value).toBe('solidworks');
  });

  it('discards an unsaved mouse-scheme draft when the panel is closed and reopened', () => {
    const first = panel();
    fireEvent.change(screen.getByLabelText(/mouse controls/i, { selector: 'select' }), { target: { value: 'solidworks' } });
    expect(localStorage.getItem('pb.mouseControls')).toBeNull(); // draft only — nothing persisted
    first.unmount();
    panel();
    const mouse = screen.getByLabelText(/mouse controls/i, { selector: 'select' }) as HTMLSelectElement;
    expect(mouse.value).toBe('onshape'); // reopen reads the store, not the dropped draft
  });
});

/**
 * The Mouse-controls and Length-unit settings follow the panel's staging
 * discipline (see prefs-channel.test.tsx): selects show drafts, Save
 * enables only when dirty, and saving persists to localStorage. The last
 * two tests pin the persistence contract of the existing mouse-controls.ts
 * store itself: a saved scheme survives a reopen (app restart), while an
 * unsaved draft never leaks into it.
 */
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { comboboxValues, expectComboboxValue, openCombobox, pickComboboxValue } from './combobox';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const schemePicker = () => screen.getByRole('combobox', { name: /mouse controls/i });
const unitsPicker = () => screen.getByRole('combobox', { name: /length unit/i });

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
  expect(screen.queryByRole('combobox', { name: /mouse controls/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
  return result;
}

describe('mouse controls & units settings', () => {
  it('shows the scheme select, the verified function table and checkbox defaults', () => {
    panel();
    const mouse = schemePicker();
    const units = unitsPicker();
    expectComboboxValue(mouse, 'onshape');
    expectComboboxValue(units, 'in');
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
    const schemeList = openCombobox(schemePicker());
    expect(within(schemeList).getByRole('option', { name: 'SOLIDWORKS', exact: true })).toBeInTheDocument();
    fireEvent.keyDown(schemePicker(), { key: 'Escape' });
    pickComboboxValue(schemePicker(), 'solidworks');
    expect(screen.getByText('Middle mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Middle mouse button drag')).toBeInTheDocument();
    expect(screen.getByText('Scroll wheel in/out or Shift + Middle mouse button drag')).toBeInTheDocument();
    // Alt+middle is Roll View (verified against SOLIDWORKS' docs 2026-10-04),
    // not constrained rotate — that row must not appear in this scheme.
    expect(screen.getByText('Roll view')).toBeInTheDocument();
    expect(screen.getByText('Alt + Middle mouse button drag')).toBeInTheDocument();
    expect(screen.queryByText('Constrained rotate', { exact: true })).not.toBeInTheDocument();
    expect(localStorage.getItem('pb.mouseControls')).toBeNull();
  });

  it('keeps Alt+right as constrained rotate in the Onshape table', () => {
    panel();
    expect(screen.getByText('Constrained rotate')).toBeInTheDocument();
    expect(screen.getByText('Alt + Right mouse button drag')).toBeInTheDocument();
    expect(screen.queryByText('Roll view')).not.toBeInTheDocument();
  });

  it('omits inactive mouse buttons and their leader lines for each scheme', () => {
    const { container } = panel();
    expect(container.querySelector('[data-mouse-button="left"]')).toBeNull();
    expect(container.querySelector('.mouse-callout-left')).toBeNull();
    expect(container.querySelector('[data-mouse-button="right"]')).not.toBeNull();
    pickComboboxValue(schemePicker(), 'solidworks');
    expect(container.querySelector('[data-mouse-button="right"]')).toBeNull();
    expect(container.querySelector('.mouse-callout-right')).toBeNull();
    expect(container.querySelector('[data-mouse-button="middle"]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Set default rotation behavior to constrained rotate'));
    expect(container.querySelector('.mouse-callout-middle strong')).toHaveTextContent('Constrained rotate');
  });

  it('orders the five unit choices like the reference and saves every one of them', () => {
    panel();
    const units = unitsPicker();
    expect(comboboxValues(units)).toEqual(['cm', 'ft', 'in', 'm', 'yd']);
    // ft/yd are fully wired (2026-10-04): Save enabled, and the choice
    // persists like any other unit. The hint sentence under the picker was
    // removed (user request 2026-10-07) — nothing else may appear under it.
    pickComboboxValue(units, 'ft');
    expect(document.querySelector('.preferences-units-group .preferences-setting-description')).toBeNull();
    pickComboboxValue(units, 'yd');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem('pb.lengthUnit')).toBe('yd');
  });

  it('shows a legacy ftin preference in the picker and replaces it on save', () => {
    // Stored by a pre-five-unit build: the mixed feet+inches mode still
    // reads and displays (never as decimal feet) until the user saves a
    // current unit over it.
    localStorage.setItem('pb.lengthUnit', 'ftin');
    panel();
    // The hidden read-only row never renders in the dropdown; the legacy
    // value is still shown on the trigger itself.
    const units = unitsPicker();
    expect(units).toHaveTextContent(en['prefs.unit.ftin']);
    pickComboboxValue(units, 'ft');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem('pb.lengthUnit')).toBe('ft');
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

    pickComboboxValue(unitsPicker(), 'm');
    pickComboboxValue(schemePicker(), 'solidworks');
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    expect(localStorage.getItem('pb.lengthUnit')).toBe('m');
    expect(localStorage.getItem('pb.mouseControls')).toBe('solidworks');
    expect(save.disabled).toBe(true); // drafts became current
  });

  it('restores the persisted mouse scheme on open (simulating an app restart)', () => {
    // Written before the panel mounts, as a previous session's Save would.
    localStorage.setItem('pb.mouseControls', 'solidworks');
    panel();
    expectComboboxValue(schemePicker(), 'solidworks');
  });

  it('discards an unsaved mouse-scheme draft when the panel is closed and reopened', () => {
    const first = panel();
    pickComboboxValue(schemePicker(), 'solidworks');
    expect(localStorage.getItem('pb.mouseControls')).toBeNull(); // draft only — nothing persisted
    first.unmount();
    panel();
    expectComboboxValue(schemePicker(), 'onshape'); // reopen reads the store, not the dropped draft
  });
});

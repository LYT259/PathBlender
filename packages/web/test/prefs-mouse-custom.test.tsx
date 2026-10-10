/**
 * The custom mouse-controls scheme (user request 2026-10-07): one action
 * per drag button, with modifier combos derived from fixed rules instead
 * of being editable (the first cut's 12-slot matrix shipped same-day as
 * beta.72 and read as too complex). Two layers are pinned here, mirroring
 * prefs-mouse-units: the pure routing table (resolveMouseAction + map
 * normalization) and the settings panel (three assignment rows, the
 * derived-rules sentence, staging + Save persistence, reset, migration of
 * the old matrix storage).
 */
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import {
  DEFAULT_CUSTOM_MOUSE_MAP,
  normalizeCustomMouseMap,
  resolveMouseAction,
} from '../src/mouse-controls';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { comboboxValues, expectComboboxValue, pickComboboxValue } from './combobox';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const mods = (ctrl = false, shift = false, alt = false) => ({ ctrlKey: ctrl, shiftKey: shift, altKey: alt });

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
  fireEvent.click(screen.getByRole('tab', { name: 'Controls' }));
  return result;
}

function schemeSelect() {
  return screen.getByRole('combobox', { name: /mouse controls/i });
}

function buttonSelect(button: string) {
  return screen.getByRole('combobox', { name: `Action for ${button}` });
}

describe('custom scheme routing (resolveMouseAction)', () => {
  it('routes the untouched custom map exactly like the onshape preset', () => {
    // Defaults are the onshape preset's per-button reading: right rotate,
    // middle pan, left nothing — picking Custom changes nothing until a
    // button is edited.
    expect(resolveMouseAction('custom', 2, mods(), false)).toEqual({ kind: 'orbit', constrained: false });
    expect(resolveMouseAction('custom', 1, mods(), false)).toEqual({ kind: 'pan' });
    expect(resolveMouseAction('custom', 0, mods(), false)).toEqual({ kind: 'none' });
  });

  it('derives modifier combos from the fixed rules on every button', () => {
    // Ctrl + any drag = pan (the one binding both vendors share verbatim);
    // Shift + any drag = zoom (SOLIDWORKS' Shift+middle, generalized) —
    // unconditionally, including buttons set to "do nothing".
    for (const button of [0, 1, 2] as const) {
      expect(resolveMouseAction('custom', button, mods(true), false), `ctrl/btn${button}`).toEqual({ kind: 'pan' });
      expect(resolveMouseAction('custom', button, mods(false, true), false), `shift/btn${button}`).toEqual({ kind: 'dragZoom' });
    }
  });

  it('resolves Shift above Ctrl when both are held', () => {
    // Priority Shift > Ctrl > Alt matches the presets' reading order.
    expect(resolveMouseAction('custom', 2, mods(true, true), false)).toEqual({ kind: 'dragZoom' });
    expect(resolveMouseAction('custom', 2, mods(true, false, true), false)).toEqual({ kind: 'pan' });
  });

  it('Alt swaps free/constrained rotate on rotation buttons only', () => {
    // Onshape's Alt+right semantics: constrained ⇄ free. On any other
    // action Alt keeps the plain binding.
    expect(resolveMouseAction('custom', 2, mods(false, false, true), false)).toEqual({ kind: 'orbit', constrained: true });
    expect(resolveMouseAction('custom', 1, mods(false, false, true), false)).toEqual({ kind: 'pan' }); // middle=pan
    const map = { ...DEFAULT_CUSTOM_MOUSE_MAP, right: 'constrained', middle: 'roll', left: 'zoom' };
    expect(resolveMouseAction('custom', 2, mods(false, false, true), false, map)).toEqual({ kind: 'orbit', constrained: false });
    expect(resolveMouseAction('custom', 1, mods(false, false, true), false, map)).toEqual({ kind: 'roll' });
    expect(resolveMouseAction('custom', 0, mods(false, false, true), false, map)).toEqual({ kind: 'dragZoom' });
  });

  it('resolves every assignable action from the per-button map', () => {
    const map = { left: 'constrained', middle: 'zoom', right: 'roll' };
    expect(resolveMouseAction('custom', 0, mods(), false, map)).toEqual({ kind: 'orbit', constrained: true });
    expect(resolveMouseAction('custom', 1, mods(), false, map)).toEqual({ kind: 'dragZoom' });
    expect(resolveMouseAction('custom', 2, mods(), false, map)).toEqual({ kind: 'roll' });
  });

  it('falls back to the default map when none is supplied', () => {
    expect(resolveMouseAction('custom', 2, mods(), false)).toEqual({ kind: 'orbit', constrained: false });
  });

  it('migrates the beta.72 12-slot storage by reading the plain slots, and drops bad values', () => {
    // Same-day format (never tagged or released): the plain slots carry
    // the user's per-button choices; combo cells are discarded with the
    // matrix. Unknown actions and malformed JSON fall back to defaults.
    const legacy = JSON.stringify({
      left: 'zoom', 'left.ctrl': 'roll', 'left.alt': 'pan', 'left.shift': 'rotate',
      middle: 'rotate', right: 'constrained', 'right.ctrl': 'pan', 'right.alt': 'roll',
    });
    expect(normalizeCustomMouseMap(legacy)).toEqual({ left: 'zoom', middle: 'rotate', right: 'constrained' });
    expect(normalizeCustomMouseMap('not json')).toEqual(DEFAULT_CUSTOM_MOUSE_MAP);
    expect(normalizeCustomMouseMap(JSON.stringify({ middle: 'explode', extra: 'rotate' }))).toEqual(DEFAULT_CUSTOM_MOUSE_MAP);
  });
});

describe('custom scheme in the settings panel', () => {
  it('lists Custom as the third scheme, below SOLIDWORKS', () => {
    panel();
    expect(comboboxValues(schemeSelect())).toEqual(['onshape', 'solidworks', 'custom']);
  });

  it('shows three assignment rows with preset defaults and the fixed-combo sentences', () => {
    panel();
    pickComboboxValue(schemeSelect(), 'custom');
    expectComboboxValue(buttonSelect('Left drag'), 'none');
    expectComboboxValue(buttonSelect('Middle drag'), 'pan');
    expectComboboxValue(buttonSelect('Right drag'), 'rotate');
    // Six actions per row, same order as the presets' tables.
    expect(comboboxValues(buttonSelect('Right drag')))
      .toEqual(['rotate', 'constrained', 'pan', 'zoom', 'roll', 'none']);
    // Combos are stated, not edited — no per-modifier cells anywhere.
    expect(screen.getByText(/Ctrl \+ drag always pans/i)).toBeInTheDocument();
    expect(screen.getByText(/always zooms and cannot be reassigned/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Action for .* while holding/i)).not.toBeInTheDocument();
    // The constrained-default checkbox means nothing here; wheel direction
    // and pen input still apply.
    expect(screen.queryByLabelText('Set default rotation behavior to constrained rotate')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reverse scroll wheel zoom direction')).toBeInTheDocument();
    expect(screen.getByLabelText('Use pen input as mouse')).toBeInTheDocument();
  });

  it('updates the diagram callouts from the staged button edits', () => {
    const { container } = panel();
    pickComboboxValue(schemeSelect(), 'custom');
    expect(container.querySelector('.mouse-callout-right strong')).toHaveTextContent('Rotate');
    pickComboboxValue(buttonSelect('Right drag'), 'pan');
    expect(container.querySelector('.mouse-callout-right strong')).toHaveTextContent('Pan');
    pickComboboxValue(buttonSelect('Right drag'), 'none');
    expect(container.querySelector('.mouse-callout-right')).toBeNull();
    // Assigning the idle left button draws its callout too.
    pickComboboxValue(buttonSelect('Left drag'), 'roll');
    expect(container.querySelector('.mouse-callout-left strong')).toHaveTextContent('Roll view');
  });

  it('stages button drafts and persists the map on Save', () => {
    panel();
    pickComboboxValue(schemeSelect(), 'custom');
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false); // the scheme switch itself is a staged change
    pickComboboxValue(buttonSelect('Middle drag'), 'zoom');
    // Draft only — nothing persisted before Save.
    expect(localStorage.getItem('pb.customMouseControls')).toBeNull();
    fireEvent.click(save);
    expect(JSON.parse(localStorage.getItem('pb.customMouseControls')!)).toEqual({
      ...DEFAULT_CUSTOM_MOUSE_MAP,
      middle: 'zoom',
    });
    expect(localStorage.getItem('pb.mouseControls')).toBe('custom');
    expect(save.disabled).toBe(true);
  });

  it('restores the persisted scheme and map on reopen (app restart)', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    localStorage.setItem('pb.customMouseControls', JSON.stringify({ ...DEFAULT_CUSTOM_MOUSE_MAP, right: 'roll' }));
    panel();
    expectComboboxValue(schemeSelect(), 'custom');
    expectComboboxValue(buttonSelect('Right drag'), 'roll');
  });

  it('reads a legacy 12-slot map through the plain slots', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    localStorage.setItem('pb.customMouseControls', JSON.stringify({
      left: 'none', 'left.ctrl': 'none', 'left.alt': 'none', 'left.shift': 'none',
      middle: 'rotate', 'middle.ctrl': 'pan', 'middle.alt': 'roll', 'middle.shift': 'zoom',
      right: 'pan', 'right.ctrl': 'pan', 'right.alt': 'constrained', 'right.shift': 'none',
    }));
    panel();
    expectComboboxValue(buttonSelect('Middle drag'), 'rotate');
    expectComboboxValue(buttonSelect('Right drag'), 'pan');
    // Re-saving writes the compact per-button format.
    pickComboboxValue(buttonSelect('Left drag'), 'zoom');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(JSON.parse(localStorage.getItem('pb.customMouseControls')!))
      .toEqual({ left: 'zoom', middle: 'rotate', right: 'pan' });
  });

  it('seeds the editor with defaults when the scheme is custom but no map was saved', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    panel();
    expectComboboxValue(buttonSelect('Right drag'), 'rotate');
  });

  it('discards an unsaved button edit when the panel is closed and reopened', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    const first = panel();
    pickComboboxValue(buttonSelect('Right drag'), 'pan');
    first.unmount();
    panel();
    expectComboboxValue(buttonSelect('Right drag'), 'rotate');
  });

  it('resets edited buttons back to the preset copy', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    localStorage.setItem('pb.customMouseControls', JSON.stringify({ ...DEFAULT_CUSTOM_MOUSE_MAP, right: 'roll' }));
    panel();
    expectComboboxValue(buttonSelect('Right drag'), 'roll');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expectComboboxValue(buttonSelect('Right drag'), 'rotate');
    // The stored map still holds the old assignment, so the reset itself
    // is an unsaved change until Save lands it.
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(JSON.parse(localStorage.getItem('pb.customMouseControls')!)).toEqual(DEFAULT_CUSTOM_MOUSE_MAP);
  });
});

/**
 * The custom mouse-controls scheme (user request 2026-10-07): every
 * (button, modifier) drag slot is user-assignable while the wheel stays
 * zoom-only. Two layers are pinned here, mirroring prefs-mouse-units:
 * the pure routing table (resolveMouseAction + map normalization) and the
 * settings panel (scheme option below SOLIDWORKS, the Onshape-style
 * assignment grid, staging + Save persistence, reset, wheel note, and the
 * constrained checkbox that has no meaning in this scheme).
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
  return screen.getByLabelText(/mouse controls/i, { selector: 'select' }) as HTMLSelectElement;
}

function customSelect(button: string, modifier: string) {
  return screen.getByLabelText(`Action for ${button} while holding ${modifier}`, { selector: 'select' }) as HTMLSelectElement;
}

describe('custom scheme routing (resolveMouseAction)', () => {
  it('routes the untouched custom map exactly like the onshape preset', () => {
    // Defaults are a copy of the onshape preset: picking Custom changes
    // nothing until a slot is edited.
    for (const [button, ctrl, shift, alt, expected] of [
      [2, false, false, false, 'orbit'],
      [2, true, false, false, 'pan'],
      [2, false, false, true, 'orbit-constrained'],
      [1, false, false, false, 'pan'],
      [0, false, false, false, 'none'],
    ] as const) {
      const action = resolveMouseAction('custom', button, mods(ctrl, shift, alt), false);
      const actual = action.kind === 'orbit' ? (action.constrained ? 'orbit-constrained' : 'orbit') : action.kind;
      expect(actual, `${button}/${ctrl}/${shift}/${alt}`).toBe(expected);
    }
  });

  it('resolves every assignable action kind from the map', () => {
    const map = {
      ...DEFAULT_CUSTOM_MOUSE_MAP,
      left: 'constrained',
      'left.ctrl': 'zoom',
      'left.alt': 'roll',
      'left.shift': 'pan',
      'middle.shift': 'rotate',
    } as const;
    expect(resolveMouseAction('custom', 0, mods(), false, map)).toEqual({ kind: 'orbit', constrained: true });
    expect(resolveMouseAction('custom', 0, mods(true), false, map)).toEqual({ kind: 'dragZoom' });
    expect(resolveMouseAction('custom', 0, mods(false, false, true), false, map)).toEqual({ kind: 'roll' });
    expect(resolveMouseAction('custom', 0, mods(false, true), false, map)).toEqual({ kind: 'pan' });
    expect(resolveMouseAction('custom', 1, mods(false, true), false, map)).toEqual({ kind: 'orbit', constrained: false });
  });

  it('uses strict modifier priority — an explicit None shadows the plain drag', () => {
    // Shift > Ctrl > Alt, matching the SOLIDWORKS table's reading order.
    // Shift+right holds None while plain right rotates: holding Shift must
    // do nothing, not fall through to the plain binding.
    expect(resolveMouseAction('custom', 2, mods(false, true), false)).toEqual({ kind: 'none' });
    expect(resolveMouseAction('custom', 2, mods(true, true), false)).toEqual({ kind: 'none' });
  });

  it('falls back to the default map when none is supplied', () => {
    expect(resolveMouseAction('custom', 1, mods(true), false)).toEqual({ kind: 'none' });
    expect(resolveMouseAction('custom', 2, mods(true), false)).toEqual({ kind: 'pan' });
  });

  it('ignores unknown buttons, slots and actions when normalizing stored maps', () => {
    expect(normalizeCustomMouseMap('not json')).toEqual(DEFAULT_CUSTOM_MOUSE_MAP);
    const stored = JSON.stringify({ right: 'pan', 'left.bogus': 'roll', middle: 'explode', extra: 'rotate' });
    const map = normalizeCustomMouseMap(stored);
    expect(map.right).toBe('pan');
    expect(map.middle).toBe('pan'); // 'explode' dropped → default kept
    expect(map['right.alt']).toBe('constrained'); // untouched slots keep defaults
  });
});

describe('custom scheme in the settings panel', () => {
  it('lists Custom as the third scheme, below SOLIDWORKS', () => {
    panel();
    expect(Array.from(schemeSelect().options).map((o) => o.value)).toEqual(['onshape', 'solidworks', 'custom']);
  });

  it('shows the assignment grid with preset defaults, the wheel note, and no constrained checkbox', () => {
    panel();
    fireEvent.change(schemeSelect(), { target: { value: 'custom' } });
    // Grid: 4 modifier rows × 3 button columns, defaulting to the onshape copy.
    expect(customSelect('Right drag', 'no modifier key').value).toBe('rotate');
    expect(customSelect('Right drag', 'Ctrl').value).toBe('pan');
    expect(customSelect('Right drag', 'Alt').value).toBe('constrained');
    expect(customSelect('Right drag', 'Shift').value).toBe('none');
    expect(customSelect('Middle drag', 'no modifier key').value).toBe('pan');
    expect(customSelect('Left drag', 'no modifier key').value).toBe('none');
    // Every slot offers all six actions.
    expect(Array.from(customSelect('Right drag', 'no modifier key').options).map((o) => o.value))
      .toEqual(['rotate', 'constrained', 'pan', 'zoom', 'roll', 'none']);
    // Wheel is not assignable — stated, not offered.
    expect(screen.getByText(/always zooms and cannot be reassigned/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Set default rotation behavior to constrained rotate')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reverse scroll wheel zoom direction')).toBeInTheDocument();
    expect(screen.getByLabelText('Use pen input as mouse')).toBeInTheDocument();
  });

  it('updates the diagram callouts from the staged slot edits', () => {
    const { container } = panel();
    fireEvent.change(schemeSelect(), { target: { value: 'custom' } });
    expect(container.querySelector('.mouse-callout-right strong')).toHaveTextContent('Rotate');
    fireEvent.change(customSelect('Right drag', 'no modifier key'), { target: { value: 'pan' } });
    expect(container.querySelector('.mouse-callout-right strong')).toHaveTextContent('Pan');
    fireEvent.change(customSelect('Right drag', 'no modifier key'), { target: { value: 'none' } });
    expect(container.querySelector('.mouse-callout-right')).toBeNull();
  });

  it('stages slot drafts and persists the map on Save', () => {
    panel();
    fireEvent.change(schemeSelect(), { target: { value: 'custom' } });
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false); // the scheme switch itself is a staged change
    fireEvent.change(customSelect('Middle drag', 'Alt'), { target: { value: 'zoom' } });
    // Draft only — nothing persisted before Save.
    expect(localStorage.getItem('pb.customMouseControls')).toBeNull();
    fireEvent.click(save);
    expect(JSON.parse(localStorage.getItem('pb.customMouseControls')!)).toEqual({
      ...DEFAULT_CUSTOM_MOUSE_MAP,
      'middle.alt': 'zoom',
    });
    expect(localStorage.getItem('pb.mouseControls')).toBe('custom');
    expect(save.disabled).toBe(true);
  });

  it('restores the persisted scheme and map on reopen (app restart)', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    localStorage.setItem('pb.customMouseControls', JSON.stringify({ ...DEFAULT_CUSTOM_MOUSE_MAP, 'right.alt': 'roll' }));
    panel();
    expect(schemeSelect().value).toBe('custom');
    expect(customSelect('Right drag', 'Alt').value).toBe('roll');
  });

  it('seeds the editor with defaults when the scheme is custom but no map was saved', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    panel();
    expect(customSelect('Right drag', 'no modifier key').value).toBe('rotate');
  });

  it('discards an unsaved slot edit when the panel is closed and reopened', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    const first = panel();
    fireEvent.change(customSelect('Right drag', 'no modifier key'), { target: { value: 'pan' } });
    first.unmount();
    panel();
    expect(customSelect('Right drag', 'no modifier key').value).toBe('rotate');
  });

  it('resets edited slots back to the preset copy', () => {
    localStorage.setItem('pb.mouseControls', 'custom');
    localStorage.setItem('pb.customMouseControls', JSON.stringify({ ...DEFAULT_CUSTOM_MOUSE_MAP, 'right.ctrl': 'roll' }));
    panel();
    expect(customSelect('Right drag', 'Ctrl').value).toBe('roll');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(customSelect('Right drag', 'Ctrl').value).toBe('pan');
    // The stored file still holds the old assignment, so the reset itself
    // is an unsaved change until Save lands it.
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(JSON.parse(localStorage.getItem('pb.customMouseControls')!)).toEqual(DEFAULT_CUSTOM_MOUSE_MAP);
  });
});

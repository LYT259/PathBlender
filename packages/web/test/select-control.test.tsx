import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectControl } from '../src/components/SelectControl';

function fixture() {
  const change = vi.fn(), parentKey = vi.fn();
  render(<div onKeyDown={parentKey}>
    <SelectControl aria-label="Range" value="full" onValueChange={change}>
      <option value="legacy" hidden disabled>Legacy</option>
      <option value="full">Full timeline</option>
      <option value="disabled" disabled>Unavailable</option>
      <option value="paths" title="routes/paths.json">Current paths</option>
    </SelectControl>
  </div>);
  return { change, parentKey, control: screen.getByRole('combobox', { name: 'Range' }) };
}

describe('SelectControl dropdown', () => {
  it('opens a list, omits hidden rows and keeps disabled rows unselectable', () => {
    const { control, change } = fixture();
    fireEvent.click(control);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Full timeline' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Unavailable' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option', { name: /Current paths/ }));
    expect(change).toHaveBeenCalledExactlyOnceWith('paths');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(control).toHaveFocus();
  });
  it('arrows skip disabled options, Enter picks, and does not send playback keys to its parent', () => {
    const { control, change, parentKey } = fixture();
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(change).toHaveBeenCalledExactlyOnceWith('paths');
    expect(parentKey).not.toHaveBeenCalled();
  });
  it('owns Delete from a focused trigger, so no surrounding shortcut fires', () => {
    // The composer deletes a chosen clip on Delete; the old native select was
    // excluded by its input guard, and the trigger keeps that contract by
    // never letting the key leave the control — open or closed.
    const { control, parentKey } = fixture();
    fireEvent.keyDown(control, { key: 'Delete', metaKey: false });
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Delete' });
    expect(parentKey).not.toHaveBeenCalled();
    fireEvent.keyDown(control, { key: 'Escape' });
  });
  it('Escape dismisses without changing the value or closing its parent', () => {
    const { control, change, parentKey } = fixture();
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'End' });
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });
  it('Escape with the list closed belongs to the parent, and so does Tab', () => {
    // A closed control must not swallow the keys a surrounding dialog owns:
    // Escape still closes the dialog, Tab still reaches its focus trap.
    const { control, parentKey } = fixture();
    fireEvent.keyDown(control, { key: 'Escape' });
    fireEvent.keyDown(control, { key: 'Tab' });
    expect(parentKey).toHaveBeenCalledTimes(2);
  });
  it('shows an option title as secondary text', () => {
    const { control } = fixture();
    fireEvent.click(control);
    const option = screen.getByRole('option', { name: /Current paths/ });
    expect(within(option).getByText('routes/paths.json')).toBeInTheDocument();
    fireEvent.keyDown(control, { key: 'Escape' });
  });
  it('displays a hidden legacy value on the trigger but never offers it', () => {
    const change = vi.fn();
    render(<SelectControl aria-label="Unit" value="ftin" onValueChange={change}>
      <option value="ftin" hidden disabled>Feet + inches</option>
      <option value="cm">Centimeters</option>
      <option value="in">Inches</option>
    </SelectControl>);
    const control = screen.getByRole('combobox', { name: 'Unit' });
    expect(control).toHaveTextContent('Feet + inches');
    fireEvent.click(control);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    // The read-only legacy row cannot come back through the keyboard either:
    // activation starts from the first enabled option.
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(change).toHaveBeenCalledExactlyOnceWith('cm');
  });
  it('ignores composition Enter and dismisses on outside pointerdown', () => {
    const { control, change } = fixture();
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Enter', isComposing: true });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('a disabled control does not open', () => {
    render(<SelectControl aria-label="Locked" value="a" disabled onValueChange={() => {}}>
      <option value="a">A</option>
    </SelectControl>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Locked' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

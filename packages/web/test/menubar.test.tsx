import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { MenuBar } from '../src/components/MenuBar';
import type { MenuSection } from '../src/menu-spec';

const spec: MenuSection[] = [
  {
    label: 'File',
    items: [
      { id: 'import', label: 'Import files', kind: 'item', enabled: true },
      { role: 'separator' },
      { id: 'save', label: 'Save session', kind: 'item', enabled: true },
      { id: 'export-package', label: 'Export Solution Package…', kind: 'item', enabled: false },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Game season', kind: 'submenu', enabled: true, items: [
        { id: 'season-a', label: 'Field A', kind: 'check', checked: true, enabled: true },
        { id: 'season-b', label: 'Field B', kind: 'check', checked: false, enabled: true },
      ] },
    ],
  },
  { label: 'Window', macOnly: true, items: [] },
];

afterEach(cleanup);

function openMenu(label: string) {
  fireEvent.click(screen.getByText(label, { selector: '.menu-top' }));
}

describe('web MenuBar', () => {
  it('hides macOS-only sections and renders the rest', () => {
    const { container } = render(createElement(MenuBar, { menus: spec, onCommand: () => undefined }));
    expect(screen.getByText('File', { selector: '.menu-top' })).toBeTruthy();
    expect(screen.getByText('View', { selector: '.menu-top' })).toBeTruthy();
    expect(screen.queryByText('Window')).toBeNull();
    expect(container.querySelector('.menu-bar')).toBeTruthy();
  });

  it('dispatches a command and closes on click', () => {
    const onCommand = vi.fn();
    render(createElement(MenuBar, { menus: spec, onCommand }));
    openMenu('File');
    fireEvent.click(screen.getByText('Save session'));
    expect(onCommand).toHaveBeenCalledWith('save');
    // Panel closed after activation.
    expect(screen.queryByText('Save session')).toBeNull();
  });

  it('renders checks and ignores disabled items', () => {
    const onCommand = vi.fn();
    render(createElement(MenuBar, { menus: spec, onCommand }));
    openMenu('File');
    const disabled = screen.getByText('Export Solution Package…').closest('button') as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    fireEvent.click(disabled);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('opens a submenu and shows the checked season', () => {
    const onCommand = vi.fn();
    render(createElement(MenuBar, { menus: spec, onCommand }));
    openMenu('View');
    fireEvent.click(screen.getByText('Game season'));
    const fieldA = screen.getByText('Field A').closest('button') as HTMLButtonElement;
    expect(fieldA.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(fieldA);
    expect(onCommand).toHaveBeenCalledWith('season-a');
  });
});

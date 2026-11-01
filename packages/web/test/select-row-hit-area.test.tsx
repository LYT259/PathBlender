/**
 * Regression (user report 2026-10-11): settings rows wrapped their select in a
 * full-width <label>, so clicking — or in WebKit even hovering — the empty row
 * area beside the pill activated the dropdown. The row must be a plain div
 * with the label text wired through aria-labelledby: only the pill itself
 * opens the list. The checkboxes keep their <label> (toggling from the label
 * text is wanted there).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parseGhostAuto } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { RobotInspector } from '../src/components/RobotList';

const mode = vi.hoisted(() => ({ viewerOnly: false }));
vi.mock('../src/viewer', () => ({ get VIEWER_ONLY() { return mode.viewerOnly; } }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pb.lang', 'en');
});
afterEach(cleanup);

function panel(tab: string, desktop = false) {
  render(
    <ThemeProvider>
      <UpdateChannelProvider>
        <I18nProvider>
          <PreferencesPanel desktop={desktop} onClose={() => {}} />
        </I18nProvider>
      </UpdateChannelProvider>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: tab }));
}

/** Clicking the row's text or its empty middle must not open the dropdown. */
function expectRowNotToOpen(rowText: string, controlName: string | RegExp) {
  const control = screen.getByRole('combobox', { name: controlName });
  fireEvent.click(screen.getByText(rowText));
  expect(screen.queryByRole('listbox')).toBeNull();
  const row = control.parentElement;
  expect(row).not.toBeNull();
  expect(row!.tagName).not.toBe('LABEL');
  fireEvent.click(row!);
  expect(screen.queryByRole('listbox')).toBeNull();
  // The pill itself still opens on a direct click.
  fireEvent.click(control);
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(control, { key: 'Escape' });
}

describe('settings rows do not extend a select’s hit area beyond its pill', () => {
  it('Controls tab: unit and mouse-scheme rows stay inert outside the pill', () => {
    panel('Controls');
    expectRowNotToOpen('Length unit', /length unit/i);
    expectRowNotToOpen('Mouse controls (3D view)', /mouse controls/i);
  });

  it('Updates tab: channel row stays inert outside the pill', () => {
    panel('Updates', true);
    expectRowNotToOpen('Update channel', 'Update channel');
  });

  it('Robot inspector: profile row stays inert outside the pill', () => {
    const source = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
    const robot = makeSession(parseGhostAuto(source, 'straight_run.ghostauto'));
    const profiles = [{
      id: 'p1', relPath: 'square/robot.json',
      profile: { name: 'Square', geometry: { lengthM: 0.9, widthM: 0.9, offsetX: 0, offsetY: 0 }, moduleLocations: [] },
    }];
    render(<I18nProvider><RobotInspector robot={robot} libraryProfiles={profiles}
      editingId={null} onUpdate={vi.fn()} onSetAlliance={vi.fn()} onSetGeometry={vi.fn()} onSetTeamNumber={vi.fn()}
      onToggleEdit={vi.fn()} onResetEdit={vi.fn()} onExport={vi.fn()} onRemove={vi.fn()} onApplyProfile={vi.fn()} /></I18nProvider>);
    expectRowNotToOpen('Robot profile', 'Robot profile');
  });
});

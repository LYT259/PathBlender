import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parseGhostAuto, type SessionTrajectory } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { RobotInspector, RobotList } from '../src/components/RobotList';
import { sequenceViewFor } from '../src/auto-sequence-state';

const mode = vi.hoisted(() => ({ viewerOnly: false }));
vi.mock('../src/viewer', () => ({ get VIEWER_ONLY() { return mode.viewerOnly; } }));

function robot() {
  const source = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
  return makeSession(parseGhostAuto(source, 'straight_run.ghostauto'));
}

/** The composition editor is part of the inspector now; a read-only view of it. */
function inspectorSequence(sample: ReturnType<typeof robot>) {
  const view = sequenceViewFor(sample);
  return { routes: view.routes, segments: view.segments, onChange: vi.fn(), joins: [] };
}

function inspectorCallbacks() {
  return {
    editingId: null,
    onUpdate: vi.fn(),
    onSetAlliance: vi.fn(),
    onSetGeometry: vi.fn(),
    onSetTeamNumber: vi.fn(),
    onToggleEdit: vi.fn(),
    onResetEdit: vi.fn(),
    onExport: vi.fn(),
    onRemove: vi.fn(),
    libraryProfiles: [],
    onApplyProfile: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.setItem('pb.lang', 'en');
  mode.viewerOnly = false;
});

describe('robot workspace controls', () => {
  it('keeps selection separate from field visibility', () => {
    const sample = robot();
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    render(<I18nProvider><RobotList robots={[sample]} conflicts={[]} selectedId={sample.trajectory.id} onSelect={onSelect} onImport={vi.fn()} onUpdate={onUpdate} onPickRoute={vi.fn()} /></I18nProvider>);

    const select = screen.getByRole('button', { name: '#0001, Ghost, 8.30 s' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide #0001 on field' }));
    expect(onUpdate).toHaveBeenCalledWith(sample.trajectory.id, { visible: false });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledWith(sample.trajectory.id);
  });

  it('shows dimensions read-only for every source — the app is a pure viewer', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} sequence={inspectorSequence(sample)} /></I18nProvider>);

    // The composition editor adds one Start spinbutton; dimensions and
    // geometry stay read-only (no length/width inputs).
    expect(screen.queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(`${sample.trajectory.geometry.lengthM.toFixed(2)} m`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${sample.trajectory.geometry.widthM.toFixed(2)} m`).length).toBeGreaterThan(0);
  });

  it('exposes no editing affordances anywhere on the card', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} sequence={inspectorSequence(sample)} /></I18nProvider>);
    // Pure viewer (2026-09-30): no team-number input, no alliance toggle,
    // no geometry spinbuttons, no edit/reset/export actions. The composition
    // editor's start-time fields are the one deliberate editing surface
    // (multi-segment auto, red book v1.38).
    expect(screen.queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit path/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\.path$|\.traj$|\.ghostauto$/ })).not.toBeInTheDocument();
  });

  it('no longer repeats team identity under the robot name (removed 2026-10-04)', () => {
    const sample = robot();
    sample.trajectory.teamName = 'The Cheesy Poofs';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} sequence={inspectorSequence(sample)} /></I18nProvider>);
    // The whole identity block (team name / team # / alliance rows) is gone —
    // that identity is already obvious from the robot card and alliance bar.
    expect(screen.queryByText('team #')).not.toBeInTheDocument();
    expect(screen.queryByText('alliance')).not.toBeInTheDocument();
    expect(screen.queryByText('The Cheesy Poofs')).not.toBeInTheDocument();
    // The read-only Timing row was replaced by the composition editor.
    expect(screen.getByText('Auto sequence')).toBeInTheDocument();
    expect(screen.getByText('Robot data')).toBeInTheDocument();
  });

  it('the details heading keeps the original identity even when a display name is set', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    sample.trajectory.displayName = 'My Robot';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    // Display names label the list, playback bar and field; the details
    // panel sticks to the imported #teamNumber/name rule.
    expect(screen.getByRole('heading', { name: '#0001' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My Robot' })).not.toBeInTheDocument();
  });

  it('preserves viewer-only limits while showing robot data', () => {
    mode.viewerOnly = true;
    const sample = robot();
    sample.trajectory.geometrySource = 'default';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} sequence={inspectorSequence(sample)} /></I18nProvider>);
    expect(screen.queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit path' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '.ghostauto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    expect(screen.getByText('Robot data')).toBeInTheDocument();
  });
});

describe('display name editor (free-text label, 2026-10-04)', () => {
  function renderList(robots: SessionTrajectory[], onUpdate = vi.fn()) {
    render(
      <I18nProvider>
        <RobotList
          robots={robots}
          conflicts={[]}
          selectedId={null}
          onSelect={vi.fn()}
          onImport={vi.fn()}
          onUpdate={onUpdate}
          onPickRoute={vi.fn()}
        />
      </I18nProvider>,
    );
    return onUpdate;
  }
  function openEditor(): HTMLInputElement {
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    return screen.getByRole('textbox', { name: 'Edit display name' }) as HTMLInputElement;
  }
  function committedTrajectory(onUpdate: ReturnType<typeof vi.fn>) {
    const patch = onUpdate.mock.calls[0]![1] as { trajectory: SessionTrajectory['trajectory'] };
    return patch.trajectory;
  }

  it('edits the display name inline without touching the imported team number', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    expect(input).toHaveValue('0001');
    fireEvent.change(input, { target: { value: '2910' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![0]).toBe(sample.trajectory.id);
    const trajectory = committedTrajectory(onUpdate);
    expect(trajectory.displayName).toBe('2910');
    expect(trajectory.teamNumber).toBe('0001');
  });

  it('accepts free text in any language and commits on blur', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '红队射手' } });
    fireEvent.blur(input);
    expect(committedTrajectory(onUpdate).displayName).toBe('红队射手');
  });

  it('keeps mixed text verbatim — no digit filtering', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '29a1b0' } });
    expect(input).toHaveValue('29a1b0');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(committedTrajectory(onUpdate).displayName).toBe('29a1b0');
  });

  it('caps the draft at 64 characters', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    renderList([sample]);
    expect(openEditor()).toHaveAttribute('maxlength', '64');
  });

  it('discards the draft on Escape', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('clearing the input restores the original identity display', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    sample.trajectory.displayName = 'My Robot';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    expect(input).toHaveValue('My Robot');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const trajectory = committedTrajectory(onUpdate);
    expect(trajectory.displayName).toBeUndefined();
    expect(trajectory.teamNumber).toBe('0001');
  });

  it('leaving the editor unchanged commits nothing', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    fireEvent.blur(openEditor());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is in flight', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    const onUpdate = renderList([sample]);
    const input = openEditor();
    fireEvent.change(input, { target: { value: '红队' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(committedTrajectory(onUpdate).displayName).toBe('红队');
  });
});

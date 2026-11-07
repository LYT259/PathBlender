import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parseGhostAuto, type SessionTrajectory, type TimingSource } from '@pathblender/core';
import { I18nProvider } from '../src/i18n';
import { RobotInspector, RobotList } from '../src/components/RobotList';

const mode = vi.hoisted(() => ({ viewerOnly: false }));
vi.mock('../src/viewer', () => ({ get VIEWER_ONLY() { return mode.viewerOnly; } }));

function robot() {
  const source = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');
  return makeSession(parseGhostAuto(source, 'straight_run.ghostauto'));
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
  // Pin meters for this file: its subject is read-only inspector behavior,
  // not the unit preference (the inches default is asserted separately).
  localStorage.setItem('pb.lengthUnit', 'm');
  mode.viewerOnly = false;
});

describe('robot workspace controls', () => {
  it('keeps selection separate from field visibility', () => {
    const sample = robot();
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    render(<I18nProvider><RobotList robots={[sample]} conflicts={[]} selectedId={sample.trajectory.id} onSelect={onSelect} onImport={vi.fn()} onUpdate={onUpdate} onPickRoute={vi.fn()} /></I18nProvider>);

    const select = screen.getByRole('button', { name: '0001, Ghost, 8.30 s' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide 0001 on field' }));
    expect(onUpdate).toHaveBeenCalledWith(sample.trajectory.id, { visible: false });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledWith(sample.trajectory.id);
  });

  it('shows dimensions read-only for every source — the app is a pure viewer', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);

    // The composition editor adds one Start spinbutton; dimensions and
    // geometry stay read-only (no length/width inputs).
    expect(screen.queryByRole('spinbutton', { name: /length|width/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(`${sample.trajectory.geometry.lengthM.toFixed(2)} m`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${sample.trajectory.geometry.widthM.toFixed(2)} m`).length).toBeGreaterThan(0);
  });

  it('renders dimensions in the default length unit (inches) when none is stored', () => {
    localStorage.removeItem('pb.lengthUnit');
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    // File geometry 0.9 m → 35.4 in under the default inches preference.
    expect(screen.getAllByText('35.4 in').length).toBeGreaterThan(0);
  });

  it('exposes no editing affordances anywhere on the card', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
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
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    // The whole identity block (team name / team # / alliance rows) is gone —
    // that identity is already obvious from the robot card and alliance bar.
    expect(screen.queryByText('team #')).not.toBeInTheDocument();
    expect(screen.queryByText('alliance')).not.toBeInTheDocument();
    expect(screen.queryByText('The Cheesy Poofs')).not.toBeInTheDocument();
    // Robot data stays read-only; the composition editor lives on the
    // bottom arrangement surface, not in this panel.
    expect(screen.queryByText('Auto sequence')).not.toBeInTheDocument();
    expect(screen.getByText('Robot data')).toBeInTheDocument();
  });

  it('the details heading keeps the original identity even when a display name is set', () => {
    const sample = robot();
    sample.trajectory.teamNumber = '0001';
    sample.trajectory.displayName = 'My Robot';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    // Display names label the list, playback bar and field; the details
    // panel sticks to the imported teamNumber/name rule.
    expect(screen.getByRole('heading', { name: '0001' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My Robot' })).not.toBeInTheDocument();
  });

  it('preserves viewer-only limits while showing robot data', () => {
    mode.viewerOnly = true;
    const sample = robot();
    sample.trajectory.geometrySource = 'default';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
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

describe('always-visible mirror button (2026-10-05)', () => {
  it('presses from mirroredIds and routes clicks to the shared mirror toggle', () => {
    const sample = robot();
    const onMirror = vi.fn();
    const base = { robots: [sample], conflicts: [], selectedId: null as string | null, onSelect: vi.fn(), onImport: vi.fn(), onUpdate: vi.fn() };
    const { rerender } = render(
      <I18nProvider><RobotList {...base} onMirror={onMirror} onMirrorButtonClick={onMirror} mirroredIds={new Set([sample.trajectory.id])} /></I18nProvider>,
    );
    const button = screen.getByRole('button', { name: 'Mirror left/right' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onMirror).toHaveBeenCalledWith(sample.trajectory.id);
    // Without the App wiring the button renders disabled instead of dead.
    rerender(<I18nProvider><RobotList {...base} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Mirror left/right' })).toBeDisabled();
  });
});

describe('timing source badge', () => {
  /** A restored pre-2026-11-07 session carries no timingSource — the source
   *  field is then the only timing evidence, exactly like these fixtures. */
  function timingRobot(source: SessionTrajectory['trajectory']['source'], timingSource?: TimingSource): SessionTrajectory {
    const sample = robot();
    sample.trajectory.source = source;
    sample.trajectory.timingSource = timingSource;
    return sample;
  }
  // Hand-checked English literals: the label shown and the hint exposed as
  // the badge title, one row per timing state.
  const STATES: ReadonlyArray<[TimingSource, string, string]> = [
    ['default-config', 'Default-estimate timing', 'Estimated with PathBlender’s default robot config'],
    ['partial-config', 'Partial-config timing', 'Some timing parameters fell back to PathBlender defaults'],
    ['full-config', 'Real-config timing', 'Generated from this team’s imported robot config — still a plan, not a measurement'],
    ['logged', 'Logged run', 'Recorded from the robot’s log during an actual run'],
  ];

  it('shows the badge for each timing state', () => {
    for (const [timingSource, label, hint] of STATES) {
      const view = render(<I18nProvider><RobotInspector robot={timingRobot('pathplanner-path', timingSource)} {...inspectorCallbacks()} /></I18nProvider>);
      const badge = screen.getByText(label);
      expect(badge).toHaveAttribute('title', hint);
      // The geometry badge stays beside it: size-imported ≠ time-calibrated.
      expect(screen.getByText('From file')).toBeInTheDocument();
      view.unmount();
    }
    // Choreo carries its own samples; PathBlender makes no timing claim.
    render(<I18nProvider><RobotInspector robot={timingRobot('choreo-traj', undefined)} {...inspectorCallbacks()} /></I18nProvider>);
    for (const [, label] of STATES) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('old sessions read as default estimate', () => {
    const planner = render(<I18nProvider><RobotInspector robot={timingRobot('pathplanner-path', undefined)} {...inspectorCallbacks()} /></I18nProvider>);
    expect(screen.getByText('Default-estimate timing')).toBeInTheDocument();
    expect(screen.queryByText('Logged run')).not.toBeInTheDocument();
    planner.unmount();
    // A pre-timingSource WPILOG session was a real recorded run.
    render(<I18nProvider><RobotInspector robot={timingRobot('wpilog', undefined)} {...inspectorCallbacks()} /></I18nProvider>);
    expect(screen.getByText('Logged run')).toBeInTheDocument();
  });

  it('partial badge does not claim real config', () => {
    render(<I18nProvider><RobotInspector robot={timingRobot('pathplanner-path', 'partial-config')} {...inspectorCallbacks()} /></I18nProvider>);
    expect(screen.getByText('Partial-config timing')).toBeInTheDocument();
    expect(screen.queryByText('Real-config timing')).not.toBeInTheDocument();
  });
});

describe('stale timing warnings (pre-timingSource sessions)', () => {
  // The exact string the pre-2026-11-07 build wrote when it regenerated a
  // timeline from a profile — back then a mass-only profile already claimed
  // "real robot config" and no timing state was recorded to contradict it.
  const LEGACY_FULL_CONFIG_WARNING = 'regenerated with real robot config from profile "254"';

  it('drops the legacy full-config claim beside the conservative default badge', () => {
    const legacy = robot();
    legacy.trajectory.source = 'pathplanner-path';
    legacy.trajectory.timingSource = undefined;
    legacy.trajectory.warnings = [LEGACY_FULL_CONFIG_WARNING, 'Missing waypoint data'];
    render(<I18nProvider><RobotInspector robot={legacy} {...inspectorCallbacks()} /></I18nProvider>);
    // Restored without timingSource, the source stands in: default estimate.
    expect(screen.getByText('Default-estimate timing')).toBeInTheDocument();
    // The stale claim contradicts that badge and is hidden…
    expect(screen.queryByText(LEGACY_FULL_CONFIG_WARNING)).not.toBeInTheDocument();
    // …while unrelated diagnostics stay visible.
    expect(screen.getByText('Missing waypoint data')).toBeInTheDocument();
  });

  it('keeps the same warning when timingSource explicitly records full-config', () => {
    const current = robot();
    current.trajectory.source = 'pathplanner-path';
    current.trajectory.timingSource = 'full-config';
    current.trajectory.warnings = [LEGACY_FULL_CONFIG_WARNING];
    render(<I18nProvider><RobotInspector robot={current} {...inspectorCallbacks()} /></I18nProvider>);
    // A current build wrote both the state and the warning: legitimate
    // messaging, not a stale claim.
    expect(screen.getByText('Real-config timing')).toBeInTheDocument();
    expect(screen.getByText(LEGACY_FULL_CONFIG_WARNING)).toBeInTheDocument();
  });
});

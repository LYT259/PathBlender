import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSession, parseGhostAuto } from '@pathblender/core';
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
  localStorage.setItem('ghpb.lang', 'en');
  mode.viewerOnly = false;
});

describe('robot workspace controls', () => {
  it('keeps selection separate from field visibility', () => {
    const sample = robot();
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    render(<I18nProvider><RobotList robots={[sample]} conflicts={[]} selectedId={sample.trajectory.id} onSelect={onSelect} onImport={vi.fn()} onUpdate={onUpdate} libraryRoutes={[]} libraryProfiles={[]} onPickRoute={vi.fn()} onAddRoute={vi.fn()} /></I18nProvider>);

    const select = screen.getByRole('button', { name: '#0001 Straight Run, Ghost, 8.30 s' });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Straight Run on field' }));
    expect(onUpdate).toHaveBeenCalledWith(sample.trajectory.id, { visible: false });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledWith(sample.trajectory.id);
  });

  it('shows dimensions read-only for every source — the app is a pure viewer', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getAllByText(`${sample.trajectory.geometry.lengthM.toFixed(2)} m`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${sample.trajectory.geometry.widthM.toFixed(2)} m`).length).toBeGreaterThan(0);
  });

  it('exposes no editing affordances anywhere on the card', () => {
    const sample = robot();
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    // Pure viewer (2026-09-30): no team-number input, no alliance toggle,
    // no delay/geometry spinbuttons, no edit/reset/export actions.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit path/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\.path$|\.traj$|\.ghostauto$/ })).not.toBeInTheDocument();
  });

  it('preserves viewer-only limits while showing robot data', () => {
    mode.viewerOnly = true;
    const sample = robot();
    sample.trajectory.geometrySource = 'default';
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit path' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '.ghostauto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from session' })).not.toBeInTheDocument();
    expect(screen.getByText('Robot data')).toBeInTheDocument();
  });
});

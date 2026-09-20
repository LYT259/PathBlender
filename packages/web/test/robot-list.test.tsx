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
  };
}

beforeEach(() => {
  localStorage.setItem('ghpb.lang', 'en');
  mode.viewerOnly = false;
});

describe('robot workspace controls', () => {
  it('keeps selection separate from field visibility and leaves parameter editing out of the list', () => {
    const sample = robot();
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    render(<I18nProvider><RobotList robots={[sample]} conflicts={[]} selectedId={sample.trajectory.id} onSelect={onSelect} onImport={vi.fn()} onUpdate={onUpdate} /></I18nProvider>);

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

  it('never exposes dimensions from a file as editable controls', () => {
    const sample = robot();
    expect(sample.trajectory.geometrySource).toBe('file');
    render(<I18nProvider><RobotInspector robot={sample} {...inspectorCallbacks()} /></I18nProvider>);

    expect(screen.getByText('From file')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'length' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'width' })).not.toBeInTheDocument();
    expect(screen.getAllByText(`${sample.trajectory.geometry.lengthM.toFixed(2)} m`).length).toBeGreaterThan(0);
    expect(screen.getByRole('spinbutton', { name: 'delay (s)' })).toBeInTheDocument();
  });

  it('commits complete bounded dimensions, leaving incomplete typing out of collision inputs', () => {
    const sample = robot();
    sample.trajectory.geometrySource = 'default';
    const callbacks = inspectorCallbacks();
    render(<I18nProvider><RobotInspector robot={sample} {...callbacks} /></I18nProvider>);
    const length = screen.getByRole('spinbutton', { name: 'length' });
    fireEvent.change(length, { target: { value: '' } });
    expect(callbacks.onSetGeometry).not.toHaveBeenCalled();
    fireEvent.blur(length);
    expect(length).toHaveValue(sample.trajectory.geometry.lengthM);
    fireEvent.change(length, { target: { value: '0.95' } });
    expect(callbacks.onSetGeometry).not.toHaveBeenCalled();
    fireEvent.blur(length);
    expect(callbacks.onSetGeometry).toHaveBeenCalledWith(sample.trajectory.id, { lengthM: 0.95 });
    fireEvent.change(length, { target: { value: '99' } });
    fireEvent.blur(length);
    expect(callbacks.onSetGeometry).toHaveBeenLastCalledWith(sample.trajectory.id, { lengthM: 2 });
  });

  it('drops an unfinished numeric draft when selecting a different robot', () => {
    const first = robot();
    const second = { ...robot(), startDelayS: 2, trajectory: { ...robot().trajectory, id: 'second' } };
    const callbacks = inspectorCallbacks();
    const view = render(<I18nProvider><RobotInspector robot={first} {...callbacks} /></I18nProvider>);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'delay (s)' }), { target: { value: '7' } });
    view.rerender(<I18nProvider><RobotInspector robot={second} {...callbacks} /></I18nProvider>);
    expect(screen.getByRole('spinbutton', { name: 'delay (s)' })).toHaveValue(2);
    expect(callbacks.onUpdate).not.toHaveBeenCalled();
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

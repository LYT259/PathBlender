import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { REBUILT_2026, type SessionTrajectory } from '@pathblender/core';
import { App } from '../src/App';
import { saveText } from '../src/download';

vi.mock('../src/download', () => ({ saveText: vi.fn(), copyText: vi.fn() }));
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-2d">{JSON.stringify(_props.robots)}</div>) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas3D: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-3d">{JSON.stringify(_props.robots)}</div>) };
});

const pathFile = (name: string) => new File([readFileSync(resolve(__dirname, '../../../samples/ghostauto', name), 'utf8')], name);
const fieldRobots = (mode = '2d'): SessionTrajectory[] => JSON.parse(screen.getByTestId(`field-${mode}`).textContent!);
const side = (name: string) => within(screen.getByRole('group', { name: 'alliance' })).getByRole('button', { name, exact: true });
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
// Existing import notifications schedule a 2.5s dismiss. Let them settle
// before jsdom teardown; do not leave real timers crossing environments.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

describe('whole-session alliance control', () => {
  it('switches the entire alliance in 2D and 3D', async () => {
    render(<App />);
    expect(screen.queryByRole('group', { name: 'alliance' })).toBeNull();
    drop([pathFile('straight_run.ghostauto'), pathFile('stop_and_score.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const blue = fieldRobots();
    expect(side('Blue')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(side('Red'));
    expect(fieldRobots().every((r) => r.trajectory.alliance === 'red')).toBe(true);
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - blue[0]!.trajectory.samples[0]!.x, 10);
    const red = fieldRobots();
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    await screen.findByTestId('field-3d');
    expect(fieldRobots('3d')).toEqual(red);
    fireEvent.click(side('Blue'));
    expect(fieldRobots('3d')).toEqual(blue);
  });

  it('keeps red for later imports, library replacements and added robots, and persists it in a saved session', async () => {
    render(<App />);
    drop([pathFile('straight_run.ghostauto')]);
    await screen.findByTestId('field-2d');
    fireEvent.click(side('Red'));
    drop([pathFile('stop_and_score.ghostauto')]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(2));
    const a = pathFile('straight_run.ghostauto');
    const b = pathFile('side_lane.ghostauto');
    Object.defineProperty(a, 'webkitRelativePath', { value: 'choreo/Straight.ghostauto' });
    Object.defineProperty(b, 'webkitRelativePath', { value: 'choreo/Side.ghostauto' });
    drop([a, b]);
    await waitFor(() => expect(fieldRobots()).toHaveLength(3));
    const picker = screen.getAllByRole('combobox', { name: /Active route for/ })[2]!;
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
    fireEvent.change(picker, { target: { value: options[1]!.value } });
    expect(fieldRobots()).toHaveLength(3);
    expect(fieldRobots().every((r) => r.trajectory.alliance === 'red')).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Save session', exact: true })[0]!);
    const saved = vi.mocked(saveText).mock.calls.at(-1)![2];
    const payload = JSON.parse(saved);
    expect(payload.robots.every((r: { alliance: string }) => r.alliance === 'red')).toBe(true);
    const positions = payload.robots.map((r: { samples: { x: number }[] }) => r.samples[0]!.x);
    fireEvent.click(side('Blue'));
    drop([new File([saved], 'red.pb')]);
    await waitFor(() => expect(side('Red')).toHaveAttribute('aria-pressed', 'true'));
    expect(fieldRobots().map((r) => r.trajectory.samples[0]!.x)).toEqual(positions);
  });

  it('retains the group selection after ending an example and importing a folder', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try an example', exact: true }));
    await screen.findByTestId('field-2d');
    fireEvent.click(side('Red'));
    const file = pathFile('straight_run.ghostauto');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'autos/straight_run.ghostauto' });
    drop([file]);
    await screen.findByRole('combobox', { name: 'Active route for #0001' });
    fireEvent.click(screen.getByRole('button', { name: 'End example', exact: true }));
    expect(fieldRobots()).toHaveLength(1);
    expect(fieldRobots()[0]!.trajectory.alliance).toBe('red');
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBeCloseTo(REBUILT_2026.lengthM - 2, 10);
    fireEvent.click(side('Blue'));
    expect(fieldRobots()[0]!.trajectory.samples[0]!.x).toBe(2);
  });
});

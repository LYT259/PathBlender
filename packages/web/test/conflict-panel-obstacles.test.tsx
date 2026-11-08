/**
 * Obstacle collision checks in the checks panel (Task 7 of the
 * field-obstacles-collision plan): App-level detection drives the section
 * through real imports on the default rebuilt-2026 welded field; panel-level
 * renders pin the empty-field hiding and the jump callback.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { ConflictPanel } from '../src/components/ConflictPanel';
import { I18nProvider } from '../src/i18n';
import { REBUILT_2026, obstaclesForField } from '@pathblender/core';

beforeEach(() => localStorage.clear());
afterAll(() => new Promise((resolve) => setTimeout(resolve, 2600)));

/** An inline .ghostauto whose states walk start→end along constant y. */
function walkGhostauto(name: string, from: { x: number; y: number }, to: { x: number; y: number }, durationS = 4): File {
  const steps = 41;
  const states = Array.from({ length: steps }, (_, i) => {
    const t = (i / (steps - 1)) * durationS;
    const x = from.x + ((to.x - from.x) * i) / (steps - 1);
    const y = from.y + ((to.y - from.y) * i) / (steps - 1);
    return { t, x, y, rotation: 0, vx: 0, vy: 0, omega: 0, moduleStates: [] };
  });
  const doc = {
    version: '1.0',
    name,
    teamName: 'Team 0001',
    bumperSize: { width: 0.9, height: 0.9 },
    bumperOffset: { x: 0, y: 0 },
    holonomic: true,
    moduleLocations: [
      { x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.3, y: 0.3 }, { x: -0.3, y: -0.3 },
    ],
    states,
  };
  return new File([JSON.stringify(doc)], `${name}.ghostauto`);
}

const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { files } });

describe('obstacle section in the checks panel', () => {
  it('shows the obstacle section with a hit when a path drives through the 2026 blue hub', async () => {
    // Crossing coordinates derive from the committed hub-blue hull centroid —
    // no hard-coded field coordinates.
    const hub = obstaclesForField(REBUILT_2026, 'welded').find((o) => o.id === 'hub-blue')!;
    const cx = hub.hull.reduce((s, p) => s + p.x, 0) / hub.hull.length;
    const cy = hub.hull.reduce((s, p) => s + p.y, 0) / hub.hull.length;
    const { container } = render(<App />);
    drop([walkGhostauto('hub_crosser', { x: cx - 3, y: cy }, { x: cx + 3, y: cy })]);
    await waitFor(() => expect(screen.getByText('Field obstacles')).toBeInTheDocument());
    const items = container.querySelectorAll('.conflict-item');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('Hub');
    const counts = container.querySelectorAll('.conflict-count');
    expect([...counts].some((c) => c.textContent === '1')).toBe(true);
  });

  it('hidden robots contribute no obstacle hits', async () => {
    const hub = obstaclesForField(REBUILT_2026, 'welded').find((o) => o.id === 'hub-blue')!;
    const cx = hub.hull.reduce((s, p) => s + p.x, 0) / hub.hull.length;
    const cy = hub.hull.reduce((s, p) => s + p.y, 0) / hub.hull.length;
    const { container } = render(<App />);
    drop([walkGhostauto('hub_crosser', { x: cx - 3, y: cy }, { x: cx + 3, y: cy })]);
    await waitFor(() => expect(container.querySelectorAll('.conflict-item').length).toBe(1));
    // Hide the robot (RobotList eye toggle): detection follows the visible set.
    const eye = container.querySelector('.robot-library-visibility')!;
    expect(eye).not.toBeNull();
    fireEvent.click(eye);
    await waitFor(() => expect(container.querySelectorAll('.conflict-item').length).toBe(0));
    // The section itself stays (plan: render while obstacleDefs exist) with
    // its count at zero — the hit followed the robot away.
    const heading = container.querySelector('.check-section-heading.obstacles-heading');
    expect(heading).not.toBeNull();
    expect(heading!.querySelector('.conflict-count')!.textContent).toBe('0');
  });

  it('hides the section entirely when the field carries no obstacle definitions', () => {
    render(
      <I18nProvider>
        <ConflictPanel robots={[]} conflicts={[]} bounds={[]} obstacleHits={[]} obstacleDefs={[]} onJump={() => undefined} />
      </I18nProvider>,
    );
    expect(screen.queryByText('Field obstacles')).toBeNull();
  });

  it('jump button calls back with the interval midpoint and the robot id', () => {
    const onJump = vi.fn();
    const { container } = render(
      <I18nProvider>
        <ConflictPanel
          robots={[]}
          conflicts={[]}
          bounds={[]}
          obstacleDefs={[{
            id: 'hub-blue',
            name: 'Hub',
            hull: [{ x: 4, y: 3.4 }, { x: 5.2, y: 3.4 }, { x: 5.2, y: 4.6 }, { x: 4, y: 4.6 }],
            zMinM: 0,
            zMaxM: 0.5,
          }]}
          obstacleHits={[{
            robotId: 'robot-1',
            obstacleId: 'hub-blue',
            startT: 1,
            endT: 3,
            maxPenetrationM: 0.5,
            worstPose: { x: 4.6, y: 4, heading: 0 },
          }]}
          onJump={onJump}
        />
      </I18nProvider>,
    );
    const jump = container.querySelector('.conflict-jump.obstacles') as HTMLButtonElement;
    expect(jump).not.toBeNull();
    fireEvent.click(jump);
    expect(onJump).toHaveBeenCalledWith(2, ['robot-1']);
  });
});

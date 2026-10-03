import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEOMETRY, type SessionTrajectory } from '@pathblender/core';
import { Timeline } from '../src/components/Timeline';
import { I18nProvider } from '../src/i18n';

const delayedRobot: SessionTrajectory = {
  startDelayS: 4,
  color: '#007aff',
  visible: true,
  trajectory: {
    id: 'robot-a', name: 'Robot A', teamName: '', teamNumber: '',
    source: 'ghostauto', alliance: 'blue', samples: [], durationS: 4,
    geometry: DEFAULT_GEOMETRY, geometrySource: 'default', moduleLocations: [],
    events: [{ name: 'Score', t: 2 }], warnings: [],
  },
};

function playback(t = 6) {
  return { t, setT: vi.fn(), playing: true, setPlaying: vi.fn(), speed: 1, setSpeed: vi.fn() };
}

describe('unified timeline', () => {
  it('uses the edited team number without changing the imported route name', () => {
    const robot = { ...delayedRobot, trajectory: { ...delayedRobot.trajectory, teamNumber: '2910' } };
    render(<I18nProvider><Timeline robots={[robot]} conflicts={[]} bounds={[]} autoPeriodS={20} duration={8} playback={playback()} /></I18nProvider>);
    expect(screen.getByText('#2910')).toBeInTheDocument();
    expect(screen.queryByText('Robot A')).not.toBeInTheDocument();
    expect(robot.trajectory.name).toBe('Robot A');
  });

  it('uses one time domain for the ruler, scrubber, delayed activity, events, and playhead', () => {
    const { container } = render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} conflicts={[]} bounds={[]} autoPeriodS={20} duration={8} playback={playback()} />
      </I18nProvider>,
    );
    const scrubber = screen.getByRole('slider', { name: 'Playback position' });
    expect(scrubber).toHaveAttribute('max', '20');
    expect(scrubber).toHaveValue('6');
    const activity = screen.getByRole('img', { name: 'Robot A: 4.00–8.00 s' });
    expect(activity).toHaveStyle({ left: '20%', width: '20%' });
    expect(screen.getByRole('button', { name: 'Score at 6.00 s' })).toHaveStyle({ left: '30%' });
    expect(screen.getByText('6', { selector: '.timeline-tick' })).toHaveStyle({ left: '30%' });
    expect(container.querySelector('.timeline-playhead')).toHaveStyle({ left: '30%' });
  });

  it('pauses and selects the robot when a problem or delayed event is clicked', () => {
    const state = playback();
    const onSelect = vi.fn();
    render(
      <I18nProvider>
        <Timeline
          robots={[delayedRobot]}
          conflicts={[]}
          bounds={[{ robotId: 'robot-a', startT: 5, endT: 5.4, maxPenetrationM: 0.1, edges: ['near'], worstPose: { x: 0, y: 0, heading: 0 } }]}
          autoPeriodS={20} duration={8}
          playback={state}
          onSelect={onSelect}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Out of bounds: Robot A/ }));
    expect(state.setPlaying).toHaveBeenLastCalledWith(false);
    expect(state.setT).toHaveBeenLastCalledWith(5);
    expect(onSelect).toHaveBeenLastCalledWith('robot-a');
    fireEvent.click(screen.getByRole('button', { name: 'Score at 6.00 s' }));
    expect(state.setT).toHaveBeenLastCalledWith(6);
  });

  it('clamps scrub, forward-step, and End to the real duration, and rewinds while paused', () => {
    const state = playback(7.8);
    render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} conflicts={[]} bounds={[]} autoPeriodS={20} duration={8} playback={state} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forward 0.5 seconds' }));
    expect(state.setT).toHaveBeenLastCalledWith(8);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '19' } });
    expect(state.setT).toHaveBeenLastCalledWith(8);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(state.setT).toHaveBeenLastCalledWith(8);
    fireEvent.click(screen.getByRole('button', { name: 'Return to start' }));
    expect(state.setPlaying).toHaveBeenLastCalledWith(false);
    expect(state.setT).toHaveBeenLastCalledWith(0);
  });

  it('passes all collision participants and the event global time to the workspace jump handler', () => {
    const onJump = vi.fn();
    const state = playback();
    const secondRobot: SessionTrajectory = {
      ...delayedRobot,
      visible: false,
      trajectory: { ...delayedRobot.trajectory, id: 'robot-b', name: 'Robot B', events: [] },
    };
    render(
      <I18nProvider>
        <Timeline
          robots={[{ ...delayedRobot, visible: false }, secondRobot]}
          conflicts={[{
            aId: 'robot-a', bId: 'robot-b', startT: 5, endT: 5.5,
            minCenterDistanceM: 0.2, closestT: 5.2,
            closestA: { x: 1, y: 1, heading: 0 }, closestB: { x: 1.2, y: 1, heading: 0 },
          }]}
          bounds={[{ robotId: 'robot-b', startT: 7, endT: 7.2, maxPenetrationM: 0.1, edges: ['near'], worstPose: { x: 0, y: 0, heading: 0 } }]}
          autoPeriodS={20} duration={8}
          playback={state}
          onJump={onJump}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Collision: Robot B × Robot A/ }));
    expect(onJump).toHaveBeenLastCalledWith(5, ['robot-a', 'robot-b']);
    fireEvent.click(screen.getByRole('button', { name: /Out of bounds: Robot B/ }));
    expect(onJump).toHaveBeenLastCalledWith(7, ['robot-b']);
    fireEvent.click(screen.getByRole('button', { name: 'Score at 6.00 s' }));
    expect(onJump).toHaveBeenLastCalledWith(6, ['robot-a']);
    expect(state.setT).not.toHaveBeenCalled();
  });

  it('scales the ruler floor to the season auto period (15 s seasons)', () => {
    const { unmount } = render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} conflicts={[]} bounds={[]} autoPeriodS={15} duration={8} playback={playback()} />
      </I18nProvider>,
    );
    const scrubber = screen.getByRole('slider', { name: 'Playback position' });
    expect(scrubber).toHaveAttribute('max', '15');
    // The final tick carries the unit (chart-axis convention): "15 Seconds".
    expect(screen.getByText('15 Seconds', { selector: '.timeline-tick' })).toBeInTheDocument();
    expect(screen.getByText('6', { selector: '.timeline-tick' })).toHaveStyle({ left: '40%' });
    // A session running past the autonomous period keeps its own end.
    unmount();
    render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} conflicts={[]} bounds={[]} autoPeriodS={15} duration={18} playback={playback()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('max', '18');
  });

  it('disables playback for an empty session', () => {
    render(
      <I18nProvider>
        <Timeline robots={[]} conflicts={[]} bounds={[]} autoPeriodS={20} duration={0} playback={{ ...playback(), playing: false }} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Import paths to compare robots on one timeline.')).toBeInTheDocument();
  });
});

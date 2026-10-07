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
    render(<I18nProvider><Timeline robots={[robot]} autoPeriodS={20} duration={8} playback={playback()} /></I18nProvider>);
    expect(screen.getByText('#2910')).toBeInTheDocument();
    expect(screen.queryByText('Robot A')).not.toBeInTheDocument();
    expect(robot.trajectory.name).toBe('Robot A');
  });

  it('shows the display name in the playback bar when one is set', () => {
    const robot = { ...delayedRobot, trajectory: { ...delayedRobot.trajectory, teamNumber: '2910', displayName: '红队射手' } };
    render(<I18nProvider><Timeline robots={[robot]} autoPeriodS={20} duration={8} playback={playback()} /></I18nProvider>);
    expect(screen.getByText('红队射手')).toBeInTheDocument();
    expect(screen.queryByText('#2910')).not.toBeInTheDocument();
    expect(robot.trajectory.teamNumber).toBe('2910');
  });

  it('uses one time domain for the ruler, scrubber, delayed activity, events, and playhead', () => {
    const { container } = render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} autoPeriodS={20} duration={8} playback={playback()} />
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

  it('shows no conflict markers on the lane, and a delayed event click pauses and seeks', () => {
    // The conflict/out-of-bounds lane dots are gone (user 2026-10-07): the
    // checks panel owns conflict jumps; the lane keeps activity + events.
    const state = playback();
    const onSelect = vi.fn();
    render(
      <I18nProvider>
        <Timeline
          robots={[delayedRobot]}
          autoPeriodS={20} duration={8}
          playback={state}
          onSelect={onSelect}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: /Out of bounds: Robot A/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Collision:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Score at 6.00 s' }));
    expect(state.setPlaying).toHaveBeenLastCalledWith(false);
    expect(state.setT).toHaveBeenLastCalledWith(6);
    expect(onSelect).toHaveBeenLastCalledWith('robot-a');
  });

  it('clamps scrub, forward-step, and End to the real duration, and rewinds while paused', () => {
    const state = playback(7.8);
    render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} autoPeriodS={20} duration={8} playback={state} playbackRange="paths" />
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

  it('hands the event global time to the workspace jump handler, and hidden robots still show their lane', () => {
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
          autoPeriodS={20} duration={8}
          playback={state}
          onJump={onJump}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: /Collision:|Out of bounds:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Score at 6.00 s' }));
    expect(onJump).toHaveBeenLastCalledWith(6, ['robot-a']);
    expect(state.setT).not.toHaveBeenCalled();
  });

  it('scales the ruler floor to the season auto period (15 s seasons)', () => {
    const { unmount } = render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} autoPeriodS={15} duration={8} playback={playback()} />
      </I18nProvider>,
    );
    const scrubber = screen.getByRole('slider', { name: 'Playback position' });
    expect(scrubber).toHaveAttribute('max', '15');
    // Units stay in the label column, separate from centered tick numbers.
    expect(screen.getByText('15', { selector: '.timeline-tick' })).toBeInTheDocument();
    expect(screen.getByText('6', { selector: '.timeline-tick' })).toHaveStyle({ left: '40%' });
    // A session running past the autonomous period keeps its own end.
    unmount();
    render(
      <I18nProvider>
        <Timeline robots={[delayedRobot]} autoPeriodS={15} duration={18} playback={playback()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('max', '18');
  });

  it('opens the team editor across the entire row', () => {
    const onEditTeam = vi.fn();
    render(
      <I18nProvider>
        <Timeline
          robots={[delayedRobot]}
          autoPeriodS={20} duration={8}
          playback={playback()}
          onEditTeam={onEditTeam}
        />
      </I18nProvider>,
    );
    fireEvent.doubleClick(screen.getByRole('img', { name: 'Robot A: 4.00–8.00 s' }));
    expect(onEditTeam).toHaveBeenCalledTimes(1);
    expect(onEditTeam).toHaveBeenLastCalledWith('robot-a');
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Select Robot A' }));
    expect(onEditTeam).toHaveBeenCalledTimes(2);
  });

  it('disables playback for an empty session', () => {
    render(
      <I18nProvider>
        <Timeline robots={[]} autoPeriodS={20} duration={0} playback={{ ...playback(), playing: false }} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByText('Import paths to compare robots on one timeline.')).toBeInTheDocument();
  });
});

/**
 * Example-session onboarding checklist (2026-10-07 plan §3): five verifiable
 * exercises appear with the example, complete on their real actions, persist
 * locally, dismiss quietly and reopen from the Help menu — never blocking the
 * workspace and never rendering outside the example session.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSession, parsePathFile, serializeSession } from '@pathblender/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from '../src/App';
import { en } from '../src/i18n/en';

const sampleText = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

beforeEach(() => localStorage.clear());

async function openExample() {
  fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
  await screen.findByText('#8814', { selector: '.robot-name' }, { timeout: 10000 });
}

function tourCard() {
  return screen.getByRole('complementary', { name: en['tour.title'] });
}

describe('onboarding tour', () => {
  it('appears with the example listing five tasks at 0/5', async () => {
    render(<App />);
    expect(screen.queryByRole('complementary', { name: en['tour.title'] })).toBeNull();
    await openExample();
    const card = tourCard();
    expect(within(card).getByText('0/5')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(5);
    expect(within(card).getByText(en['tour.task.mirror.title'])).toBeInTheDocument();
  });

  it('marks the play task when playback starts, and remembers across remounts', async () => {
    const first = render(<App />);
    await openExample();
    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    await screen.findByRole('button', { name: 'Pause', exact: true });
    await waitFor(() => expect(within(tourCard()).getByText('1/5')).toBeInTheDocument());
    first.unmount();

    render(<App />);
    await openExample();
    expect(within(tourCard()).getByText('1/5')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pb.tour.v1')!).done.play).toBe(true);
  });

  it('marks the mirror task from the robot row button', async () => {
    render(<App />);
    await openExample();
    fireEvent.click(screen.getAllByRole('button', { name: en['robots.mirror'] })[0]!);
    await waitFor(() => expect(within(tourCard()).getByText('1/5')).toBeInTheDocument());
  });

  it('marks the plan task through a composer edit', async () => {
    render(<App />);
    await openExample();
    fireEvent.click(screen.getAllByRole('button', { name: /Arrange/ })[0]!);
    const lane = document.querySelector('.sequence-track.is-editing .sequence-track-lane') as HTMLElement;
    fireEvent.click(within(lane).getAllByRole('button', { name: /, \d+\.\d+–/ })[0]!);
    fireEvent.keyDown(lane.querySelector('.sequence-clip')!, { key: 'Backspace' });
    fireEvent.click([...document.querySelectorAll('.sequence-route-source')][1]!);
    await waitFor(() => expect(within(tourCard()).getByText('1/5')).toBeInTheDocument());
  });

  it('dismiss hides the card; the Help menu entry brings it back with progress', async () => {
    render(<App />);
    await openExample();
    fireEvent.click(within(tourCard()).getByRole('button', { name: en['tour.hide'] }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: en['tour.title'] })).toBeNull());
    // Same command the Help menu carries (web menubar + desktop pb-menu event).
    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    await screen.findByRole('button', { name: 'Pause', exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Pause', exact: true }));

    fireEvent.click(within(document.querySelector('.menu-bar')!).getByText('Help'));
    fireEvent.click(within(document.querySelector('.menu-bar')!).getByText(en['tour.title']));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: en['tour.title'] })).not.toBeNull());
    // Progress from the dismissed card survives the reopen.
    expect(within(tourCard()).getByText('1/5')).toBeInTheDocument();
  });

  it('shows the finished note once every task is done', async () => {
    localStorage.setItem('pb.tour.v1', JSON.stringify({
      dismissed: false,
      done: { play: true, issue: true, plan: true, alliance: true, mirror: true },
    }));
    render(<App />);
    await openExample();
    expect(within(tourCard()).getByText(en['tour.finished'])).toBeInTheDocument();
    expect(within(tourCard()).getByText('5/5')).toBeInTheDocument();
  });

  it('never marks tasks from a non-example session', async () => {
    const robot = makeSession(parsePathFile(sampleText, 'straight_run.ghostauto'), 0);
    localStorage.setItem('pb.autosave.v1', serializeSession([robot], 'rebuilt-2026'));
    render(<App />);
    await screen.findByText('#0001', { selector: '.robot-name' }, { timeout: 10000 });
    // The workspace actions exist and run…
    fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true }));
    await screen.findByRole('button', { name: 'Pause', exact: true });
    // …but no tour card was ever shown, and nothing was recorded.
    expect(screen.queryByRole('complementary', { name: en['tour.title'] })).toBeNull();
    expect(JSON.parse(localStorage.getItem('pb.tour.v1') ?? '{"done":{}}').done.play ?? false).toBe(false);
  });
});

/**
 * Update-channel provider edge cases: storage corruption, cross-window
 * pref sync, and the no-echo rule (a remotely applied change must never be
 * re-broadcast — that would ping-pong between windows forever).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const broadcasts: [string, string][] = [];
let remoteHandler: ((key: string, value: string) => void) | undefined;

vi.mock('../src/pref-sync', () => ({
  broadcastPref: (key: string, value: string) => broadcasts.push([key, value]),
  listenPrefs: (handler: (key: string, value: string) => void) => {
    remoteHandler = handler;
    return () => {
      remoteHandler = undefined;
    };
  },
}));

import { UpdateChannelProvider, useUpdateChannel } from '../src/update-channel';

function Probe() {
  const { channel, setChannel } = useUpdateChannel();
  return (
    <div>
      <span data-testid="channel">{channel}</span>
      <button onClick={() => setChannel('beta')} data-testid="set-beta" />
    </div>
  );
}

const renderProbe = () => render(<UpdateChannelProvider><Probe /></UpdateChannelProvider>);

beforeEach(() => {
  localStorage.clear();
  broadcasts.length = 0;
  remoteHandler = undefined;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('initial channel from localStorage', () => {
  it('defaults to stable', () => {
    const { getByTestId } = renderProbe();
    expect(getByTestId('channel').textContent).toBe('stable');
  });

  it('restores a stored beta choice', () => {
    localStorage.setItem('pb.updateChannel', 'beta');
    const { getByTestId } = renderProbe();
    expect(getByTestId('channel').textContent).toBe('beta');
  });

  it('treats corrupted values as stable (never throws)', () => {
    localStorage.setItem('pb.updateChannel', 'Beta');
    localStorage.setItem('pb.updateChannel', 'nightly'); // last write wins
    const { getByTestId } = renderProbe();
    expect(getByTestId('channel').textContent).toBe('stable');
  });

  it('survives a throwing localStorage (session-only default)', () => {
    const getter = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const { getByTestId } = renderProbe();
    expect(getByTestId('channel').textContent).toBe('stable');
    getter.mockRestore();
  });
});

describe('setChannel', () => {
  it('persists and broadcasts the choice', () => {
    const { getByTestId } = renderProbe();
    act(() => getByTestId('set-beta').click());
    expect(getByTestId('channel').textContent).toBe('beta');
    expect(localStorage.getItem('pb.updateChannel')).toBe('beta');
    expect(broadcasts).toEqual([['updateChannel', 'beta']]);
  });

  it('keeps working when localStorage is unwritable (state + broadcast only)', () => {
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    const { getByTestId } = renderProbe();
    act(() => getByTestId('set-beta').click());
    expect(getByTestId('channel').textContent).toBe('beta');
    expect(broadcasts).toEqual([['updateChannel', 'beta']]);
    setter.mockRestore();
  });
});

describe('remote pref sync (desktop prefs window)', () => {
  it('applies a valid remote updateChannel and persists it', () => {
    const { getByTestId } = renderProbe();
    act(() => remoteHandler?.('updateChannel', 'beta'));
    expect(getByTestId('channel').textContent).toBe('beta');
    expect(localStorage.getItem('pb.updateChannel')).toBe('beta');
  });

  it('ignores unknown keys and invalid values', () => {
    const { getByTestId } = renderProbe();
    act(() => remoteHandler?.('lang', 'beta'));
    act(() => remoteHandler?.('updateChannel', 'nightly'));
    act(() => remoteHandler?.('updateChannel', ''));
    expect(getByTestId('channel').textContent).toBe('stable');
  });

  it('does NOT re-broadcast a remotely applied change (no echo loop)', () => {
    renderProbe();
    broadcasts.length = 0;
    act(() => remoteHandler?.('updateChannel', 'beta'));
    expect(broadcasts).toEqual([]);
  });
});

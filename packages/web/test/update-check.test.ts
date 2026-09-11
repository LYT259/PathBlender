/**
 * runUpdateCheck: the desktop update runner. The Rust check_update command
 * decides the feed from the channel; these tests pin the contract —
 * channel is passed through, "feed unreachable" is reported as failed
 * (never disguised as up to date), install+relaunch ordering, and the
 * Windows case where the installer exits the app before relaunch resolves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, relaunch } = vi.hoisted(() => ({
  invoke: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

import { runUpdateCheck } from '../src/update-check';
import type { UpdateEvent } from '../src/update-check';

async function events(channel: 'stable' | 'beta'): Promise<UpdateEvent[]> {
  const out: UpdateEvent[] = [];
  await runUpdateCheck(channel, (e) => out.push(e));
  return out;
}

beforeEach(() => {
  invoke.mockReset();
  relaunch.mockReset();
});

describe('runUpdateCheck', () => {
  it('reports up to date when the feed returns null — no install, no relaunch', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await events('stable')).toEqual([{ kind: 'upToDate' }]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('check_update', { channel: 'stable' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('passes the channel through to the native command', async () => {
    invoke.mockResolvedValueOnce(null);
    await events('beta');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('check_update', { channel: 'beta' });
  });

  it('installs and relaunches when an update is found', async () => {
    invoke.mockResolvedValueOnce({ version: '0.2.0' }).mockResolvedValueOnce(undefined);
    relaunch.mockResolvedValueOnce(undefined);
    expect(await events('beta')).toEqual([
      { kind: 'found', version: '0.2.0' },
      { kind: 'installed' },
    ]);
    expect(invoke).toHaveBeenNthCalledWith(2, 'install_update');
    expect(relaunch).toHaveBeenCalledExactlyOnceWith();
  });

  it('reports installed even if relaunch never resolves (Windows installer exits the app)', async () => {
    invoke.mockResolvedValueOnce({ version: '0.2.0' }).mockResolvedValueOnce(undefined);
    relaunch.mockRejectedValueOnce(new Error('process exiting'));
    expect(await events('stable')).toEqual([
      { kind: 'found', version: '0.2.0' },
      { kind: 'installed' },
    ]);
  });

  it('maps a rejected check (offline / feed 404) to failed — not up to date', async () => {
    invoke.mockRejectedValueOnce(new Error('network'));
    expect(await events('stable')).toEqual([{ kind: 'failed' }]);
    expect(invoke).toHaveBeenCalledTimes(1); // no install attempt
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('maps an install failure to failed after the found event', async () => {
    invoke.mockResolvedValueOnce({ version: '0.2.0' }).mockRejectedValueOnce(new Error('disk full'));
    expect(await events('stable')).toEqual([
      { kind: 'found', version: '0.2.0' },
      { kind: 'failed' },
    ]);
    expect(relaunch).not.toHaveBeenCalled();
  });
});

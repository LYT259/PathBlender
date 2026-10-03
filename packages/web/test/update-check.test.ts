/**
 * runUpdateCheck: the desktop update runner. The Rust check_update command
 * decides the feed from the channel; these tests pin the contract —
 * channel is passed through, "feed unreachable" is reported as failed
 * (never disguised as up to date), install+relaunch ordering, and the
 * Windows case where the installer exits the app before relaunch resolves.
 *
 * checkForUpdate / installPendingUpdate are the two-step variant behind
 * the settings window's "Check for updates" button: the check must be
 * query-only (NEVER installing or relaunching on its own), and the
 * install step must tolerate a relaunch that never resolves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, relaunch } = vi.hoisted(() => ({
  invoke: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

import { checkForUpdate, installPendingUpdate, runUpdateCheck } from '../src/update-check';
import type { CheckEvent, UpdateEvent } from '../src/update-check';

async function events(channel: 'stable' | 'beta'): Promise<UpdateEvent[]> {
  const out: UpdateEvent[] = [];
  await runUpdateCheck(channel, (e) => out.push(e));
  return out;
}

async function checkEvents(channel: 'stable' | 'beta'): Promise<CheckEvent[]> {
  const out: CheckEvent[] = [];
  await checkForUpdate(channel, (e) => out.push(e));
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

describe('checkForUpdate', () => {
  it('reports up to date on null — exactly one invoke, never installs or relaunches', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await checkEvents('stable')).toEqual([{ kind: 'upToDate' }]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('check_update', { channel: 'stable' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('reports a found update and stops there — no install_update, no relaunch', async () => {
    invoke.mockResolvedValueOnce({ version: '0.2.0' });
    expect(await checkEvents('beta')).toEqual([{ kind: 'found', version: '0.2.0' }]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('check_update', { channel: 'beta' });
    expect(invoke).toHaveBeenCalledTimes(1); // query only — install stays stashed native-side
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('maps a rejected check (offline / feed 404) to failed — not up to date', async () => {
    invoke.mockRejectedValueOnce(new Error('network'));
    expect(await checkEvents('stable')).toEqual([{ kind: 'failed' }]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
  });
});

describe('installPendingUpdate', () => {
  it('invokes install_update and then relaunches', async () => {
    invoke.mockResolvedValueOnce(undefined);
    relaunch.mockResolvedValueOnce(undefined);
    await installPendingUpdate();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('install_update');
    expect(relaunch).toHaveBeenCalledExactlyOnceWith();
  });

  it('does not throw when relaunch rejects (Windows installer exits the app)', async () => {
    invoke.mockResolvedValueOnce(undefined);
    relaunch.mockRejectedValueOnce(new Error('process exiting'));
    await expect(installPendingUpdate()).resolves.toBeUndefined();
  });

  it('propagates an install failure so the UI can show the failed state', async () => {
    invoke.mockRejectedValueOnce(new Error('disk full'));
    await expect(installPendingUpdate()).rejects.toThrow('disk full');
    expect(relaunch).not.toHaveBeenCalled();
  });
});

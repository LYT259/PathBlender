import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashToSession, sessionToHash } from '../src/share-url';
import { makeSession, parseGhostAuto } from '@pathblender/core';

const SAMPLES = resolve(__dirname, '../../../samples');

describe('share-url round-trip', () => {
  it('compresses and restores a session through the URL hash', async () => {
    const text = readFileSync(resolve(SAMPLES, 'ghostauto/straight_run.ghostauto'), 'utf-8');
    const robots = [makeSession(parseGhostAuto(text, 'straight_run.ghostauto'))];
    const hash = await sessionToHash(robots, 'rebuilt-2026');
    expect(hash.startsWith('#s=')).toBe(true);
    // Compressed link stays comfortably within URL limits.
    expect(hash.length).toBeLessThan(2000);

    const restored = await hashToSession(hash);
    expect(restored).toBeDefined();
    expect(restored!.fieldId).toBe('rebuilt-2026');
    expect(restored!.robots).toHaveLength(1);
    expect(restored!.robots[0]!.trajectory.samples).toHaveLength(
      robots[0].trajectory.samples.length,
    );
  });

  it('rejects garbage hashes gracefully', async () => {
    expect(await hashToSession('#s=not-valid-base64!!!')).toBeUndefined();
    expect(await hashToSession('')).toBeUndefined();
  });
});

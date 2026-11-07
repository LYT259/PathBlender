/**
 * Task 7 .hoot gate: .hoot files must never reach the text parsers. Browsers
 * get the explicit desktop/Phoenix-Tuner notice instead of today's generic
 * parse error; on desktop the core probe decides between the converter queue
 * (Task 8 mounts its flow) and a specific rejection. All inputs here are
 * synthetic stubs — no real CTRE sample exists yet (plan, external
 * unverifiable #1).
 */
import { HOOT_COMPLIANCY_OFFSET } from '@pathblender/core';
import { describe, expect, it } from 'vitest';
import { routeHootFiles } from '../src/hoot/gate';

/** Synthetic .hoot stub: zero bytes with only the compliancy byte set. */
function hootStubFile(name: string, compliancy: number): File {
  const bytes = new Uint8Array(HOOT_COMPLIANCY_OFFSET + 1);
  bytes[HOOT_COMPLIANCY_OFFSET] = compliancy;
  return new File([bytes], name);
}

describe('routeHootFiles', () => {
  it('browsers get an explicit web-unsupported notice instead of a parse attempt', async () => {
    const routed = await routeHootFiles(
      [{ file: hootStubFile('Log.hoot', 9), relPath: 'deploy/Log.hoot' }],
      false,
    );
    expect(routed.desktopQueue).toEqual([]);
    expect(routed.errors).toEqual([{ relPath: 'deploy/Log.hoot', key: 'hoot.webUnsupported' }]);
  });

  it('leaves non-hoot files alone on the web', async () => {
    const routed = await routeHootFiles(
      [{ file: new File(['{}'], 'route.traj'), relPath: 'route.traj' }],
      false,
    );
    expect(routed.desktopQueue).toEqual([]);
    expect(routed.errors).toEqual([]);
  });

  it('desktop: compliancy below the supported floor is rejected as too old', async () => {
    const routed = await routeHootFiles(
      [{ file: hootStubFile('Log.hoot', 5), relPath: 'Log.hoot' }],
      true,
    );
    expect(routed.desktopQueue).toEqual([]);
    expect(routed.errors).toEqual([{ relPath: 'Log.hoot', key: 'hoot.tooOld', vars: { v: 5 } }]);
  });

  it('desktop: convertible stubs queue for the converter and bystanders are ignored', async () => {
    const file = hootStubFile('Log.hoot', 9);
    const routed = await routeHootFiles(
      [
        { file, relPath: 'deploy/Log.hoot' },
        { file: new File(['{}'], 'route.traj'), relPath: 'deploy/route.traj' },
      ],
      true,
    );
    expect(routed.desktopQueue).toEqual([{ file, relPath: 'deploy/Log.hoot' }]);
    expect(routed.errors).toEqual([]);
  });

  it('desktop: files too short to carry the compliancy byte are truncated', async () => {
    const routed = await routeHootFiles(
      [{ file: new File([new Uint8Array(8)], 'Log.hoot'), relPath: 'Log.hoot' }],
      true,
    );
    expect(routed.desktopQueue).toEqual([]);
    expect(routed.errors).toEqual([{ relPath: 'Log.hoot', key: 'hoot.truncated' }]);
  });

  it('routes a stem-less dotfile named .hoot like any hoot log', async () => {
    // Task 1 review note: the name check is /\.hoot$/i, which also matches
    // the bare dotfile. The gate must delegate to that check, not grow its
    // own stem rule — same treatment a dotfile .wpilog gets today.
    const routed = await routeHootFiles(
      [{ file: hootStubFile('.hoot', 9), relPath: '.hoot' }],
      false,
    );
    expect(routed.desktopQueue).toEqual([]);
    expect(routed.errors).toEqual([{ relPath: '.hoot', key: 'hoot.webUnsupported' }]);
  });
});

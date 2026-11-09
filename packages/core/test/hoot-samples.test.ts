/**
 * Real CTRE-converted WPILOG sample (local-only fixture, 2026-11-09).
 *
 * `sim_2025-02-27_16-16-47.hoot.wpilog` is a real owlet-style conversion
 * product (`.hoot` → `.hoot.wpilog`) posted publicly on Chief Delphi for
 * debugging — see samples/hoot/README.md for provenance, hashes and the
 * download command. Chief Delphi attachments carry no explicit license, so
 * the file is NOT committed: fetch it locally and this suite runs; without
 * it each test skips (same protocol as the wpilog large fixtures).
 *
 * What this validates: the production WPILOG pipeline parses a real
 * CTRE-converted log end to end. What it does NOT validate: the raw `.hoot`
 * container (still no legal sample — probe facts in parsers/hoot.ts remain
 * source-reading-verified only), owlet download/conversion (EULA-gated,
 * not executed), or any desktop conversion flow.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectWpilog } from '../src';

const SAMPLE_DIR = process.env.HOOT_SAMPLE_DIR
  ? resolve(process.env.HOOT_SAMPLE_DIR)
  : resolve(__dirname, '../../../samples/hoot');
const SAMPLE_FILE = 'sim_2025-02-27_16-16-47.hoot.wpilog';
const SAMPLE_SHA256 = 'b830e32bb1f7a516d5303046d731e4aa6184656b359877b8b362d76462073bcf';

function samplePath(): string | undefined {
  const path = resolve(SAMPLE_DIR, SAMPLE_FILE);
  return existsSync(path) ? path : undefined;
}

describe.skipIf(!samplePath())('real CTRE-converted WPILOG sample', () => {
  it('matches the recorded bytes (fixture pin)', () => {
    const path = samplePath()!;
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(sha, 'local sample differs from the recorded fixture — see samples/hoot/README.md').toBe(
      SAMPLE_SHA256,
    );
  });

  it('is a WPILOG container produced from hoot signals', () => {
    const bytes = new Uint8Array(readFileSync(samplePath()!));
    // Container magic + version 1.0 (major=0, minor=1) per the WPILOG spec.
    expect(Buffer.from(bytes.subarray(0, 6)).toString('ascii')).toBe('WPILOG');
    expect(bytes[6]).toBe(0);
    expect(bytes[7]).toBe(1);
  });

  it('parses through the production pipeline without corrupt-timestamp warnings', () => {
    const bytes = new Uint8Array(readFileSync(samplePath()!));
    const started = Date.now();
    const inspection = inspectWpilog(bytes, SAMPLE_FILE);
    const ms = Date.now() - started;
    expect(
      inspection.warnings.filter((w) => w.startsWith('corrupt timestamp')),
      'a real converted log must not produce corrupt-timestamp warnings',
    ).toEqual([]);
    expect(inspection.catalog.entries.length).toBeGreaterThan(0);
    // Smoke + honest reporting only: a SysId simulation log need not contain
    // pose candidates or auto intervals — counts go to the run log.
    console.log(
      `[hoot-sample] ${SAMPLE_FILE}: ${bytes.length} bytes, ` +
        `${inspection.catalog.entries.length} entries, ` +
        `${inspection.candidates.length} pose candidates, ` +
        `${inspection.autoIntervals.length} auto intervals in ${ms} ms`,
    );
  });
});

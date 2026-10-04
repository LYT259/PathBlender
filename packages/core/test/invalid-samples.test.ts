/**
 * Corrupt/negative sample regression: every parser must reject each file
 * with the right error kind and a user-actionable message — never crash
 * (AGENTS.md red line §3: external files are untrusted).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePathFile, parseTraj, ParseError } from '../src';
import type { ParseErrorKind } from '../src';

const INVALID = resolve(__dirname, '../../../samples/invalid');

interface Case {
  file: string;
  kind: ParseErrorKind;
  messageMatches?: RegExp;
}

const cases: Case[] = [
  { file: 'truncated.traj', kind: 'invalid-json' },
  { file: 'not_json.traj', kind: 'invalid-json' },
  {
    file: 'no_trajectory.traj',
    kind: 'missing-trajectory',
    messageMatches: /generate/i,
  },
  { file: 'empty_samples.traj', kind: 'empty-trajectory' },
  { file: 'no_states.ghostauto', kind: 'unrecognized-format' },
  { file: 'garbage_states.ghostauto', kind: 'empty-trajectory' },
  { file: 'unknown.json', kind: 'unrecognized-format' },
  {
    file: 'dangling_ref.auto',
    kind: 'unrecognized-format',
    messageMatches: /DoesNotExist/,
  },
];

describe('invalid samples (format drift / corruption guard)', () => {
  it.each(cases)('$file → $kind', ({ file, kind, messageMatches }) => {
    const text = readFileSync(resolve(INVALID, file), 'utf-8');
    let caught: unknown;
    try {
      parsePathFile(text, file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.kind).toBe(kind);
    expect(err.fileName).toBe(file);
    if (messageMatches) {
      expect(err.message).toMatch(messageMatches);
    }
  });

  it('garbage_states is rejected without throwing a non-ParseError', () => {
    const text = readFileSync(resolve(INVALID, 'garbage_states.ghostauto'), 'utf-8');
    // NaN/Infinity must never leak into a "successful" parse either.
    let result: unknown = 'no-throw';
    try {
      result = parsePathFile(text, 'garbage_states.ghostauto');
    } catch {
      // expected
    }
    expect(result).toBe('no-throw');
  });
});

describe('companion hints and traction headroom (§6.6, landed 2026-10-04)', () => {
  it('points at attachable profile files when a .traj carries no geometry', () => {
    const bare = JSON.stringify({
      version: 3, name: 'Bare',
      trajectory: { samples: [{ t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }, { t: 1, x: 2, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 }] },
    });
    const traj = parseTraj(bare, 'bare.traj');
    expect(traj.warnings.join(' ')).toContain('attach');
  });

  it('warns when module forces approach the traction limit', () => {
    const nearSlip = JSON.stringify({
      version: 3, name: 'Hot',
      trajectory: {
        config: { mass: 65, cof: 1.2, bumper: { front: 0.45, side: 0.45, back: 0.45 } },
        samples: [
          { t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0, fx: [200, 200, 200, 200], fy: [0, 0, 0, 0] },
          { t: 1, x: 2, y: 1, heading: 0, vx: 0, vy: 0, omega: 0, fx: [200, 200, 200, 200], fy: [0, 0, 0, 0] },
          { t: 2, x: 3, y: 1, heading: 0, vx: 0, vy: 0, omega: 0, fx: [10, 10, 10, 10], fy: [0, 0, 0, 0] },
        ],
      },
    });
    const traj = parseTraj(nearSlip, 'hot.traj');
    expect(traj.warnings.join(' ')).toContain('traction limit');
  });

  it('stays silent when forces are well under the limit', () => {
    const calm = JSON.stringify({
      version: 3, name: 'Calm',
      trajectory: {
        config: { mass: 65, cof: 1.2, bumper: { front: 0.45, side: 0.45, back: 0.45 } },
        samples: [
          { t: 0, x: 1, y: 1, heading: 0, vx: 0, vy: 0, omega: 0, fx: [20, 20, 20, 20], fy: [0, 0, 0, 0] },
          { t: 1, x: 2, y: 1, heading: 0, vx: 0, vy: 0, omega: 0 },
        ],
      },
    });
    expect(parseTraj(calm, 'calm.traj').warnings.join(' ')).not.toContain('traction limit');
  });
});

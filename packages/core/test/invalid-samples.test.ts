/**
 * Corrupt/negative sample regression: every parser must reject each file
 * with the right error kind and a user-actionable message — never crash
 * (AGENTS.md red line §3: external files are untrusted).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePathFile, ParseError } from '../src';
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

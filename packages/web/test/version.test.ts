/**
 * Version scheme arithmetic (0.1.4-beta.N → 0.1.4; user directive
 * 2026-10-01). The bump script and the About display both go through these
 * functions — the script re-implements nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatVersionDisplay,
  nextBetaVersion,
  parseVersion,
  releaseVersion,
} from '../src/version';
import { APP_VERSION } from '../src/version-info';

describe('version arithmetic', () => {
  it('parses cores and beta suffixes, rejects anything else', () => {
    expect(parseVersion('0.1.4')).toEqual({ core: '0.1.4', prerelease: null });
    expect(parseVersion('0.1.4-beta.2')).toEqual({ core: '0.1.4', prerelease: 'beta.2' });
    // Build metadata is banned on purpose: semver ignores it in precedence,
    // which would break update offers (see version.ts header).
    expect(parseVersion('0.1.4+5')).toBeNull();
    expect(parseVersion('0.1.4-dev.1')).toBeNull();
    expect(parseVersion('v0.1.4')).toBeNull();
  });

  it('allocates the next beta number; a release starts a new cycle', () => {
    expect(nextBetaVersion('0.1.3')).toBe('0.1.4-beta.1');
    expect(nextBetaVersion('0.1.4-beta.1')).toBe('0.1.4-beta.2');
    expect(nextBetaVersion('0.1.4-beta.9')).toBe('0.1.4-beta.10');
    expect(nextBetaVersion('0.2.0-beta.3')).toBe('0.2.0-beta.4');
  });

  it('promotes only a suffixed version, keeping the core', () => {
    expect(releaseVersion('0.1.4-beta.7')).toBe('0.1.4');
    expect(() => releaseVersion('0.1.4')).toThrow(/nothing to promote/);
  });

  it('renders the natural display form', () => {
    expect(formatVersionDisplay('0.1.4-beta.2')).toBe('0.1.4 · Beta 2');
    expect(formatVersionDisplay('0.1.4')).toBe('0.1.4');
  });

  it('the generated APP_VERSION matches the manifests (check-version parity)', () => {
    const root = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    expect(APP_VERSION).toBe(root.version);
    expect(parseVersion(APP_VERSION)).not.toBeNull();
  });
});

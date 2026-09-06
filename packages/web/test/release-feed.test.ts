/**
 * Release feed pipeline: tag→channel derivation (the single decision the
 * workflow relies on for feed filename + --prerelease) and the
 * gen-latest-json feed generator itself, exercised as a real subprocess
 * against fixture bundle directories — the same way CI invokes it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveReleaseChannel } from '../../../scripts/release-channel.mjs';

const GEN = resolve(__dirname, '../../../scripts/gen-latest-json.mjs');

/** Build a minimal bundle dir shaped like tauri's bundle output. */
function makeBundle(withSig = true, notes = false): string {
  const root = mkdtempSync(join(tmpdir(), 'pb-feed-'));
  const macos = join(root, 'macos');
  mkdirSync(macos, { recursive: true });
  writeFileSync(join(macos, 'PathBlender.app.tar.gz'), 'fake-app-tarball');
  if (withSig) writeFileSync(join(macos, 'PathBlender.app.tar.gz.sig'), 'sig-bytes\n');
  if (notes) writeFileSync(join(root, 'RELEASE_NOTES.md'), '  Custom notes here.  ');
  return root;
}

function runGen(version: string, root: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [GEN, version, root], { encoding: 'utf-8' });
    return { stdout, status: 0 };
  } catch (e) {
    return { stdout: String((e as { stdout?: string }).stdout ?? ''), status: 1 };
  }
}

describe('deriveReleaseChannel (tag routing)', () => {
  it.each([
    ['v0.1.0', 'stable'],
    ['v1.2.3', 'stable'],
    ['v0.2.0-beta.1', 'beta'],
    ['v0.2.0-beta', 'beta'],
    ['v0.2.0-Beta.2', 'beta'],
    ['v1.0.0-rc.1', 'beta'],
    ['v1.0.0-alpha', 'beta'],
  ])('%s → %s', (tag, expected) => {
    expect(deriveReleaseChannel(tag)).toBe(expected);
  });

  it('does not trip on hyphenated non-prerelease tags', () => {
    expect(deriveReleaseChannel('v0.1.0-hotfix')).toBe('stable');
  });
});

describe('gen-latest-json feed shape', () => {
  it('emits the darwin-aarch64 entry with a trimmed signature and asset URL', () => {
    const { stdout, status } = runGen('0.2.0', makeBundle());
    expect(status).toBe(0);
    const feed = JSON.parse(stdout);
    expect(feed.version).toBe('0.2.0');
    expect(feed.platforms['darwin-aarch64'].signature).toBe('sig-bytes');
    expect(feed.platforms['darwin-aarch64'].url).toBe(
      'https://github.com/GH-FRC/pathblender/releases/download/v0.2.0/PathBlender.app.tar.gz',
    );
    expect(feed.notes).not.toContain('Beta channel build');
  });

  it('flags prerelease versions in the notes (beta tag feeds)', () => {
    const { stdout } = runGen('0.2.0-beta.1', makeBundle());
    expect(JSON.parse(stdout).notes).toContain('Beta channel build');
  });

  it('uses RELEASE_NOTES.md when the bundle ships one', () => {
    const { stdout } = runGen('0.2.0', makeBundle(true, true));
    expect(JSON.parse(stdout).notes).toBe('Custom notes here.');
  });

  it('drops a platform whose .sig is missing, and fails the run when none survive', () => {
    const missing = runGen('0.2.0', makeBundle(false));
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toBe('');
  });

  it('writes only to stdout — no latest-beta.json side-effect file in cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pb-feed-cwd-'));
    try {
      execFileSync('node', [GEN, '0.2.0-beta.1', makeBundle()], { cwd, encoding: 'utf-8' });
      expect(existsSync(join(cwd, 'latest-beta.json'))).toBe(false);
      expect(existsSync(join(cwd, 'latest.json'))).toBe(false);
    } finally {
      // fixtures are disposable; nothing to clean beyond tmpdir's own sweep
    }
  });
});

describe('stable raises beta (workflow routing contract)', () => {
  it('a stable version and its beta twin differ only in the prerelease note', () => {
    const stable = JSON.parse(runGen('0.2.0', makeBundle(true, true)).stdout);
    const beta = JSON.parse(runGen('0.2.0-beta.1', makeBundle(true, true)).stdout);
    expect(stable.notes).toBe('Custom notes here.');
    expect(beta.notes).toContain('Beta channel build');
    // Same signed artifact; only the URL's version segment differs (the
    // workflow publishes the file under the right feed name(s)).
    expect(beta.platforms['darwin-aarch64'].signature).toBe(
      stable.platforms['darwin-aarch64'].signature,
    );
    expect(beta.platforms['darwin-aarch64'].url).toContain('/v0.2.0-beta.1/');
    expect(stable.platforms['darwin-aarch64'].url).toContain('/v0.2.0/');
  });
});

/**
 * release-notes-for.mjs — the single source of user-facing release notes
 * (GitHub Release body + updater feed notes, derived from the About-page
 * VERSION_NOTES registry). Exercised as a real subprocess against a fixture
 * registry, plus one consistency check against the REAL generated file: the
 * version the tree is about to ship must always have a resolvable notes
 * entry (a beta bump without a note must fail here, not at tag time).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../../scripts/release-notes-for.mjs');
const REAL_VERSION_INFO = resolve(__dirname, '../src/version-info.ts');

/** Fixture registry shaped exactly like the generated version-info.ts. */
function fixtureRegistry(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pb-notes-'));
  const file = join(dir, 'version-info.ts');
  writeFileSync(
    file,
    `export const APP_VERSION = '0.2.0';

export interface VersionNote {
  version: string;
  date: string;
  note: Partial<Record<string, string>> & { en: string };
}

export const VERSION_NOTES: VersionNote[] = [
  { version: '0.2.0', date: '2026.10.03', note: { en: 'Stable release with everything since 0.1.5', zh: '正式版：汇集 0.1.5 以来全部改进' } },
  { version: '0.2.0-beta.2', date: '2026.10.02', note: { en: "Fix 'quotes' in notes", zh: '引号转义' } },
  { version: '0.2.0-beta.1', date: '2026.10.01', note: { en: 'First beta', zh: '首个 beta' } },
  { version: '0.1.5', date: '2026.10.02', note: { en: '' } },
];
`,
  );
  return file;
}

function run(version: string, registry?: string, env: Record<string, string> = {}): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [SCRIPT, version, ...(registry ? [registry] : [])], {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { stdout: `${err.stdout ?? ''}${err.stderr ?? ''}`, status: 1 };
  }
}

describe('release-notes-for.mjs', () => {
  it('a beta version prints exactly its own note', () => {
    const out = run('0.2.0-beta.2', fixtureRegistry());
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Fix 'quotes' in notes / 引号转义");
    expect(out.stdout).not.toContain('First beta');
    expect(out.stdout).not.toContain('Stable release with everything');
  });

  it('a stable version aggregates every note since the previous stable', () => {
    const out = run('0.2.0', fixtureRegistry());
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('Stable release with everything since 0.1.5');
    expect(out.stdout).toContain('First beta');
    expect(out.stdout).toContain("Fix 'quotes' in notes");
    // 0.1.5 is the previous stable boundary — nothing from it or older may appear
    expect(out.stdout).not.toMatch(/- v0\.1\.5 /);
  });

  it('fails loudly for a beta version with no registry entry', () => {
    const out = run('0.2.0-beta.9', fixtureRegistry());
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('no VERSION_NOTES entry');
  });

  it('always carries the platform/download, known-issues and update sections', () => {
    const out = run('0.2.0-beta.2', fixtureRegistry(), { PB_KNOWN_ISSUES: fixtureKnownIssues() });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('## Platforms & download');
    expect(out.stdout).toContain('PathBlender_0.2.0-beta.2_aarch64.dmg');
    expect(out.stdout).toContain('## Known issues & limitations');
    expect(out.stdout).toContain('KEEPOUT zone stale in v9');
    expect(out.stdout).not.toContain('Maintenance note');
    // no doubled section heading from the embedded file's own H1
    expect(out.stdout.match(/Known issues & limitations/g)).toHaveLength(1);
    expect(out.stdout).toContain('## How to update');
    expect(out.stdout).toContain('Check for Updates');
  });

  it('the real registry resolves notes for the version this tree ships', () => {
    // The About-page contract: whatever APP_VERSION the tree carries must be
    // able to produce release notes (beta needs its own entry).
    const ts = execFileSync('node', ['-e', `console.log(require('fs').readFileSync(${JSON.stringify(REAL_VERSION_INFO)},'utf8'))`], { encoding: 'utf8' });
    const m = /APP_VERSION = '([^']+)'/.exec(ts);
    expect(m).not.toBeNull();
    const out = run(m![1]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("## What's new");
  });
});

function fixtureKnownIssues(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pb-ki-'));
  const file = join(dir, 'known-issues.md');
  writeFileSync(
    file,
    '# Known issues & limitations / 已知问题与限制\n\n> Maintenance note: internal guidance that must NOT appear in release bodies.\n\n- KEEPOUT zone stale in v9 (fixture)\n',
  );
  return file;
}

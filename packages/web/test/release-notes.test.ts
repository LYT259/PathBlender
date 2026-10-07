/**
 * release-notes-for.mjs — the single source of user-facing release notes
 * (GitHub Release body + updater feed notes, derived from the About-page
 * VERSION_NOTES registry). Exercised as a real subprocess against a fixture
 * registry, plus one consistency check against the REAL generated file: the
 * version the tree is about to ship must always have a resolvable notes
 * entry (a beta bump without a note must fail here, not at tag time).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  { version: '0.2.0', date: '2026.10.03', note: { en: 'Stable release with everything since 0.1.5', zh: '正式版：汇集 0.1.5 以来全部改进', es: 'Versión estable con todo desde 0.1.5', fr: 'Version stable avec tout depuis 0.1.5', tr: '0.1.5’ten beri her şeyi içeren kararlı sürüm', 'pt-br': 'Versão estável com tudo desde 0.1.5', he: 'גרסה יציבה עם הכל מאז 0.1.5' } },
  { version: '0.2.0-beta.2', date: '2026.10.02', note: { en: "Fix 'quotes' in notes", zh: '引号转义', es: 'Corregir comillas en las notas', fr: 'Corriger les guillemets dans les notes', tr: 'Notlardaki tırnak işaretlerini düzelt', 'pt-br': 'Corrigir aspas nas notas', he: 'תיקון מרכאות בהערות' } },
  { version: '0.2.0-beta.1', date: '2026.10.01', note: { en: 'First beta', zh: '首个 beta', es: 'Primera beta', fr: 'Première bêta', tr: 'İlk beta', 'pt-br': 'Primeiro beta', he: 'בטא ראשונה' } },
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
    expect(out.stdout).toContain("Fix 'quotes' in notes");
    expect(out.stdout).toContain("引号转义");
    expect(out.stdout).toContain("<summary>简体中文</summary>");
    expect(out.stdout).toContain("<summary>繁體中文（中國香港）</summary>");
    // The five extra public-facing locales (2026-10-07) fold in after Chinese;
    // a beta prints its own note in each of them, outside the English lead.
    expect(out.stdout).toContain("<summary>Español</summary>");
    expect(out.stdout).toContain("<summary>Türkçe</summary>");
    expect(out.stdout).toContain("<summary>עברית</summary>");
    expect(out.stdout).toContain('Corriger les guillemets dans les notes');
    expect(out.stdout).toContain('Notlardaki tırnak işaretlerini düzelt');
    expect(out.stdout.slice(0, out.stdout.indexOf("<details>"))).not.toContain('Corriger les guillemets');
    expect(out.stdout.slice(0, out.stdout.indexOf("<details>"))).not.toContain("引号转义");
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

  it('generating a historical stable release excludes notes from future releases', () => {
    const registry = fixtureRegistry();
    writeFileSync(registry, readFileSync(registry, 'utf8').replace('export const VERSION_NOTES: VersionNote[] = [', "export const VERSION_NOTES: VersionNote[] = [\n  { version: '0.3.0-beta.1', date: '2026.10.07', note: { en: 'Future capability', zh: '未来功能' } },"));
    const out = run('0.2.0', registry);
    expect(out.status).toBe(0);
    expect(out.stdout).not.toContain('Future capability');
    expect(out.stdout).not.toContain('未来功能');
    expect(out.stdout).toContain('First beta');
  });

  it('rejects an artifact manifest from a different release', () => {
    const manifest = join(mkdtempSync(join(tmpdir(), 'pb-notes-manifest-')), 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ version: '0.1.9' }));
    const out = run('0.2.0', fixtureRegistry(), { PB_RELEASE_ARTIFACTS: manifest });
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('manifest version mismatch');
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
    // In-process read: the registry grew past 1 MB with 40-language notes
    // (2026-10-07), which overflows a child-process stdout buffer.
    const ts = readFileSync(REAL_VERSION_INFO, 'utf8');
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

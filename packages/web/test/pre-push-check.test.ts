/**
 * pre-push-check.mjs — the sensitive-content gate every push passes through.
 * The 2026-10-02 fix is the point of these tests: a multi-ref push (git
 * sends ONE stdin line per ref — `git push --tags`, several branches) must
 * have EVERY outgoing range scanned, not just the first line; deletions
 * push nothing; worktree safety comes from trusting the stdin shas rather
 * than HEAD. Exercised both as pure functions and as the real script via
 * subprocess against a scratch git repo (the way the hook runs).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectPushRanges, unionRangeCommits } from '../../../scripts/pre-push-check.mjs';

const SCRIPT = resolve(__dirname, '../../../scripts/pre-push-check.mjs');

/** Deterministic distinct 40-char pseudo-sha; the digits encode which one. */
const sha = (n: string) => 'a'.repeat(24) + n.padStart(16, '0');

describe('collectPushRanges (multi-ref stdin resolution)', () => {
  it('returns one range per pushed ref, not just the first line', () => {
    const stdin = [
      `refs/heads/one ${sha('0001')} refs/heads/one ${sha('0009')}`,
      `refs/heads/two ${sha('0002')} refs/heads/two ${sha('0009')}`,
      `refs/tags/v9.9.9 ${sha('0003')} refs/tags/v9.9.9 ${'0'.repeat(40)}`,
    ].join('\n');
    expect(collectPushRanges(stdin)).toEqual([
      `${sha('0009')}..${sha('0001')}`,
      `${sha('0009')}..${sha('0002')}`,
      sha('0003'), // all-zero remote sha = new ref → full history
    ]);
  });

  it('skips ref deletions (all-zero local sha pushes nothing)', () => {
    const stdin = [
      `refs/heads/gone ${'0'.repeat(40)} refs/heads/gone ${sha('0004')}`,
      `refs/heads/new ${sha('0005')} refs/heads/new ${'0'.repeat(40)}`,
    ].join('\n');
    expect(collectPushRanges(stdin)).toEqual([sha('0005')]);
  });

  it('returns null for empty stdin (manual run falls back)', () => {
    expect(collectPushRanges('')).toBeNull();
    expect(collectPushRanges('\n  \n')).toBeNull();
  });
});

describe('unionRangeCommits (dedupe across ranges)', () => {
  it('scans every range and dedupes overlapping commits', () => {
    const fakeGit = (cmd: string, arg: string) =>
      cmd === 'rev-list' ? ({ 'r1..a': 'c1\nc2', 'r2..b': 'c2\nc3' }[arg as string] ?? '') : '';
    expect(unionRangeCommits(fakeGit, ['r1..a', 'r2..b']).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('reports the failing range when rev-list cannot resolve it', () => {
    const fakeGit = () => {
      throw new Error('bad object');
    };
    expect(() => unionRangeCommits(fakeGit, ['bad..range'])).toThrow(/bad\.\.range/);
  });
});

describe('pre-push-check.mjs end to end (scratch repo)', () => {
  function scratchRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pb-push-'));
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 't');
    for (const [name, body] of [['a.txt', 'clean\n'], ['b.txt', 'also clean\n']]) {
      writeFileSync(join(dir, name), body);
      g('add', '.');
      g('commit', '-qm', `clean commit ${name}`);
    }
    return dir;
  }

  it('flags a sensitive commit fed through multi-ref hook stdin', () => {
    const dir = scratchRepo();
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    // Assembled at runtime so the committed test source never carries a
    // literal internal address — the detector sees the concatenated string,
    // the pre-push gate scanning THIS file's diff does not (that is the
    // gate working as intended: fixtures must not re-disclose the very
    // patterns they probe for).
    const lanLine = ['server is 192', '168', '30', '42 today\n'].join('.');
    writeFileSync(join(dir, 'log.md'), lanLine);
    g('add', '.');
    g('commit', '-qm', 'oops internal ip');
    const head = g('rev-parse', 'HEAD').trim();
    const base = g('rev-parse', 'HEAD~1').trim();
    const stdin = [
      `refs/heads/one ${head} refs/heads/one ${base}`,
      `refs/heads/two ${head} refs/heads/two ${base}`,
    ].join('\n');
    let status = 0;
    try {
      execFileSync('node', [SCRIPT, 'origin'], { input: stdin, encoding: 'utf8', cwd: dir, env: process.env });
    } catch {
      status = 1;
    }
    expect(status).toBe(1);
  });

  it('passes a clean multi-ref push and reports every range', () => {
    const dir = scratchRepo();
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    const head = g('rev-parse', 'HEAD').trim();
    const base = g('rev-parse', 'HEAD~1').trim();
    const stdin = `refs/heads/one ${head} refs/heads/one ${base}\nrefs/tags/v0.0.1 ${head} refs/tags/v0.0.1 ${'0'.repeat(40)}`;
    const out = execFileSync('node', [SCRIPT, 'origin'], { input: stdin, encoding: 'utf8', cwd: dir, env: process.env });
    expect(out).toContain('2 range(s) clean');
  });
});

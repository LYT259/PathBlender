/**
 * worktree-status / new-worktree contract + behavior tests.
 *
 * worktree-status --prune is a deletion tool, so the guard logic gets a real
 * fixture repo, not just string checks: only a worktree whose tree is clean
 * AND whose branch is fully merged into beta may ever be removed — dirty and
 * unmerged worktrees (possibly other sessions' WIP) must survive untouched.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const STATUS_SCRIPT = resolve(ROOT, 'scripts/worktree-status.mjs');
const NEW_SCRIPT = resolve(ROOT, 'scripts/new-worktree.sh');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env: GIT_ENV });
}

function runScript(cwd: string, script: string, ...args: string[]) {
  return execFileSync('node', [script, ...args], { cwd, encoding: 'utf-8', env: GIT_ENV });
}

describe('worktree-status.mjs static contract', () => {
  const script = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(STATUS_SCRIPT)}, 'utf-8'))`], { encoding: 'utf-8' });

  it('prunes only fully merged + clean worktrees — both guards stated', () => {
    expect(script).toContain("'fully merged into beta, tree clean'");
    expect(script).toContain('uncommitted changes: ');
    expect(script).toContain('commit(s) not merged into');
  });

  it('codex-session worktrees are never auto-pruned (their sessions resume later)', () => {
    expect(script).toContain("'/.codex/worktrees/'");
    expect(script).toContain('never auto-pruned');
  });

  it('never force-removes a worktree and never hard-deletes a branch', () => {
    expect(script).toContain("['worktree', 'remove', item.path]");
    expect(script).not.toContain('--force');
    expect(script).toContain("['branch', '-d', item.branch]");
    expect(script).not.toContain("'-D'");
  });
});

describe('new-worktree.sh static contract', () => {
  const script = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(NEW_SCRIPT)}, 'utf-8'))`], { encoding: 'utf-8' });

  it('fails fast and refuses to overwrite an existing branch or path', () => {
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('refs/heads/$BRANCH');
    expect(script).toContain('path already exists');
  });

  it('clones dependencies with APFS clonefile and a plain-copy fallback', () => {
    expect(script).toContain('cp -Rc "$src" "$dst"');
    expect(script).toContain('cp -R "$src" "$dst"');
  });

  it('copies the 18G cargo target only behind --with-target', () => {
    expect(script).toMatch(/--with-target/);
    expect(script).toContain('skipping src-tauri/target');
  });
});

describe('worktree-status.mjs behavior against a fixture repo', () => {
  let fixture: string;
  let mergedPath: string;
  let unmergedPath: string;
  let dirtyPath: string;

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'pb-wt-status-'));
    git(fixture, 'init');
    git(fixture, 'config', 'user.email', 'test@example.com');
    git(fixture, 'config', 'user.name', 'test');
    writeFileSync(join(fixture, 'a.txt'), 'a\n');
    git(fixture, 'add', '.');
    git(fixture, 'commit', '-m', 'c1');
    git(fixture, 'branch', '-m', 'beta');
    writeFileSync(join(fixture, 'b.txt'), 'b\n');
    git(fixture, 'add', '.');
    git(fixture, 'commit', '-m', 'c2');

    // merged-fix: commit in its worktree, then merged into beta — clean & fully merged.
    mergedPath = join(fixture, 'merged-fix');
    git(fixture, 'worktree', 'add', '-b', 'merged-fix', mergedPath);
    writeFileSync(join(mergedPath, 'c.txt'), 'c\n');
    git(mergedPath, 'add', '.');
    git(mergedPath, 'commit', '-m', 'fix merged later');
    git(fixture, 'merge', '--no-edit', 'merged-fix');

    // unmerged-docs: committed work that beta does not have — clean but unmerged.
    unmergedPath = join(fixture, 'unmerged-docs');
    git(fixture, 'worktree', 'add', '-b', 'unmerged-docs', unmergedPath);
    writeFileSync(join(unmergedPath, 'd.txt'), 'd\n');
    git(unmergedPath, 'add', '.');
    git(unmergedPath, 'commit', '-m', 'docs not merged yet');

    // wip-feature: uncommitted changes in the worktree — the guard must keep it.
    dirtyPath = join(fixture, 'wip-feature');
    git(fixture, 'worktree', 'add', '-b', 'wip-feature', dirtyPath);
    writeFileSync(join(dirtyPath, 'wip.txt'), 'wip\n');
  });

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it('report marks main tree, dirty, unmerged and merged+clean correctly', () => {
    const out = runScript(fixture, STATUS_SCRIPT);
    const lineFor = (needle: string) =>
      out.split('\n').find((l) => l.includes(needle)) ?? '';
    expect(lineFor('PRUNE')).toContain('merged-fix');
    expect(lineFor('merged-fix')).toContain('fully merged into beta, tree clean');
    expect(lineFor('wip-feature')).toContain('uncommitted changes: 1');
    expect(lineFor('unmerged-docs')).toContain('not merged into beta');
    expect(lineFor('MAIN')).toContain('main tree');
  });

  it('--prune removes only the merged+clean worktree and its branch, keeps WIP intact', () => {
    const out = runScript(fixture, STATUS_SCRIPT, '--prune');
    expect(out).toContain('Pruned 1 of 1');

    expect(existsSync(mergedPath)).toBe(false);
    expect(git(fixture, 'branch', '--list', 'merged-fix')).toBe('');

    // Unfinished work survives: dirs, branches and the uncommitted file.
    expect(existsSync(unmergedPath)).toBe(true);
    expect(existsSync(dirtyPath)).toBe(true);
    expect(existsSync(join(dirtyPath, 'wip.txt'))).toBe(true);
    expect(git(fixture, 'branch', '--list', 'unmerged-docs')).not.toBe('');
    expect(git(fixture, 'branch', '--list', 'wip-feature')).not.toBe('');

    const out2 = runScript(fixture, STATUS_SCRIPT);
    expect(out2).toContain('0 pruneable');
    expect(out2).toContain('unmerged-docs');
    expect(out2).toContain('wip-feature');

    // Pruning again is a no-op.
    const out3 = runScript(fixture, STATUS_SCRIPT, '--prune');
    expect(out3).toContain('Nothing to prune.');
  });
});

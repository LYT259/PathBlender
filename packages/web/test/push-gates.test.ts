/**
 * Push-gate behavior tests from the 2026-10-02 acceptance audit:
 * 1. pre-push-check must BLOCK the push when a commit cannot be read —
 *    the old `continue` skipped such commits and reported "clean"
 *    (reproduced with a stub git whose `show` fails).
 * 2. install-hooks.sh must work inside a worktree (`.git` is a file
 *    there), and must fail loudly instead of printing "installed" when
 *    the write fails.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const CHECK = resolve(ROOT, 'scripts/pre-push-check.mjs');
const INSTALL = resolve(ROOT, 'scripts/install-hooks.sh');

function run(cmd: string, args: string[], opts: Record<string, unknown> = {}): { out: string; code: number } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', ...(opts as object) }) as string;
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
  }
}

describe('pre-push-check: unreadable commits block the push', () => {
  function stubGitDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pb-stub-'));
    mkdirSync(join(dir, 'bin'));
    // rev-list returns one commit; rev-parse (upstream) succeeds; show FAILS —
    // the acceptance audit's reproduction of an unreadable commit.
    writeFileSync(
      join(dir, 'bin/git'),
      `#!/bin/sh
case "$1" in
  rev-list) echo 1111111111111111111111111111111111111111; exit 0 ;;
  rev-parse) echo 2222222222222222222222222222222222222222; exit 0 ;;
  show) echo "fatal: bad object" >&2; exit 128 ;;
  *) exit 0 ;;
esac
`,
    );
    execFileSync('chmod', ['+x', join(dir, 'bin/git')]);
    return dir;
  }

  it('exits 1 with a clear reason when git show fails on an outgoing commit', () => {
    const stub = stubGitDir();
    const res = run('node', [CHECK], {
      env: { ...process.env, PATH: `${join(stub, 'bin')}:${process.env.PATH}` },
    });
    expect(res.code).toBe(1);
    expect(res.out).toContain('cannot read commit');
    expect(res.out).toContain('refusing to clear it');
    rmSync(stub, { recursive: true, force: true });
  });
});

describe('install-hooks.sh (worktree-compatible)', () => {
  // The live run needs zsh (the script's interpreter) — present on the
  // dev machines (macOS), ABSENT on the Linux CI runner. There the test
  // falls back to the static contract (first caught by the v0.1.6-beta.35
  // tag run: `zsh INSTALL` exited ENOENT and killed the release checks).
  const hasZsh = run('which', ['zsh']).code === 0;
  const script = readFileSync(INSTALL, 'utf8');

  (hasZsh ? it : it.skip)(
    'installs into the shared hooks dir and survives being run from a worktree',
    () => {
      // This test itself runs from a worktree checkout — the exact context
      // where the old script wrote to `.git/hooks/` (a FILE) and failed
      // silently.
      const res = run('zsh', [INSTALL]);
      expect(res.code).toBe(0);
      const hooksDir = run('git', ['rev-parse', '--git-path', 'hooks']).out.trim();
      // resolve() handles both relative (".git/hooks") and absolute forms
      const hook = resolve(ROOT, hooksDir) + '/pre-push';
      expect(existsSync(hook)).toBe(true);
      const hookSrc = readFileSync(hook, 'utf8');
      // The hook resolves the script from the pushing worktree's root at
      // run time — one shared hook serves every worktree.
      expect(hookSrc).toContain('$PWD/scripts/pre-push-check.mjs');
    },
  );

  it('static contract (everywhere): git-resolved hooks dir, fail-fast, cwd-based hook', () => {
    expect(script).toContain('git rev-parse --git-path hooks');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('$PWD/scripts/pre-push-check.mjs');
    // the literal-path write that failed in worktrees must be gone
    expect(script).not.toContain('>.git/hooks');
  });
});

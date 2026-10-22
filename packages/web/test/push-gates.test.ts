/**
 * Push-gate infrastructure tests (2026-10-02 audit origin, 2026-10-22
 * rewrite): install-hooks.sh must work inside a worktree (`.git` is a FILE
 * there — the old script wrote to `.git/hooks/...` and failed silently),
 * must wire the hook to the MAIN tree's checker so every worktree of the
 * repository runs the same gate version and the same SHARED private rules,
 * and must surface a NOT READY state (non-zero exit) instead of printing
 * "installed" and exiting 0 when the private rules are not usable yet.
 *
 * All live runs happen in scratch repositories (a copy of the real scripts
 * committed into the scratch history, plus a linked worktree) — nothing
 * installs into the real repository's hooks dir from the test suite.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const CHECK = resolve(ROOT, 'scripts/pre-push-check.mjs');
const INSTALL = resolve(ROOT, 'scripts/install-hooks.sh');

const GITENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

function run(cmd: string, args: string[], opts: Record<string, unknown> = {}): { out: string; code: number } {
  // Combine stdout+stderr in BOTH branches: doctor reports print to stderr,
  // and a success-exit run still carries them.
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...(opts as object) });
  return { out: `${res.stdout ?? ''}${res.stderr ?? ''}`, code: res.status ?? 1 };
}

function scratchWithScripts(): { dir: string; g(...args: string[]): string; clean(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'pb-install-'));
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: GITENV }).trim();
  g('init', '-q');
  g('config', 'user.email', ['12345+testself', 'users.noreply.github.com'].join('@'));
  g('config', 'user.name', 'Test Self');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(CHECK, join(dir, 'scripts', 'pre-push-check.mjs'));
  copyFileSync(INSTALL, join(dir, 'scripts', 'install-hooks.sh'));
  g('add', 'scripts');
  g('commit', '-qm', 'checker scripts');
  return {
    dir,
    g,
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// The live run needs zsh (the installer's interpreter) — present on the dev
// machines (macOS), absent on the Linux CI runner. There the suite falls
// back to the static contract (first caught by the v0.1.6-beta.35 tag run:
// `zsh INSTALL` exited ENOENT and killed the release checks).
const hasZsh = run('which', ['zsh']).code === 0;
const script = readFileSync(INSTALL, 'utf8');

describe('install-hooks.sh (static contract, everywhere)', () => {
  it('resolves the hooks dir through git, fails fast, ends with a readiness check', () => {
    expect(script).toContain('git rev-parse --git-path hooks');
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('pre-push-check.mjs');
    expect(script).toContain('--install-rules');
    expect(script).toContain('--doctor');
    // the literal-path write that failed in worktrees must stay gone
    expect(script).not.toContain('>.git/hooks');
  });

  it('wires the hook to the MAIN tree checker with a worktree fallback', () => {
    expect(script).toContain('git-common-dir');
    expect(script).toContain('git rev-parse --git-common-dir');
    // refuses (never silently passes) when neither copy exists
    expect(script).toContain('push refused');
  });
});

describe('install-hooks.sh (live, needs zsh)', () => {
  (hasZsh ? it : it.skip)('installs the shared hook, reports NOT READY on a fresh skeleton, READY once rules are filled', () => {
    const s = scratchWithScripts();
    try {
      // Run from a linked WORKTREE of the scratch repo — the exact context
      // where the old script wrote into a `.git` FILE and still said ok.
      const wt = join(s.dir, '..', `pb-install-wt-${Date.now()}`);
      s.g('worktree', 'add', '-q', wt, '-b', 'wt-branch');
      try {
        const res = run('zsh', [join(wt, 'scripts', 'install-hooks.sh')], { env: GITENV });
        expect(res.code).toBe(1); // hook + skeleton installed, but NOT READY
        expect(res.out).toContain('pre-push hook installed');
        expect(res.out).toContain('NOT READY');
        const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
          cwd: s.dir,
          encoding: 'utf8',
          env: GITENV,
        }).trim();
        const hook = resolve(s.dir, hooksDir, 'pre-push');
        expect(existsSync(hook)).toBe(true);
        const hookSrc = readFileSync(hook, 'utf8');
        expect(hookSrc).toContain('git-common-dir'); // main-tree resolution

        // The REAL hook, executed from the worktree, applies the shared
        // rules from the common git dir (fictitious values, runtime-built).
        const rules = join(s.dir, '.git', 'info', 'pathblender-privacy-rules');
        const fakeEmail = ['fake.person', 'example.invalid'].join('@');
        writeFileSync(
          rules,
          [
            '[forbidden]',
            ['fake\\.person', 'example\\.invalid'].join('@'),
            '[forbidden-paths]',
            '[self-names]',
            'Test Self',
            '[self-emails]',
            ['12345+testself', 'users.noreply.github.com'].join('@'),
          ].join('\n') + '\n',
        );
        chmodSync(rules, 0o600);
        const doctor = run('zsh', [join(wt, 'scripts', 'install-hooks.sh')], { env: GITENV });
        expect(doctor.code).toBe(0);
        expect(doctor.out).toContain('READY');

        writeFileSync(join(wt, 'dirty.txt'), `secret ${fakeEmail}\n`);
        execFileSync('git', ['add', '--', 'dirty.txt'], { cwd: wt, encoding: 'utf8', env: GITENV });
        execFileSync('git', ['commit', '-qm', 'dirty'], { cwd: wt, encoding: 'utf8', env: GITENV });
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8', env: GITENV }).trim();
        const hookRun = run(hook, ['origin'], {
          cwd: wt,
          env: GITENV,
          input: `refs/heads/wt-branch ${head} refs/heads/wt-branch ${'0'.repeat(40)}\n`,
        });
        expect(hookRun.code).toBe(1); // the hook itself blocked the dirty push
        expect(hookRun.out).toContain('content/forbidden');
        expect(hookRun.out).not.toContain(fakeEmail);
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    } finally {
      s.clean();
    }
  });
});

describe('pre-push-check: unreadable inputs block (no stub-gits needed)', () => {
  it('exits non-zero when the checker cannot even resolve the repository (stub-PATH scenario)', () => {
    const stub = mkdtempSync(join(tmpdir(), 'pb-stub-'));
    try {
      mkdirSync(join(stub, 'bin'));
      writeFileSync(
        join(stub, 'bin', 'git'),
        '#!/bin/sh\nexit 128\n',
      );
      execFileSync('chmod', ['+x', join(stub, 'bin', 'git')]);
      const res = run('node', [CHECK], {
        env: { ...GITENV, PATH: `${join(stub, 'bin')}:${process.env.PATH}` },
      });
      expect(res.code).toBe(2); // CANNOT CONCLUDE, never "clean"
      expect(res.out).toContain('CANNOT CONCLUDE');
    } finally {
      rmSync(stub, { recursive: true, force: true });
    }
  });
});

/**
 * pre-push-check.mjs — behavior tests for the 2026-10-22 object-level
 * rewrite. Every scenario runs the REAL script as a subprocess against a
 * scratch git repo with FICTITIOUS private rules (never the machine's real
 * rules): the gate must BLOCK pushes whose outgoing objects carry private
 * values in commit/tag metadata, messages, paths, symlink targets or file
 * contents — including "added then deleted" and evil-merge content — must
 * BLOCK (not skip) when its inputs are unreadable, must PASS legitimate
 * noreply/third-party/public content, and must never print the matched
 * values back.
 *
 * Fixture hygiene: every value a real gate rule could match (home-dir
 * paths, PEM markers, LAN IPs, tokens; the fictitious emails too, for good
 * measure) is assembled at runtime so this file's own diff stays clean —
 * the same trick the 2026-10-02 suite used for the LAN address.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePushLines, rangeToPosNeg } from '../../../scripts/pre-push-check.mjs';

const SCRIPT = resolve(__dirname, '../../../scripts/pre-push-check.mjs');
const INSTALL = resolve(__dirname, '../../../scripts/install-hooks.sh');

/* ------------------------- fictitious fixtures (runtime-assembled) ------- */

const FAKE_EMAIL = ['fake.person', 'example.invalid'].join('@');
const FAKE_EMAIL_RE = ['fake\\.person', 'example\\.invalid'].join('@');
const SELF_EMAIL = ['12345+testself', 'users.noreply.github.com'].join('@');
const SELF_NAME = 'Test Self';
const THIRD_PARTY_EMAIL = ['alice.contributor', 'open-source.example.org'].join('@');
const WEBFLOW = 'noreply@github.com';
const homeTarget = () => '/' + ['Users', 'somebody', 'Downloads', 'thing'].join('/');
const pemMarker = () => ['-----BEGIN ', 'OPENSSH PRIVATE KEY-----'].join('');
const lanLine = () => ['server 192', '168', '44', '9 today'].join('.');

const RULES = [
  '[forbidden]',
  FAKE_EMAIL_RE,
  '[forbidden-paths]',
  '(^|/)\\u673a\\u5bc6\\u8d44\\u6599/',
  '[self-names]',
  SELF_NAME,
  '[self-emails]',
  SELF_EMAIL,
].join('\n');

/* ------------------------------- scratch helpers -------------------------- */

const GITENV = {
  ...process.env,
  // Hermetic scratch repos: no global/system hooksPath or identity leaks in.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

interface Repo {
  dir: string;
  g(...args: string[]): string;
  run(args: string[], opts?: { stdin?: string; cwd?: string }): { code: number; out: string };
  hookStdin(lines: string[], remote?: string, cwd?: string): { code: number; out: string };
  clean(): void;
}

function makeRepo(withRules = true, withScripts = false): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'pb-prepush-'));
  const g = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: GITENV }).trim();
  g('init', '-q');
  g('config', 'user.email', SELF_EMAIL);
  g('config', 'user.name', SELF_NAME);
  if (withRules) {
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(dir, '.git', 'info', 'pathblender-privacy-rules'), RULES + '\n');
    chmodSync(join(dir, '.git', 'info', 'pathblender-privacy-rules'), 0o600);
  }
  if (withScripts) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(dir, 'scripts', 'pre-push-check.mjs'));
    copyFileSync(INSTALL, join(dir, 'scripts', 'install-hooks.sh'));
    // Cross-platform stand-in for install-hooks.sh's hook write (the doctor
    // counts an installed hook as part of readiness; zsh is not a given on CI).
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(
      join(dir, '.git', 'hooks', 'pre-push'),
      '#!/bin/zsh\ncommon="$(git rev-parse --git-common-dir)" || exit 2\ncase "$common" in /*) ;; *) common="$PWD/$common" ;; esac\nmain="${common:h}"\nfor s in "$main/scripts/pre-push-check.mjs" "$PWD/scripts/pre-push-check.mjs"; do\n  if [ -f "$s" ]; then exec node "$s" "$@"; fi\ndone\necho "pre-push: checker not found" >&2\nexit 2\n',
    );
    chmodSync(join(dir, '.git', 'hooks', 'pre-push'), 0o755);
  }
  const run = (args: string[], opts?: { stdin?: string; cwd?: string }) => {
    const res = spawnSync('node', [SCRIPT, ...args], {
      cwd: opts?.cwd ?? dir,
      encoding: 'utf8',
      env: GITENV,
      input: opts?.stdin,
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    return { code: res.status ?? 1, out };
  };
  const hookStdin = (lines: string[], remote = 'origin', cwd?: string) =>
    run([remote], { stdin: lines.join('\n') + '\n', cwd: cwd ?? dir });
  const clean = () => rmSync(dir, { recursive: true, force: true });
  return { dir, g, run, hookStdin, clean };
}

function commitFile(r: Repo, name: string, content: string, message: string, env: Record<string, string> = {}) {
  writeFileSync(join(r.dir, name), content);
  r.g('add', '--', name);
  execFileSync('git', ['commit', '-qm', message], {
    cwd: r.dir,
    encoding: 'utf8',
    env: { ...GITENV, ...env },
  });
}

const refLine = (ref: string, localSha: string, remoteSha: string) => `${ref} ${localSha} ${ref} ${remoteSha}`;
const ZERO = '0'.repeat(40);

/* ------------------------------- unit: parsing ---------------------------- */

describe('parsePushLines', () => {
  it('classifies new refs, updates and deletions across multiple lines', () => {
    const sha = (n: string) => 'a'.repeat(24) + n.padStart(16, '0');
    const refs = parsePushLines(
      [
        `refs/heads/one ${sha('1')} refs/heads/one ${sha('9')}`,
        `refs/heads/two ${sha('2')} refs/heads/two ${ZERO}`,
        `(delete) ${ZERO} refs/heads/gone ${sha('4')}`,
        'not a ref line at all',
      ].join('\n'),
    );
    expect(refs.map((r) => r.kind)).toEqual(['update', 'new', 'delete']);
  });

  it('returns [] for empty stdin (manual fallback decides the range)', () => {
    expect(parsePushLines('')).toEqual([]);
    expect(parsePushLines('\n  \n')).toEqual([]);
  });
});

describe('rangeToPosNeg', () => {
  it('splits A..B and A...B and keeps single revs positive-only', () => {
    expect(rangeToPosNeg('old..new')).toEqual({ positives: ['new'], negatives: ['old'] });
    expect(rangeToPosNeg('old...new')).toEqual({ positives: ['new'], negatives: ['old'] });
    expect(rangeToPosNeg('HEAD')).toEqual({ positives: ['HEAD'], negatives: [] });
  });
});

/* ---------------------------- e2e: identity ------------------------------- */

describe('e2e: commit/tag metadata', () => {
  it('BLOCKS a personal email that exists only in author metadata', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean one');
    commitFile(r, 'b.txt', 'clean\n', 'dirty metadata', {
      GIT_AUTHOR_NAME: 'Fake Person',
      GIT_AUTHOR_EMAIL: FAKE_EMAIL,
    });
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('identity/forbidden');
    expect(res.out).not.toContain(FAKE_EMAIL);
    r.clean();
  });

  it('BLOCKS a self name carrying a non-noreply committer email', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    commitFile(r, 'b.txt', 'clean\n', 'self but wrong email', {
      GIT_COMMITTER_EMAIL: ['test.personal', 'mail.example.net'].join('@'),
    });
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('identity/self-not-noreply');
    expect(res.out).not.toContain('test.personal');
    r.clean();
  });

  it('PASSES third-party authors, GitHub web-flow committers and bot identities', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    commitFile(r, 'b.txt', 'clean\n', 'third-party author', {
      GIT_AUTHOR_NAME: 'Alice Contributor',
      GIT_AUTHOR_EMAIL: THIRD_PARTY_EMAIL,
    });
    commitFile(r, 'c.txt', 'clean\n', 'web-flow committer', {
      GIT_COMMITTER_NAME: 'GitHub',
      GIT_COMMITTER_EMAIL: WEBFLOW,
    });
    commitFile(r, 'd.txt', 'clean\n', 'dependabot bot', {
      GIT_AUTHOR_NAME: 'dependabot[bot]',
      GIT_AUTHOR_EMAIL: ['49699333+dependabot[bot]', 'users.noreply.github.com'].join('@'),
    });
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(0);
    expect(res.out).toContain('third-party identit');
    r.clean();
  });

  it('BLOCKS a personal email in an annotated tag tagger and in a tag message', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    r.g('tag', '-a', '-m', 'fine message', 'good-tag');
    execFileSync(
      'git',
      ['tag', '-a', '-m', 'clean message', 'bad-tagger', 'HEAD'],
      {
        cwd: r.dir,
        encoding: 'utf8',
        env: { ...GITENV, GIT_COMMITTER_NAME: 'Fake Person', GIT_COMMITTER_EMAIL: FAKE_EMAIL },
      },
    );
    execFileSync(
      'git',
      ['tag', '-a', '-m', `notes for ${FAKE_EMAIL} inside`, 'bad-message', 'HEAD'],
      { cwd: r.dir, encoding: 'utf8', env: GITENV },
    );
    const res = r.hookStdin([
      refLine('refs/tags/good-tag', r.g('rev-parse', 'good-tag'), ZERO),
      refLine('refs/tags/bad-tagger', r.g('rev-parse', 'bad-tagger'), ZERO),
      refLine('refs/tags/bad-message', r.g('rev-parse', 'bad-message'), ZERO),
    ]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('tag object');
    expect(res.out).toContain('identity/forbidden');
    expect(res.out).toContain('tag-message/forbidden');
    expect(res.out).not.toContain(FAKE_EMAIL);
    r.clean();
  });

  it('BLOCKS when the effective committer identity is not an allowed self address', () => {
    const r = makeRepo();
    r.g('config', 'user.email', ['oops.personal', 'mail.example.net'].join('@'));
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('effective committer identity');
    expect(res.out).not.toContain('oops.personal');
    r.clean();
  });
});

/* ---------------------------- e2e: content -------------------------------- */

describe('e2e: messages, paths, symlinks, file content', () => {
  it('BLOCKS a private value in a commit message', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    commitFile(r, 'b.txt', 'clean\n', `mentioning ${FAKE_EMAIL} in the message`);
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('message/forbidden');
    expect(res.out).not.toContain(FAKE_EMAIL);
    r.clean();
  });

  it('BLOCKS a Chinese, spaced, newline-containing path via [forbidden-paths] and redacts it', () => {
    const r = makeRepo();
    commitFile(r, 'ok.md', 'clean\n', 'clean');
    // 机密资料/内部 笔记 + a newline inside one filename — every byte class
    // the old diff-line scanner mishandled.
    const dir = '\u673a\u5bc6\u8d44\u6599';
    const name = '\u5185\u90e8 \u7b14\u8bb0\nv2.md';
    mkdirSync(join(r.dir, dir), { recursive: true });
    writeFileSync(join(r.dir, dir, name), 'clean content\n');
    r.g('add', '-A');
    r.g('commit', '-qm', 'adds chinese notes');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('path/forbidden-path');
    expect(res.out).toContain('redacted path');
    expect(res.out).not.toContain(dir);
    expect(res.out).not.toContain('\u7b14\u8bb0');
    r.clean();
  });

  it('PASSES ordinary Chinese/space paths when no rule matches them', () => {
    const r = makeRepo();
    const name = '\u666e\u901a \u6587\u4ef6.md';
    writeFileSync(join(r.dir, name), 'clean\n');
    r.g('add', '-A');
    r.g('commit', '-qm', 'normal chinese file');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(0);
    r.clean();
  });

  it('BLOCKS a symlink whose target is an absolute home-dir path (2026-10 history case)', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: r.dir,
      encoding: 'utf8',
      env: GITENV,
      input: homeTarget(),
    }).trim();
    execFileSync(
      'git',
      ['update-index', '--add', '--cacheinfo', `120000,${blob},node_modules`],
      { cwd: r.dir, encoding: 'utf8', env: GITENV },
    );
    r.g('commit', '-qm', 'adds a personal symlink');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('symlink/');
    expect(res.out).toContain('home-path');
    expect(res.out).not.toContain('somebody');
    r.clean();
  });

  it('BLOCKS key material and LAN addresses inside file content (generic rules)', () => {
    const r = makeRepo();
    commitFile(r, 'id.txt', pemMarker() + '\n', 'adds key file');
    commitFile(r, 'net.txt', lanLine() + '\n', 'adds net notes');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('content/generic:pem-private-key');
    expect(res.out).toContain('content/generic:lan-ip');
    expect(res.out).not.toContain('PRIVATE KEY');
    r.clean();
  });

  it('BLOCKS content introduced only by an evil merge (absent from both parents)', () => {
    const r = makeRepo();
    commitFile(r, 'base.txt', 'clean\n', 'base');
    const mainBranch = r.g('rev-parse', '--abbrev-ref', 'HEAD');
    r.g('checkout', '-qb', 'side-a');
    commitFile(r, 'a.txt', 'clean a\n', 'side a');
    r.g('checkout', '-q', mainBranch);
    r.g('checkout', '-qb', 'side-b');
    commitFile(r, 'b.txt', 'clean b\n', 'side b');
    execFileSync(
      'git',
      ['merge', '--no-ff', '--no-commit', '-q', 'side-a'],
      { cwd: r.dir, encoding: 'utf8', env: GITENV },
    );
    writeFileSync(join(r.dir, 'smuggled.txt'), `evil merge payload ${FAKE_EMAIL}\n`);
    r.g('add', 'smuggled.txt');
    r.g('commit', '-qm', 'evil merge');
    const res = r.hookStdin([refLine('refs/heads/side-b', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('content/forbidden');
    expect(res.out).toContain('smuggled.txt');
    r.clean();
  });

  it('BLOCKS content that a later commit deleted (blob still reachable in history)', () => {
    const r = makeRepo();
    commitFile(r, 'keep.txt', 'clean\n', 'clean');
    commitFile(r, 'oops.txt', `secret ${FAKE_EMAIL}\n`, 'adds secret');
    r.g('rm', '-q', 'oops.txt');
    r.g('commit', '-qm', 'removes secret');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('content/forbidden');
    expect(res.out).toContain('does NOT remove it from history');
    r.clean();
  });

  it('BLOCKS a file force-added past .gitignore (path/ignored-by-gitignore)', () => {
    const r = makeRepo();
    writeFileSync(join(r.dir, '.gitignore'), '.env\n');
    r.g('add', '.gitignore');
    r.g('commit', '-qm', 'ignore env');
    writeFileSync(join(r.dir, '.env'), 'TOKEN=1\n');
    r.g('add', '-f', '.env');
    r.g('commit', '-qm', 'force adds env');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('path/ignored-by-gitignore');
    r.clean();
  });
});

/* ---------------------------- e2e: multi-ref ------------------------------ */

describe('e2e: multi-ref, deletions, remote exclusion', () => {
  it('scans EVERY ref line — a dirty commit on the second line still blocks', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    commitFile(r, 'b.txt', 'clean\n', 'more clean');
    const clean2 = r.g('rev-parse', 'HEAD');
    commitFile(r, 'c.txt', `secret ${FAKE_EMAIL}\n`, 'dirty on branch two');
    const dirty = r.g('rev-parse', 'HEAD');
    const res = r.hookStdin([
      refLine('refs/heads/one', clean2, clean2), // no-op update
      refLine('refs/heads/two', dirty, ZERO),
    ]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('content/forbidden');
    r.clean();
  });

  it('treats a delete-only push as no objects — no fallback scan of HEAD', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', `secret ${FAKE_EMAIL}\n`, 'dirty head'); // would block if scanned
    const head = r.g('rev-parse', 'HEAD');
    const res = r.hookStdin([`(delete) ${ZERO} refs/heads/gone ${head}`]);
    expect(res.code).toBe(0);
    expect(res.out).toContain('deletion(s) only');
    r.clean();
  });

  it('excludes history the remote already has (live tips) but still blocks new dirty commits', () => {
    const base = mkdtempSync(join(tmpdir(), 'pb-prepush-bare-'));
    const r = makeRepo();
    execFileSync('git', ['init', '-q', '--bare', 'bare.git'], { cwd: base, encoding: 'utf8', env: GITENV });
    const url = join(base, 'bare.git');
    r.g('remote', 'add', 'origin', url);
    commitFile(r, 'a.txt', 'clean\n', 'published base');
    r.g('push', '-q', 'origin', 'HEAD:refs/heads/main');
    commitFile(r, 'b.txt', `secret ${FAKE_EMAIL}\n`, 'new dirty commit');
    const res = r.run([url], {
      stdin: `${refLine('refs/heads/feature', r.g('rev-parse', 'HEAD'), ZERO)}\n`,
    });
    expect(res.code).toBe(1);
    expect(res.out).toContain('live remote tip(s)');
    expect(res.out).toContain('content/forbidden');
    r.clean();
    rmSync(base, { recursive: true, force: true });
  });

  it('keeps every live remote tip excluded when several refs are present', () => {
    const base = mkdtempSync(join(tmpdir(), 'pb-prepush-bare-'));
    const r = makeRepo();
    execFileSync('git', ['init', '-q', '--bare', 'bare.git'], { cwd: base, encoding: 'utf8', env: GITENV });
    const url = join(base, 'bare.git');
    r.g('remote', 'add', 'origin', url);
    commitFile(r, 'a.txt', 'clean\n', 'published clean base');
    const cleanBase = r.g('rev-parse', 'HEAD');
    r.g('push', '-q', 'origin', 'HEAD:refs/heads/a-main');
    r.g('switch', '-qc', 'z-private');
    commitFile(r, 'b.txt', 'clean\n', `historical ${lanLine()}`);
    r.g('push', '-q', 'origin', 'HEAD:refs/heads/z-private');
    r.g('switch', '-qc', 'feature', cleanBase);
    commitFile(r, 'c.txt', 'clean docs\n', 'clean docs commit');
    const res = r.run([url], {
      stdin: `${refLine('refs/heads/feature', r.g('rev-parse', 'HEAD'), ZERO)}\n`,
    });
    expect(res.code).toBe(0);
    expect(res.out).toContain('live remote tip(s)');
    expect(res.out).not.toContain('generic:lan-ip');
    r.clean();
    rmSync(base, { recursive: true, force: true });
  });

  it('scans in full when the advertised remote tip is unknown locally (forced update case)', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', `secret ${FAKE_EMAIL}\n`, 'old dirty commit');
    const head = r.g('rev-parse', 'HEAD');
    const ghost = 'f'.repeat(40); // advertised remote value we do not have
    const res = r.hookStdin([refLine('refs/heads/main', head, ghost)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain('not present locally');
    expect(res.out).toContain('content/forbidden');
    r.clean();
  });
});

/* ---------------------------- e2e: failure modes -------------------------- */

describe('e2e: rules and object failures block (never "assume clean")', () => {
  it('exits 2 when the shared rules file is missing', () => {
    const r = makeRepo(false);
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('CANNOT CONCLUDE');
    expect(res.out).toContain('--install-rules');
    r.clean();
  });

  it('exits 2 with a line number (not the source) when a rule is not a valid regex', () => {
    const r = makeRepo(false);
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    mkdirSync(join(r.dir, '.git', 'info'), { recursive: true });
    const rules = RULES.replace(FAKE_EMAIL_RE, 'not a regex (unclosed[');
    writeFileSync(join(r.dir, '.git', 'info', 'pathblender-privacy-rules'), rules + '\n');
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('not a valid regular expression');
    expect(res.out).toMatch(/pathblender-privacy-rules:2/);
    expect(res.out).not.toContain('unclosed');
    r.clean();
  });

  it('exits 2 when the rules file is unreadable', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    const rulesFile = join(r.dir, '.git', 'info', 'pathblender-privacy-rules');
    chmodSync(rulesFile, 0o000);
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('not readable');
    chmodSync(rulesFile, 0o600);
    r.clean();
  });

  it('exits 2 when an outgoing blob object cannot be read (deleted from the object store)', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    commitFile(r, 'b.txt', 'clean too\n', 'second');
    const blob = r.g('rev-parse', 'HEAD:b.txt');
    rmSync(join(r.dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)), { force: true });
    const res = r.hookStdin([refLine('refs/heads/main', r.g('rev-parse', 'HEAD'), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('CANNOT CONCLUDE');
    expect(res.out).toMatch(/missing|cannot/i);
    r.clean();
  });

  it('exits 2 when the positive ref itself cannot be resolved', () => {
    const r = makeRepo();
    commitFile(r, 'a.txt', 'clean\n', 'clean');
    const res = r.hookStdin([refLine('refs/heads/main', 'e'.repeat(40), ZERO)]);
    expect(res.code).toBe(2);
    expect(res.out).toContain('cannot enumerate');
    r.clean();
  });
});

/* ---------------------------- e2e: worktree consistency ------------------- */

describe('e2e: one shared gate across worktrees', () => {
  it('applies the SAME shared rules when the hook runs inside a linked worktree', () => {
    const r = makeRepo(true, true); // shared rules + scripts committed layout
    commitFile(r, 'base.txt', 'clean\n', 'base');
    r.g('add', 'scripts');
    r.g('commit', '-qm', 'add checker scripts');
    const wt = join(r.dir, '..', `wt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    r.g('worktree', 'add', '-q', wt, '-b', 'wt-branch');
    try {
      // Dirty commit created IN the worktree; shared rules live in the main
      // tree's .git — the worktree inherits them via the common git dir.
      writeFileSync(join(wt, 'dirty.txt'), `secret ${FAKE_EMAIL}\n`);
      execFileSync('git', ['add', '--', 'dirty.txt'], { cwd: wt, encoding: 'utf8', env: GITENV });
      execFileSync('git', ['commit', '-qm', 'dirty in worktree'], { cwd: wt, encoding: 'utf8', env: GITENV });
      const wtHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8', env: GITENV }).trim();
      const res = r.hookStdin([refLine('refs/heads/wt-branch', wtHead, ZERO)], 'origin', wt);
      expect(res.code).toBe(1);
      expect(res.out).toContain('content/forbidden');
      expect(res.out).not.toContain(FAKE_EMAIL);
    } finally {
      rmSync(wt, { recursive: true, force: true });
      r.clean();
    }
  });
});

/* ---------------------------- doctor / install-rules ---------------------- */

describe('doctor and install-rules', () => {
  it('install-rules creates a skeleton prefilled from git config; doctor NOT READY until filled', () => {
    const r = makeRepo(false, true);
    const rules = join(r.dir, '.git', 'info', 'pathblender-privacy-rules');
    const install = r.run(['--install-rules']);
    expect(install.code).toBe(0);
    const created = readFileSync(rules, 'utf8');
    expect(created).toContain(SELF_EMAIL); // prefilled from git config
    expect(created).toContain(SELF_NAME);
    const before = r.run(['--doctor']);
    expect(before.code).toBe(1);
    expect(before.out).toContain('NOT READY');
    expect(before.out).toContain('[forbidden] is empty');
    writeFileSync(rules, RULES + '\n');
    chmodSync(rules, 0o600);
    const after = r.run(['--doctor']);
    expect(after.code).toBe(0);
    expect(after.out).toContain('READY');
    r.clean();
  });

  it('install-rules migrates a legacy .pre-push-patterns with a backup and never drops rules', () => {
    const r = makeRepo(false, true);
    const rules = join(r.dir, '.git', 'info', 'pathblender-privacy-rules');
    writeFileSync(rules, RULES + '\n'); // already-valid shared rules
    writeFileSync(join(r.dir, '.pre-push-patterns'), `# legacy\nlegacy-token-[0-9]{4}\n${FAKE_EMAIL_RE}\n`);
    const res = r.run(['--install-rules']);
    expect(res.code).toBe(0);
    const merged = readFileSync(rules, 'utf8');
    expect(merged).toContain('legacy-token-[0-9]{4}');
    expect(merged).toContain(FAKE_EMAIL_RE);
    expect(merged).toContain('[self-emails]');
    const backups = execFileSync('ls', [join(r.dir, '.git', 'info')], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f.startsWith('pathblender-privacy-rules.bak-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const doctor = r.run(['--doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.out).toContain('all covered by shared rules');
    const again = r.run(['--install-rules']); // idempotent
    expect(again.code).toBe(0);
    expect(again.out).toContain('left unchanged');
    r.clean();
  });

  it('doctor flags a legacy pattern that is NOT yet migrated', () => {
    const r = makeRepo();
    writeFileSync(join(r.dir, '.pre-push-patterns'), 'extra-legacy-token-[0-9]{2}\n');
    const res = r.run(['--doctor']);
    expect(res.code).toBe(1);
    expect(res.out).toContain('NOT in shared rules');
    r.clean();
  });
});

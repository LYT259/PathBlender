/**
 * Pre-push gate (2026-09-02 lesson): the sensitive-string scan used to be a
 * one-time check at repo-snapshot creation — but engineering logs are
 * appended every round, and two entries written AFTER that scan reintroduced
 * the account name, reaching the remote. This script makes the check a
 * per-push gate instead: it scans every commit about to go out, and a hit
 * aborts the push.
 *
 * Installed as a git pre-push hook (see scripts/install-hooks.sh). Local
 * commits after a failure: fix the words, amend/revert, push again.
 *
 * Patterns are the project's own disclosure discipline (AGENTS.md red lines):
 * account names, appeal ticket numbers, LAN IPs, real names/emails, key
 * material. Deliberately noisy over tea-leaf parsing — a hit is always
 * investigated, never auto-suppressed.
 *
 * Multi-ref pushes (2026-10-02 fix): git sends ONE stdin line per ref being
 * pushed (`git push --tags`, or several branches at once). The hook used to
 * read only the first line, so every ref after the first went out unscanned.
 * All lines are now resolved into ranges and their commits unioned.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Generic patterns only — this file is public, so it must not spell out the
// org's internal-only tokens. Add those to .pre-push-patterns (gitignored),
// one RegExp source per line, e.g. an account handle or ticket number.
const PATTERNS = [
  /192\.168\.\d+\.\d+/,          // RFC1918 LAN addresses
  /sk-ant-[A-Za-z0-9_-]{10,}/,   // Anthropic keys
  /sk-proj-[A-Za-z0-9_-]{10,}/,  // OpenAI keys
  /ghp_[A-Za-z0-9]{20,}/,        // GitHub PATs
  /gho_[A-Za-z0-9]{20,}/,        // GitHub OAuth tokens
  /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
];

const localPatternsPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.pre-push-patterns');
if (existsSync(localPatternsPath)) {
  for (const line of readFileSync(localPatternsPath, 'utf8').split('\n')) {
    const src = line.trim();
    if (!src || src.startsWith('#')) continue;
    PATTERNS.push(new RegExp(src));
  }
}

const ZERO_SHA = /^0+$/;

/**
 * Turn the pre-push hook's stdin (one "<local_ref> <local_sha> <remote_ref>
 * <remote_sha>" line per pushed ref) into rev-list ranges covering EVERYTHING
 * leaving the machine. Worktree-safe: HEAD differs per worktree, but the shas
 * on stdin are authoritative, so nothing here depends on which tree pushed.
 * Deletions (local sha all zeros) push no new content and are skipped.
 * Returns null when stdin carries no push lines (manual run — the caller
 * falls back to its own range resolution).
 */
export function collectPushRanges(stdinText) {
  const lines = stdinText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const ranges = [];
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || ZERO_SHA.test(localSha)) continue; // deletion — nothing new leaves
    if (!remoteSha || ZERO_SHA.test(remoteSha)) {
      ranges.push(localSha); // new remote ref → scan its full history
    } else {
      ranges.push(`${remoteSha}..${localSha}`);
    }
  }
  return ranges.length > 0 ? ranges : null;
}

/**
 * Union the commits of several ranges (multi-ref pushes overlap heavily —
 * two branches sharing a base would otherwise be scanned twice).
 */
export function unionRangeCommits(git, ranges) {
  const seen = new Set();
  for (const range of ranges) {
    let out;
    try {
      out = git('rev-list', range);
    } catch (e) {
      throw new Error(`cannot resolve range "${range}" — ${e.message.split('\n')[0]}`);
    }
    for (const sha of out.split('\n').filter(Boolean)) seen.add(sha);
  }
  return [...seen];
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  // maxBuffer 64 MB: a legitimate commit can carry a multi-MB diff (field
  // art, models) — the default 1 MB made `git show` fail with ENOBUFS,
  // which used to be silently skipped by the old catch-continue and now
  // (correctly, but wrongly) blocks. Big-but-readable must pass; only
  // genuinely unreadable commits block. First hit live on push of this
  // very change (2026-10-02).
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).trim();

  // Git pre-push sends ref lines on STDIN (argv gets remote name/URL). We
  // can't block on stdin when run manually, so only read it when the hook
  // invocation provides it.
  const isHook = !process.argv[2]?.includes(' ') || process.argv[2] === 'origin';
  let stdinData = '';
  if (isHook && !process.stdin.isTTY) {
    stdinData = readFileSync(0, 'utf8'); // fd 0, non-blocking after hook wires it
  }

  let ranges;
  const hookRanges = collectPushRanges(stdinData);
  if (hookRanges) {
    ranges = hookRanges;
  } else if (process.argv.length > 2 && process.argv[2] && !process.argv[2].includes(' ')) {
    ranges = [process.argv[2]]; // manual: explicit range argument
  } else {
    // manual run: everything not yet on any remote
    let range = '@{u}..HEAD';
    try {
      git('rev-parse', '@{u}');
    } catch {
      range = 'HEAD';
    }
    ranges = [range];
  }

  let commits;
  try {
    commits = unionRangeCommits(git, ranges);
  } catch (e) {
    console.error(`pre-push-check: ${e.message}`);
    process.exit(1);
  }
  if (commits.length === 0) {
    console.log('pre-push-check: nothing to push, ok');
    process.exit(0);
  }

  const hits = [];
  for (const sha of commits) {
    let diff = '';
    try {
      diff = git('show', sha, '--format=', '--unified=0');
    } catch (e) {
      // An unreadable commit must BLOCK the push, never skip it: the old
      // `continue` silently passed such commits through (reproduced in the
      // 2026-10-02 acceptance audit with a stub git whose `show` fails —
      // the script exited 0 "clean"). If we cannot read it, we cannot
      // clear it.
      console.error(`pre-push-check: cannot read commit ${sha.slice(0, 8)} (${e.message.split('\n')[0]}) — refusing to clear it`);
      process.exit(1);
    }
    for (const line of diff.split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      for (const re of PATTERNS) {
        if (re.test(line)) {
          hits.push({ sha: sha.slice(0, 8), line: line.slice(1, 120), pattern: re.source });
          break;
        }
      }
    }
  }

  if (hits.length > 0) {
    console.error('pre-push-check: SENSITIVE CONTENT in outgoing commits — push aborted.');
    for (const h of hits.slice(0, 10)) {
      console.error(`  ${h.sha}  /${h.pattern}/  ${h.line}`);
    }
    console.error('Fix the wording (or revert), then push again. This gate exists so a stale one-time scan never clears a push again (2026-09-02). Multi-ref pushes are scanned in full since 2026-10-02.');
    process.exit(1);
  }
  console.log(`pre-push-check: ${commits.length} outgoing commit(s) across ${ranges.length} range(s) clean ✓`);
}

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
 */
import { execFileSync } from 'node:child_process';

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

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const localPatternsPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.pre-push-patterns');
if (existsSync(localPatternsPath)) {
  for (const line of readFileSync(localPatternsPath, 'utf8').split('\n')) {
    const src = line.trim();
    if (!src || src.startsWith('#')) continue;
    PATTERNS.push(new RegExp(src));
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let range;
if (process.argv.length > 2 && process.argv[2] && !process.argv[2].includes(' ')) {
  // manual run with an explicit range, e.g. `pre-push-check.mjs HEAD~3..HEAD`
  range = process.argv[2];
} else if (process.argv.length > 2) {
  // hook args: <local ref> <local sha> <remote ref> <remote sha> pairs
  const lines = process.argv.slice(2).join('\n').split('\n').filter(Boolean);
  const first = lines[0]?.split(' ');
  const localSha = first?.[1] ?? '';
  const remoteSha = first?.[3] ?? '';
  range = remoteSha ? `${remoteSha}..${localSha}` : localSha;
} else {
  // manual run: everything not yet on any remote
  range = '@{u}..HEAD';
  try {
    git('rev-parse', '@{u}');
  } catch {
    range = 'HEAD';
  }
}

let commits;
try {
  commits = git('rev-list', range).split('\n').filter(Boolean);
} catch (e) {
  console.error(`pre-push-check: cannot resolve range "${range}" — ${e.message.split('\n')[0]}`);
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
  } catch {
    continue;
  }
  let currentFile = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      continue;
    }
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
  console.error('Fix the wording (or revert), then push again. This gate exists so a stale one-time scan never clears a push again (2026-09-02).');
  process.exit(1);
}
console.log(`pre-push-check: ${commits.length} outgoing commit(s) clean ✓`);

#!/usr/bin/env node
/**
 * worktree-status — inventory and safe cleanup of git worktrees.
 *
 * Report mode (default) lists every worktree with its branch, dirty state and
 * distance to beta, and marks each one KEEP or PRUNE. `--prune` removes only
 * what is marked PRUNE: a worktree qualifies when its tree is clean AND its
 * branch is fully merged into beta. Worktrees with uncommitted changes or
 * unmerged commits are never touched, with or without --prune — parallel
 * sessions may resume their worktrees at any time, so that guard is the
 * whole point of this tool. Worktrees under ~/.codex/worktrees belong to
 * codex sessions, which park and resume them across days: those are never
 * auto-pruned, that session cleans up after itself.
 *
 * Usage:
 *   node scripts/worktree-status.mjs            # read-only inventory
 *   node scripts/worktree-status.mjs --prune    # remove pruneable worktrees and their merged branches
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function die(message) {
  console.error(`worktree-status: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(
    'Usage: node scripts/worktree-status.mjs [--prune]\n' +
      '\n' +
      'Default: read-only inventory of every worktree (branch, dirty state, distance to beta).\n' +
      '--prune: remove only worktrees whose tree is clean AND whose branch is fully merged into beta.',
  );
  process.exit(0);
}
const unknown = args.filter((a) => !['--prune'].includes(a));
if (unknown.length > 0) die(`unknown argument(s): ${unknown.join(' ')}`);
const pruneMode = args.includes('--prune');

const run = (gitArgs, opts = {}) =>
  execFileSync('git', gitArgs, { encoding: 'utf-8', ...opts });
const tryRun = (gitArgs, opts = {}) => {
  try {
    return { ok: true, out: run(gitArgs, opts) };
  } catch (err) {
    return { ok: false, err };
  }
};

function parseWorktrees() {
  const out = run(['worktree', 'list', '--porcelain']).trim();
  const worktrees = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line === '') {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    const sp = line.indexOf(' ');
    const key = line.slice(0, sp);
    const value = line.slice(sp + 1);
    if (key === 'worktree') current = { path: value, head: null, branch: null, detached: false };
    else if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
  }
  if (current) worktrees.push(current);
  return worktrees;
}

function betaRef() {
  for (const candidate of [
    { verify: 'refs/heads/beta', display: 'beta' },
    { verify: 'refs/remotes/origin/beta', display: 'origin/beta' },
  ]) {
    const res = tryRun(['rev-parse', '--verify', candidate.verify]);
    if (res.ok) return { sha: res.out.trim(), display: candidate.display };
  }
  return null;
}

function inventory(beta) {
  const items = [];
  for (const [index, wt] of parseWorktrees().entries()) {
    const item = { ...wt, main: index === 0, shortSha: wt.head ? wt.head.slice(0, 7) : '?' };
    if (item.main) {
      item.verdict = 'KEEP';
      item.reason = 'main tree — parked on beta, never removed';
      items.push(item);
      continue;
    }
    if (!existsSync(item.path)) {
      item.verdict = 'PRUNE';
      item.reason = 'directory missing (stale worktree admin entry)';
      items.push(item);
      continue;
    }
    const statusOut = run(['-C', item.path, 'status', '--porcelain']).trim();
    item.dirtyLines = statusOut === '' ? [] : statusOut.split('\n');
    const ref = item.branch ?? item.head;
    const counts = run(['rev-list', '--left-right', '--count', `${beta.sha}...${ref}`])
      .trim()
      .split(/\s+/);
    item.behind = Number(counts[0]);
    item.ahead = Number(counts[1]);
    item.merged = tryRun(['merge-base', '--is-ancestor', ref, beta.sha]).ok;
    if (item.dirtyLines.length > 0) {
      item.verdict = 'KEEP';
      item.reason = `uncommitted changes: ${item.dirtyLines.length} entr${item.dirtyLines.length === 1 ? 'y' : 'ies'}`;
    } else if (!item.merged) {
      item.verdict = 'KEEP';
      item.reason = `${item.ahead} commit(s) not merged into ${beta.display}`;
    } else if (item.path.includes('/.codex/worktrees/')) {
      // Another tool's session owns this checkout's lifecycle — it may be
      // parked intentionally and resumed later even with nothing committed.
      // Never auto-prune; that session cleans up after itself.
      item.verdict = 'KEEP';
      item.reason = 'codex session worktree — never auto-pruned';
    } else {
      item.verdict = 'PRUNE';
      item.reason = 'fully merged into beta, tree clean';
    }
    if (item.merged && item.behind > 0) {
      item.reason += `; baseline behind beta by ${item.behind}`;
    }
    items.push(item);
  }
  return items;
}

function printInventory(items, beta) {
  console.log(`Worktree inventory for ${items[0].path} (compare against ${beta.display} @ ${beta.sha.slice(0, 7)})`);
  console.log('');
  for (const item of items) {
    const label = item.main ? 'MAIN' : 'WT  ';
    const branch = item.branch
      ? item.branch
      : item.detached
        ? `detached @ ${item.shortSha}`
        : '?';
    console.log(`${item.verdict.padEnd(5)}  ${label}  ${item.path}  ${branch}  — ${item.reason}`);
    if (item.dirtyLines && item.dirtyLines.length > 0) {
      for (const line of item.dirtyLines.slice(0, 5)) console.log(`        ${line}`);
      if (item.dirtyLines.length > 5) console.log(`        … +${item.dirtyLines.length - 5} more`);
    }
  }
  const pruneable = items.filter((i) => i.verdict === 'PRUNE').length;
  const keep = items.length - pruneable;
  console.log('');
  console.log(`${items.length} worktree(s): ${pruneable} pruneable, ${keep} keep.`);
}

const beta = betaRef();
if (!beta) die('no beta or origin/beta ref found in this repository');
const items = inventory(beta);
printInventory(items, beta);

if (!pruneMode) process.exit(0);

const pruneable = items.filter((i) => i.verdict === 'PRUNE' && !i.main);
if (pruneable.length === 0) {
  console.log('\nNothing to prune.');
  process.exit(0);
}

console.log('');
let removed = 0;
for (const item of pruneable) {
  if (!existsSync(item.path)) {
    console.log(`- stale admin entry ${item.path} — cleaned by git worktree prune below`);
    removed++;
    continue;
  }
  const res = tryRun(['worktree', 'remove', item.path]);
  if (!res.ok) {
    console.log(`! could not remove ${item.path} (${res.err.status ?? res.err.message}) — left in place`);
    continue;
  }
  removed++;
  console.log(`- removed worktree ${item.path}`);
  if (item.branch) {
    const branchRes = tryRun(['branch', '-d', item.branch]);
    if (branchRes.ok) console.log(`  deleted merged branch ${item.branch}`);
    else console.log(`  branch ${item.branch} kept (git refused: not fully merged?)`);
  }
}
run(['worktree', 'prune']);
console.log(`\nPruned ${removed} of ${pruneable.length} candidate(s). Final state:`);
console.log('');
printInventory(inventory(beta), beta);

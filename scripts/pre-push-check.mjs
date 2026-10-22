/**
 * Pre-push privacy gate — object-level, multi-ref, sanitized-output rewrite
 * (2026-10-22). The 2026-09-02 lesson made the check a per-push gate; the
 * 2026-10-02 fix made it cover every ref line. The 2026-10-22 rewrite closes
 * the gaps the privacy audits kept finding (redbook §16.33):
 *
 *  - scans the ACTUAL objects a push would send (commits, annotated tags,
 *    trees, blobs), not just `git show` diff lines: author/committer/tagger
 *    names and emails, commit and tag messages, tree paths, symlink targets
 *    and full file contents — so "added sensitive content, deleted it later"
 *    and evil-merge content are caught (the blob stays reachable and would
 *    still leave the machine);
 *  - private match rules live in ONE shared file under the common git dir
 *    (never inside a worktree), so every worktree of this repository gets
 *    the same protection without hand-copying; `--doctor`/`--install-rules`
 *    make readiness checkable; a missing/corrupt/unreadable rule file BLOCKS
 *    the push instead of silently continuing with the public rules only;
 *  - output is sanitized: findings name the rule category, object and
 *    location — never the matched text, never a private pattern source; any
 *    path printed is home-dir-redacted;
 *  - anything that cannot be resolved or read blocks the push (exit 2
 *    "cannot conclude") — an unscannable object is not a clean object.
 *
 * Identity policy (AGENTS.md「隐私防复发与历史清理验收」):
 *  - MY commits must carry the configured GitHub noreply address — checked on
 *    the actual metadata, not on git config being "probably right";
 *  - my real name is allowed (no name ban); third-party authors and GitHub
 *    web-flow committers (noreply@github.com) pass through;
 *  - real email addresses and other private match values live ONLY in the
 *    private rules file — never in this public script, its tests, commit
 *    messages or reports.
 *
 * Deletion-only pushes send no objects and are skipped. New remote refs are
 * scanned over their full reachable history minus what the remote provably
 * already has (live ls-remote tips — deliberately NOT remote-tracking refs:
 * after a server-side history rewrite a stale clone's remote-tracking refs
 * still point at the old history, and excluding by them would wave that very
 * history through).
 *
 * Limits, stated honestly: blobs (binary included) are scanned as raw UTF-8
 * bytes, which catches embedded strings but not compressed/encoded payloads;
 * submodule gitlinks are reported as not inspectable. "Clean" means "no
 * configured rule matched", never "provably no leak exists".
 *
 * Usage:
 *   node scripts/pre-push-check.mjs <remote> <url>   # hook mode (stdin lines)
 *   node scripts/pre-push-check.mjs --range A..B     # manual explicit range
 *   node scripts/pre-push-check.mjs                  # manual @{u}..HEAD
 *   node scripts/pre-push-check.mjs --doctor         # readiness report
 *   node scripts/pre-push-check.mjs --install-rules  # create/migrate private rules
 * Exit codes: 0 clean · 1 findings · 2 cannot conclude (never "assume ok").
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, copyFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ZERO_SHA = /^0+$/;
const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const RULES_BASENAME = 'pathblender-privacy-rules';
const RULES_SECTIONS = ['forbidden', 'forbidden-paths', 'self-names', 'self-emails'];
// section header (lowercase, dashed) -> rules object key
const SECTION_KEY = {
  forbidden: 'forbidden',
  'forbidden-paths': 'forbiddenPaths',
  'self-names': 'selfNames',
  'self-emails': 'selfEmails',
};
// Private rules are compiled case-insensitive: an address or handle typed in
// different casing is still that address.
const PRIVATE_RULE_FLAGS = 'i';

// Public, generic patterns only — sources written so the source text itself
// does not match its own regex (this file's own diff must pass this gate).
const GENERIC_RULES = [
  ['lan-ip', /\b(?:192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}\b/],
  ['home-path', /\/(?:Users|home)\/[A-Za-z0-9_][A-Za-z0-9_.-]*\//],
  ['windows-user-path', /[A-Za-z]:\\Users\\[^\\/"'\s]+\\/],
  ['pem-private-key', /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['minisign-secret-key', /untrusted comment: (?:rsign|minisign) encrypted secret k[e]y/],
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['openai-key', /sk-proj-[A-Za-z0-9_-]{10,}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['github-fine-grained-pat', /github_pat_[A-Za-z0-9_]{20,}/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['slack-token', /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  ['npm-auth-token', /:_authToken\s*=/],
];

const GITHUB_NOREPLY_EMAIL = /^[^@\s]+@users\.noreply\.github\.com$|^noreply@github\.com$/i;

/** Exit codes: 0 clean · 1 findings · 2 cannot conclude. */
const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_CANNOT_CONCLUDE = 2;

class ConfigError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}
class ScanError extends Error {}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

/* ------------------------------------------------------------------ git io */

function makeGit(cwd) {
  const opts = { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, timeout: 120_000 };
  const git = (...args) => {
    try {
      return execFileSync('git', args, opts).trim();
    } catch (e) {
      const first = String(e.stderr ?? e.message ?? e).split('\n')[0];
      throw new ScanError(`git ${args[0]} failed: ${first}`);
    }
  };
  git.cwd = cwd;
  git.try = (...args) => {
    try {
      return execFileSync('git', args, opts).trim();
    } catch {
      return null;
    }
  };
  return git;
}

function repoPaths() {
  const git = makeGit(process.cwd());
  const toplevel = git('rev-parse', '--show-toplevel');
  // --git-common-dir prints relative (".git") in the main tree and absolute
  // in a worktree; resolve against cwd either way. (No --path-format: keep
  // compatibility with older git that may sit earlier on PATH.)
  const commonDir = resolve(process.cwd(), git('rev-parse', '--git-common-dir'));
  return { toplevel, commonDir };
}

/** Show repo paths without echoing this machine's home directory. */
function displayPath(p) {
  const home = process.env.HOME;
  if (home && p.startsWith(home + '/')) return `~${p.slice(home.length)}`;
  return p;
}

/* --------------------------------------------------------- private rules */

function rulesPath(commonDir) {
  return join(commonDir, 'info', RULES_BASENAME);
}

function parseRulesText(text, origin) {
  const out = { forbidden: [], forbiddenPaths: [], selfNames: new Set(), selfEmails: new Set() };
  const problems = [];
  const counters = { forbidden: 0, 'forbidden-paths': 0 };
  let section = null;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^\[(.+)\]$/.exec(line);
    if (m) {
      const name = m[1].trim().toLowerCase();
      if (!RULES_SECTIONS.includes(name)) {
        problems.push(`${origin}:${i + 1}: unknown section [${name}] (known: ${RULES_SECTIONS.join(', ')})`);
      }
      section = name;
      continue;
    }
    if (!section) {
      problems.push(`${origin}:${i + 1}: rule outside any [section] header`);
      continue;
    }
    const key = SECTION_KEY[section];
    if (key === 'selfNames' || key === 'selfEmails') {
      out[key].add(line.toLowerCase());
      continue;
    }
    counters[section] += 1;
    try {
      out[key].push({ re: new RegExp(line, PRIVATE_RULE_FLAGS), index: counters[section], source: line });
    } catch {
      problems.push(`${origin}:${i + 1}: [${section}] rule #${counters[section]} is not a valid regular expression`);
    }
  }
  if (out.selfEmails.size === 0) {
    problems.push(`${origin}: [self-emails] is empty — add the GitHub noreply address your own commits must use`);
  }
  if (out.forbidden.length === 0) {
    problems.push(`${origin}: [forbidden] is empty — add at least the private values that must never leave this machine`);
  }
  if (problems.length > 0) throw new ConfigError(`private rules file invalid (${problems.length} problem(s)):`, problems);
  return out;
}

function loadRules({ commonDir, toplevel }) {
  const path = rulesPath(commonDir);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(
      e.code === 'EACCES'
        ? `private rules file not readable: ${displayPath(path)} (check file permissions)`
        : `private rules file missing: ${displayPath(path)}`,
      [
        'run  node scripts/pre-push-check.mjs --install-rules  (or scripts/install-hooks.sh), then fill [forbidden] and [self-emails]',
      ],
    );
  }
  const rules = parseRulesText(text, RULES_BASENAME);
  // Backward compatibility (2026-09 era): a worktree-local .pre-push-patterns
  // still contributes its rules ON TOP of the shared file so a not-yet
  // migrated tree keeps its protection; --install-rules folds it into the
  // shared file. Broken legacy regexes block (not skip) — a rule we cannot
  // run is a rule we cannot trust.
  const legacyPath = join(toplevel, '.pre-push-patterns');
  if (existsSync(legacyPath)) {
    try {
      readFileSync(legacyPath, 'utf8').split('\n').forEach((raw, i) => {
        const src = raw.trim();
        if (!src || src.startsWith('#')) return;
        try {
          rules.forbidden.push({
            re: new RegExp(src, PRIVATE_RULE_FLAGS),
            index: rules.forbidden.length + 1,
            source: src,
          });
        } catch {
          throw new ConfigError(
            `legacy .pre-push-patterns line ${i + 1} is not a valid regular expression`,
            [`migrate the line into ${RULES_BASENAME} with --install-rules, fixing the syntax`],
          );
        }
      });
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      throw new ConfigError(`legacy .pre-push-patterns present but not readable (${e.code ?? e.message})`);
    }
  }
  return rules;
}

/** Everything the output layer needs to strip private values from any text. */
function makeRedactor(rules) {
  const home = /\/(?:Users|home)\/[A-Za-z0-9_][A-Za-z0-9_.-]*\//g;
  const winHome = /[A-Za-z]:\\Users\\[^\\/"'\s]+\\/g;
  const secrets = [
    ...GENERIC_RULES.map(([, re]) => new RegExp(re.source, 'g')),
    ...(rules?.forbidden ?? []).map((r) => new RegExp(r.re.source, 'g')),
  ];
  return (text) => {
    let s = String(text);
    s = s.replace(home, (m) => (m.startsWith('/Users') ? '/Users/<redacted>/' : '/home/<redacted>/'));
    s = s.replace(winHome, (m) => `${m.slice(0, 2)}\\Users\\<redacted>\\`);
    for (const re of secrets) s = s.replace(re, '<redacted>');
    return s;
  };
}

/* ----------------------------------------------------------- push parsing */

/**
 * Parse the pre-push hook stdin lines (one "<local_ref> <local_sha>
 * <remote_ref> <remote_sha>" per pushed ref) into descriptors. Deletions
 * (all-zero local sha) push no objects; a new remote ref (all-zero remote
 * sha) must have its whole reachable history scanned.
 */
export function parsePushLines(stdinText) {
  const refs = [];
  for (const line of String(stdinText).split('\n').map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (!OID_RE.test(localSha) && !ZERO_SHA.test(localSha)) continue;
    if (!OID_RE.test(remoteSha) && !ZERO_SHA.test(remoteSha)) continue;
    const kind = ZERO_SHA.test(localSha) ? 'delete' : ZERO_SHA.test(remoteSha) ? 'new' : 'update';
    refs.push({ localRef, localSha, remoteRef, remoteSha, kind });
  }
  return refs;
}

/** Resolve a manual `A..B` / `A...B` / single-rev argument. */
export function rangeToPosNeg(range) {
  const tri = range.indexOf('...');
  if (tri >= 0) return { positives: [range.slice(tri + 3)], negatives: [range.slice(0, tri)] };
  const duo = range.indexOf('..');
  if (duo >= 0) return { positives: [range.slice(duo + 2)], negatives: [range.slice(0, duo)] };
  return { positives: [range], negatives: [] };
}

/* -------------------------------------------------------------- git plumbing */

/**
 * List every object newly reachable from `positives` but not from
 * `negatives` (commits, tags, trees, blobs — each OID once). Uses
 * --no-object-names so paths containing newlines cannot corrupt the OID
 * stream; authoritative paths come from parsing tree objects directly.
 * Callers only pass negatives verified to exist locally (objectExistsBatch).
 */
function listNewObjects(git, positives, negatives) {
  const args = ['rev-list', '--objects', '--no-object-names', ...positives];
  for (const n of negatives) args.push('--not', n);
  let out;
  try {
    out = git(...args);
  } catch (e) {
    throw new ScanError(`cannot enumerate outgoing objects (${e.message.split('\n')[0]})`);
  }
  return [...new Set(out.split('\n').map((l) => l.trim()).filter((l) => OID_RE.test(l)))];
}

function objectExistsBatch(git, revs) {
  const present = new Set();
  if (revs.length === 0) return present;
  const out = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    cwd: git.cwd,
    input: revs.join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  for (const line of out.split('\n')) {
    const [oid, type] = line.trim().split(/\s+/);
    if (oid && type && type !== 'missing') present.add(oid);
  }
  return present;
}

/**
 * Live heads+tags of the remote being pushed to — refs/heads and refs/tags
 * only, never refs/pull/* (those can still point at pre-cleanup history on
 * GitHub) and never local remote-tracking refs (stale after a server-side
 * rewrite; excluding by them would wave old history through).
 */
function liveRemoteTips(git, remote) {
  if (!remote) return { ok: false, reason: 'no remote argument' };
  let out;
  try {
    out = execFileSync('git', ['ls-remote', '--heads', '--tags', '--', remote], {
      cwd: git.cwd,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      timeout: 30_000,
    });
  } catch (e) {
    return { ok: false, reason: String(e.stderr ?? e.message ?? e).split('\n')[0] };
  }
  const oids = [];
  for (const line of out.split('\n')) {
    const [oid] = line.trim().split(/\s+/);
    if (oid && OID_RE.test(oid)) oids.push(oid);
  }
  return { ok: true, oids };
}

/**
 * Streaming `git cat-file --batch` over `oids`; `onObject(oid, type, buffer)`
 * per object. Memory is bounded by the largest single object, not the sum.
 */
function catFileBatch(git, oids, onObject) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (oids.length === 0) {
      resolvePromise();
      return;
    }
    const child = spawn('git', ['cat-file', '--batch'], { cwd: git.cwd });
    let chunks = [];
    let total = 0;
    let pending = null;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      rejectPromise(err);
    };
    const take = (n) => {
      const outBuf = Buffer.allocUnsafe(n);
      let off = 0;
      while (off < n) {
        const c = chunks[0];
        const need = n - off;
        if (c.length <= need) {
          c.copy(outBuf, off);
          off += c.length;
          chunks.shift();
        } else {
          c.copy(outBuf, off, 0, need);
          chunks[0] = c.subarray(need);
          off += need;
        }
      }
      total -= n;
      return outBuf;
    };
    const findNewline = () => {
      let base = 0;
      for (const c of chunks) {
        const i = c.indexOf(10);
        if (i >= 0) return base + i;
        base += c.length;
      }
      return -1;
    };
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      chunks.push(chunk);
      total += chunk.length;
      for (;;) {
        if (!pending) {
          const nl = findNewline();
          if (nl < 0) break;
          const header = take(nl + 1).toString('utf8').slice(0, -1);
          if (/^[0-9a-f]{40,64} missing$/.test(header)) {
            // An enumerated object we cannot read is a hard stop, never a skip.
            fail(new ScanError(`object ${header.split(' ')[0].slice(0, 8)} reported missing — cannot inspect it, refusing to clear`));
            return;
          }
          const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header);
          if (!m) {
            fail(new ScanError(`unexpected cat-file output (${header.length} bytes, content withheld)`));
            return;
          }
          pending = { oid: m[1], type: m[2], size: Number(m[3]) };
        }
        if (total < pending.size + 1) break;
        const body = take(pending.size);
        take(1); // trailing newline
        const { oid, type } = pending;
        pending = null;
        try {
          onObject(oid, type, body);
        } catch (e) {
          fail(e);
          return;
        }
      }
    });
    child.on('error', (e) => fail(new ScanError(`cannot run git cat-file (${e.message})`)));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new ScanError('git cat-file exited non-zero — cannot inspect outgoing objects, refusing to clear'));
        return;
      }
      if (pending || total > 0) {
        fail(new ScanError('git cat-file output ended mid-object — refusing to clear'));
        return;
      }
      settled = true;
      resolvePromise();
    });
    child.stdin.on('error', () => {
      /* EPIPE if git died; the close handler reports */
    });
    child.stdin.write(oids.join('\n') + '\n');
    child.stdin.end();
  });
}

/* ------------------------------------------------------------- raw parsers */

function parseCommitObject(buf) {
  const text = buf.toString('utf8');
  const nl = text.indexOf('\n\n');
  const header = nl >= 0 ? text.slice(0, nl) : text;
  const message = nl >= 0 ? text.slice(nl + 2) : '';
  const people = {};
  let rootTree = null;
  const parents = [];
  for (const line of header.split('\n')) {
    if (line.startsWith(' ')) continue; // continuation (gpgsig etc.)
    const author = /^author (.*) <([^>]*)>/.exec(line);
    if (author) people.author = { name: author[1], email: author[2] };
    const committer = /^committer (.*) <([^>]*)>/.exec(line);
    if (committer) people.committer = { name: committer[1], email: committer[2] };
    const t = /^tree ([0-9a-f]+)$/.exec(line);
    if (t) rootTree = t[1];
    const p = /^parent ([0-9a-f]+)$/.exec(line);
    if (p) parents.push(p[1]);
  }
  return { people, message, rootTree, parents };
}

function parseTagObject(buf) {
  const text = buf.toString('utf8');
  const nl = text.indexOf('\n\n');
  const header = nl >= 0 ? text.slice(0, nl) : text;
  const message = nl >= 0 ? text.slice(nl + 2) : '';
  const tagger = /^tagger (.*) <([^>]*)>/m.exec(header);
  const tagged = /^object ([0-9a-f]+)$/m.exec(header);
  return {
    tagger: tagger ? { name: tagger[1], email: tagger[2] } : null,
    tagged: tagged ? tagged[1] : null,
    message,
  };
}

/**
 * Raw tree object: repeated `<mode> <name>\0<oid bytes>` — unambiguous for
 * any path bytes (newline, space, non-ASCII) and the only source of truth
 * for path names, since rev-list was asked not to print them.
 */
function parseTreeObject(buf, oidHexLen) {
  const entries = [];
  const oidBytes = oidHexLen / 2;
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp < 0) throw new ScanError('malformed tree object (no mode separator)');
    const mode = buf.toString('utf8', i, sp);
    const nul = buf.indexOf(0, sp + 1);
    if (nul < 0) throw new ScanError('malformed tree object (unterminated name)');
    if (nul + 1 + oidBytes > buf.length) throw new ScanError('malformed tree object (truncated oid)');
    entries.push({ mode, name: buf.toString('utf8', sp + 1, nul), oid: buf.toString('hex', nul + 1, nul + 1 + oidBytes) });
    i = nul + 1 + oidBytes;
  }
  return entries;
}

/* ------------------------------------------------------------------ scan */

function matchAll(ruleset, text) {
  const hits = [];
  for (const rule of ruleset) {
    const m = rule.re.exec(text);
    if (m) hits.push({ rule, index: m.index });
  }
  return hits;
}

function genericHits(text) {
  const hits = [];
  for (const [name, re] of GENERIC_RULES) {
    const m = re.exec(text);
    if (m) hits.push({ name, index: m.index });
  }
  return hits;
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function isBinary(buf) {
  return buf.includes(0, 0, Math.min(buf.length, 8000));
}

/** Strip home dirs and configured secrets from short strings we still print. */
function redactSafe(text) {
  return String(text).replace(/\/(?:Users|home)\/[A-Za-z0-9_][A-Za-z0-9_.-]*\//g, (m) =>
    m.startsWith('/Users') ? '/Users/<redacted>/' : '/home/<redacted>/',
  );
}

async function runScan({ mode, remote, rangesArg, stdinText }) {
  const { toplevel, commonDir } = repoPaths();
  const git = makeGit(toplevel);

  let rules;
  try {
    rules = loadRules({ commonDir, toplevel });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`pre-push-check: CANNOT CONCLUDE — ${redactSafe(e.message)}`);
      for (const p of e.problems ?? []) console.error(`  - ${p}`);
      console.error(`  Fix: node scripts/pre-push-check.mjs --install-rules  (then edit ${displayPath(rulesPath(commonDir))})`);
      console.error('  A push without usable private rules is refused — a missing rule file must not silently become "no rules".');
      process.exit(EXIT_CANNOT_CONCLUDE);
    }
    throw e;
  }
  const redact = makeRedactor(rules);

  // Effective identity: a correct config does not clear the push (metadata is
  // still checked object by object) — but a wrong effective email means the
  // NEXT commits will be wrong, so stop here as well.
  const identRaw = git.try('var', 'GIT_COMMITTER_IDENT') ?? '';
  const identEmail = /<([^>]*)>/.exec(identRaw)?.[1] ?? '';
  if (!rules.selfEmails.has(identEmail.toLowerCase())) {
    console.error('pre-push-check: CANNOT CONCLUDE — effective committer identity is not an allowed self address.');
    console.error('  git config user.email currently produces a non-noreply identity (value withheld; run  git var GIT_COMMITTER_IDENT  to see it).');
    console.error(`  Set it to the GitHub noreply address listed in [self-emails] of ${displayPath(rulesPath(commonDir))}, or extend that section if the address is a legitimate self address.`);
    process.exit(EXIT_CANNOT_CONCLUDE);
  }

  // --- what is being pushed -------------------------------------------
  let positives = [];
  let negatives = [];
  const refSummary = [];

  if (mode === 'hook') {
    const refs = parsePushLines(stdinText ?? '');
    if ((stdinText ?? '').trim() !== '' && refs.length === 0) {
      console.error('pre-push-check: CANNOT CONCLUDE — hook stdin carried lines but none parsed as ref lines.');
      process.exit(EXIT_CANNOT_CONCLUDE);
    }
    const carrying = refs.filter((r) => r.kind !== 'delete');
    const deleting = refs.length - carrying.length;
    if (refs.length > 0 && carrying.length === 0) {
      // Deletions push no objects — and must NOT fall back to "scan @{u}..HEAD":
      // that would judge (and possibly block) content that is not being pushed.
      console.log(`pre-push-check: ${deleting} ref deletion(s) only — no objects leave the machine, ok`);
      process.exit(EXIT_CLEAN);
    }
    for (const r of carrying) {
      refSummary.push(`${redact(r.remoteRef)} ${r.kind === 'new' ? '(new remote ref)' : '(update)'}`);
      positives.push(r.localSha);
      if (r.kind === 'update') negatives.push(r.remoteSha);
    }
    if (deleting > 0) refSummary.push(`${deleting} deletion(s) (no objects)`);
    if (refs.some((r) => r.kind === 'new')) {
      const live = liveRemoteTips(git, remote);
      if (live.ok) {
        const present = objectExistsBatch(git, live.oids);
        if (present.size > 0) negatives.push(...present);
        console.log(`pre-push-check: new remote ref(s) — excluding objects reachable from ${present.size} live remote tip(s) of "${redact(remote)}"`);
      } else {
        console.log(`pre-push-check: could not list live remote tips (${redact(live.reason)}) — scanning the full history of new remote ref(s) instead`);
      }
    }
  } else {
    // Manual mode accepts several space-separated revs/ranges (e.g.
    // "--range --branches --tags --remotes" to audit the pushable surface).
    positives = [];
    negatives = [];
    for (const token of rangesArg.split(/\s+/).filter(Boolean)) {
      const p = rangeToPosNeg(token);
      positives.push(...p.positives);
      negatives.push(...p.negatives);
    }
    refSummary.push(`manual range ${redact(rangesArg)}`);
  }

  // Negatives must exist locally; one that does not (remote moved past what
  // we have, forced update) cannot exclude anything — scan those refs in full.
  const presentNegatives = objectExistsBatch(git, negatives);
  const verifiedNegatives = negatives.filter((n) => presentNegatives.has(n));
  if (negatives.length !== verifiedNegatives.length) {
    console.log('pre-push-check: some advertised remote tips are not present locally (stale fetch or forced update) — scanning those refs in full');
  }
  negatives = verifiedNegatives;

  let oids;
  try {
    oids = listNewObjects(git, positives, negatives);
  } catch (e) {
    console.error(`pre-push-check: CANNOT CONCLUDE — ${redact(e.message)}`);
    process.exit(EXIT_CANNOT_CONCLUDE);
  }

  const counts = { commit: 0, tag: 0, tree: 0, blob: 0 };
  const commits = [];
  const tags = [];
  const trees = new Map(); // oid -> entries (new trees only, by construction)
  const blobHits = []; // {oid, binary, findings:[{category, detail, line}]}
  const symlinkBlobs = new Set();
  const gitlinks = [];
  const scanProblems = [];
  const thirdParty = new Set();

  const checkPerson = (person, what, collect) => {
    if (!person) return;
    const email = person.email ?? '';
    const name = person.name ?? '';
    for (const { rule } of matchAll(rules.forbidden, `${name} <${email}>`)) {
      collect({ category: 'identity/forbidden', detail: `${what} matched private rule #${rule.index}` });
      return;
    }
    if (rules.selfNames.has(name.toLowerCase()) && !rules.selfEmails.has(email.toLowerCase())) {
      collect({ category: 'identity/self-not-noreply', detail: `${what} carries a self name with a non-noreply address` });
      return;
    }
    if (!GITHUB_NOREPLY_EMAIL.test(email) && !rules.selfEmails.has(email.toLowerCase())) {
      thirdParty.add(email.toLowerCase());
    }
  };

  const oidHexLen = oids.some((o) => o.length === 64) ? 64 : 40;

  if (oids.length > 0) {
    await catFileBatch(git, oids, (oid, type, buf) => {
      counts[type] = (counts[type] ?? 0) + 1;
      if (type === 'commit') {
        const c = parseCommitObject(buf);
        const findings = [];
        checkPerson(c.people.author, 'author', (f) => findings.push(f));
        checkPerson(c.people.committer, 'committer', (f) => findings.push(f));
        for (const { rule, index } of matchAll(rules.forbidden, c.message)) {
          findings.push({ category: 'message/forbidden', detail: `matched private rule #${rule.index}`, line: lineNumber(c.message, index) });
        }
        for (const { name, index } of genericHits(c.message)) {
          findings.push({ category: `message/generic:${name}`, detail: 'matched generic rule', line: lineNumber(c.message, index) });
        }
        commits.push({ oid, findings, rootTree: c.rootTree });
      } else if (type === 'tag') {
        const t = parseTagObject(buf);
        const findings = [];
        checkPerson(t.tagger, 'tagger', (f) => findings.push(f));
        for (const { rule, index } of matchAll(rules.forbidden, t.message)) {
          findings.push({ category: 'tag-message/forbidden', detail: `matched private rule #${rule.index}`, line: lineNumber(t.message, index) });
        }
        for (const { name, index } of genericHits(t.message)) {
          findings.push({ category: `tag-message/generic:${name}`, detail: 'matched generic rule', line: lineNumber(t.message, index) });
        }
        tags.push({ oid, findings });
      } else if (type === 'tree') {
        trees.set(oid, parseTreeObject(buf, oidHexLen));
      } else if (type === 'blob') {
        const text = buf.toString('utf8');
        const findings = [];
        for (const { rule, index } of matchAll(rules.forbidden, text)) {
          findings.push({ category: 'content/forbidden', detail: `matched private rule #${rule.index}`, line: lineNumber(text, index) });
          break; // one finding per class is enough to block
        }
        for (const { name, index } of genericHits(text)) {
          findings.push({ category: `content/generic:${name}`, detail: 'matched generic rule', line: lineNumber(text, index) });
          break;
        }
        if (findings.length > 0) blobHits.push({ oid, binary: isBinary(buf), findings });
      } else {
        scanProblems.push(`object ${oid.slice(0, 8)} has unexpected type "${type}"`);
      }
    });
  }

  // --- path labels: walk new trees from new commits' roots --------------
  // A blob new to the remote sits under at least one NEW tree (an unchanged
  // tree would make it reachable from the negatives), so descending only
  // into new trees still labels every new blob. Old subtrees contain
  // nothing new and are skipped.
  const label = new Map(); // oid -> first path
  const pathFindings = []; // {oid, path, findings, pathSensitive}
  const walkQueue = commits.map((c) => ({ oid: c.rootTree, prefix: '' }));
  const walked = new Set();
  while (walkQueue.length > 0) {
    const { oid, prefix } = walkQueue.shift();
    if (!oid || walked.has(oid)) continue;
    walked.add(oid);
    const entries = trees.get(oid);
    if (!entries) continue; // old tree — nothing new inside
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (!label.has(e.oid)) label.set(e.oid, path);
      const isTree = e.mode === '40000' || e.mode === '040000';
      const isSymlink = e.mode === '120000';
      const isGitlink = e.mode === '160000';
      if (isTree && trees.has(e.oid)) walkQueue.push({ oid: e.oid, prefix: path });
      if (isSymlink) symlinkBlobs.add(e.oid);
      if (isGitlink) gitlinks.push(path);
      if (isTree || isGitlink) continue;
      const hits = [
        ...matchAll(rules.forbidden, path).map(({ rule }) => ({ category: 'path/forbidden', detail: `matched private rule #${rule.index}` })),
        ...matchAll(rules.forbiddenPaths, path).map(({ rule }) => ({ category: 'path/forbidden-path', detail: `matched private path rule #${rule.index}` })),
        ...genericHits(path).map(({ name }) => ({ category: `path/generic:${name}`, detail: 'matched generic rule' })),
      ];
      if (hits.length > 0) {
        pathFindings.push({ oid: e.oid, path, findings: hits, pathSensitive: true });
      }
    }
  }

  // --- symlink targets -------------------------------------------------
  const symlinkFindings = [];
  if (symlinkBlobs.size > 0) {
    await catFileBatch(git, [...symlinkBlobs], (oid, type, buf) => {
      if (type !== 'blob') return;
      const target = buf.toString('utf8');
      const hits = [
        ...matchAll(rules.forbidden, target).map(({ rule }) => ({ category: 'symlink/forbidden', detail: `matched private rule #${rule.index}` })),
        ...matchAll(rules.forbiddenPaths, target).map(({ rule }) => ({ category: 'symlink/forbidden-path', detail: `matched private path rule #${rule.index}` })),
        ...genericHits(target).map(({ name }) => ({ category: `symlink/generic:${name}`, detail: 'matched generic rule' })),
      ];
      if (hits.length > 0) symlinkFindings.push({ oid, path: label.get(oid), findings: hits });
    });
  }

  // --- ignored-but-tracked paths (git add -f protection) ---------------
  // .gitignore is the single source of truth: a NEW tree path that today's
  // rules would ignore can only have arrived via `git add -f` (or predates
  // the rule — worth investigating either way).
  const filePaths = [...new Set([...symlinkBlobs].map((o) => label.get(o)))].filter(Boolean);
  for (const [oid, path] of label) {
    if (!symlinkBlobs.has(oid) && trees.has(oid)) continue; // trees handled below
    if (!trees.has(oid)) filePaths.push(path);
  }
  const treePaths = [...new Set([...trees.keys()].map((o) => label.get(o)))].filter(Boolean);
  const ignoredFindings = [];
  const checkIgnored = (paths) => {
    if (paths.length === 0) return;
    let out;
    try {
      out = execFileSync('git', ['check-ignore', '--no-index', '-z', '-v', '-n', '--stdin'], {
        cwd: toplevel,
        input: paths.join('\0') + '\0',
        maxBuffer: 1024 * 1024 * 64,
      });
    } catch (e) {
      // Exit 1 is check-ignore's "nothing matched" — a legitimate result,
      // not a failure. Anything else (128…) means the check itself broke.
      if (e.status === 1) return;
      throw new ScanError(`git check-ignore failed (${String(e.stderr ?? e.message).split('\n')[0]})`);
    }
    const fields = out.toString('utf8').split('\0');
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const [src, linenum, pat, path] = fields.slice(i, i + 4);
      if (!pat || pat.startsWith('!')) continue; // no rule, or negated rule
      ignoredFindings.push({ path, rule: `${src}:${linenum}` });
    }
  };
  checkIgnored(filePaths);
  checkIgnored(treePaths.map((p) => `${p}/`)); // dir rules only match with the slash

  // --- report -----------------------------------------------------------
  const report = [];
  const seenReport = new Set();
  const addFinding = (where, f) => {
    const key = `${where}│${f.category}│${f.detail}│${f.line ?? ''}`;
    if (seenReport.has(key)) return;
    seenReport.add(key);
    report.push({ where, ...f });
  };
  for (const c of commits) for (const f of c.findings) addFinding(`commit ${c.oid.slice(0, 8)}`, f);
  for (const t of tags) for (const f of t.findings) addFinding(`tag object ${t.oid.slice(0, 8)}`, f);
  for (const p of pathFindings) {
    for (const f of p.findings) addFinding(`path <redacted path, ${p.path.length} chars>`, f);
  }
  for (const s of symlinkFindings) {
    const where = `symlink ${s.path ? redact(s.path) : `target of oid ${s.oid.slice(0, 8)}`}`;
    for (const f of s.findings) addFinding(where, f);
  }
  for (const b of blobHits) {
    const isLink = symlinkBlobs.has(b.oid);
    if (isLink) continue; // already reported (with the same rules) by the symlink-target pass
    const where = `file ${label.get(b.oid) ? redact(label.get(b.oid)) : `oid ${b.oid.slice(0, 8)} (path unknown)`}`;
    for (const f of b.findings) {
      addFinding(`${where}${b.binary ? ' (binary blob, scanned as raw bytes)' : ''}`, f);
    }
  }
  for (const ig of ignoredFindings) {
    addFinding(`path ${redact(ig.path)}`, {
      category: 'path/ignored-by-gitignore',
      detail: `matches ignore rule ${redact(ig.rule)} — ignored files must never be tracked; if this is a legit public file, rename it or narrow the rule`,
    });
  }

  if (scanProblems.length > 0) {
    console.error('pre-push-check: CANNOT CONCLUDE — unexpected objects in the outgoing set:');
    for (const p of scanProblems.slice(0, 5)) console.error(`  - ${redact(p)}`);
    process.exit(EXIT_CANNOT_CONCLUDE);
  }

  console.log(
    `pre-push-check: ${refSummary.join(', ')} → ${counts.commit} commit(s), ${counts.tag} tag object(s), ${counts.tree} tree(s), ${counts.blob} blob(s) scanned` +
      (gitlinks.length > 0 ? `; ${gitlinks.length} submodule gitlink(s) not inspectable (noted)` : ''),
  );
  if (thirdParty.size > 0) {
    console.log(`pre-push-check: ${thirdParty.size} third-party identit${thirdParty.size === 1 ? 'y' : 'ies'} in metadata allowed through (not self, not forbidden)`);
  }

  if (report.length > 0) {
    console.error(`pre-push-check: BLOCKED — ${report.length} finding(s) in outgoing objects (values sanitized):`);
    for (const f of report.slice(0, 15)) {
      console.error(`  [${f.category}] ${f.where}${f.line ? ` line ${f.line}` : ''} — ${f.detail}`);
    }
    if (report.length > 15) console.error(`  … and ${report.length - 15} more`);
    console.error('  Output is sanitized on purpose: locally run  git cat-file -p <object>  on the named object to see the matched text.');
    console.error('  Deleting the file in a follow-up commit (or reverting) does NOT remove it from history — the blob stays reachable and would still be pushed.');
    console.error('  Fix by rewriting the affected commits (amend/rebase, or git-filter-repo for many), then push again.');
    process.exit(EXIT_FINDINGS);
  }

  console.log(`pre-push-check: ${oids.length} outgoing object(s) clean ✓ (blobs scanned as raw UTF-8 bytes; compressed/encoded payloads inside binaries are not decoded)`);
  process.exit(EXIT_CLEAN);
}

/* -------------------------------------------------------------- doctor */

function runDoctor() {
  const { toplevel, commonDir } = repoPaths();
  const git = makeGit(toplevel);
  const problems = [];
  const lines = [];
  const ok = (b) => (b ? '✓' : '✗');

  lines.push(`repository      : ${displayPath(toplevel)}  (common dir ${displayPath(commonDir)})`);
  const gitVersion = (git.try('--version') ?? 'unknown').replace('git version ', '');
  const [maj, min] = gitVersion.split('.').map((n) => parseInt(n, 10));
  const versionOk = !Number.isNaN(maj) && (maj > 2 || (maj === 2 && min >= 27));
  lines.push(`git             : ${gitVersion} ${ok(versionOk)} (needs ≥ 2.27 for --no-object-names)`);
  if (!versionOk) problems.push('git older than 2.27 cannot run the object scan — upgrade git');

  const hooksDirRaw = git.try('rev-parse', '--git-path', 'hooks');
  const hookPath = hooksDirRaw ? join(resolve(toplevel, hooksDirRaw), 'pre-push') : null;
  let hookOk = false;
  if (hookPath && existsSync(hookPath)) {
    try {
      const src = readFileSync(hookPath, 'utf8');
      const execBit = (statSync(hookPath).mode & 0o111) !== 0;
      hookOk = src.includes('pre-push-check.mjs') && execBit;
      lines.push(
        `hook            : ${displayPath(hookPath)} ${src.includes('pre-push-check.mjs') ? 'references checker' : 'does NOT reference the checker'}${execBit ? ', executable' : ', NOT executable'} ${ok(hookOk)}`,
      );
    } catch {
      lines.push(`hook            : ${displayPath(hookPath)} not readable ✗`);
    }
  } else {
    lines.push(`hook            : missing ${hookPath ? `(${displayPath(hookPath)})` : '(hooks dir unknown)'} ✗`);
  }
  if (!hookOk) problems.push('pre-push hook missing/not executable — run scripts/install-hooks.sh');

  const rp = rulesPath(commonDir);
  let rules = null;
  if (existsSync(rp)) {
    try {
      const st = statSync(rp);
      const mode = `0${(st.mode & 0o777).toString(8)}`;
      const loose = (st.mode & 0o077) !== 0;
      rules = parseRulesText(readFileSync(rp, 'utf8'), RULES_BASENAME);
      lines.push(
        `shared rules    : ${displayPath(rp)} ✓ mode ${mode}${loose ? ' (group/other readable — tighten to 0600)' : ''}  forbidden=${rules.forbidden.length} forbidden-paths=${rules.forbiddenPaths.length} self-names=${rules.selfNames.size} self-emails=${rules.selfEmails.size}`,
      );
    } catch (e) {
      if (e instanceof ConfigError) {
        lines.push(`shared rules    : ${displayPath(rp)} INVALID ✗`);
        for (const p of e.problems ?? []) problems.push(p);
      } else {
        lines.push(`shared rules    : ${displayPath(rp)} not readable ✗`);
        problems.push('private rules file not readable — check permissions');
      }
    }
  } else {
    lines.push(`shared rules    : ${displayPath(rp)} MISSING ✗`);
    problems.push('no shared private rules — run  node scripts/pre-push-check.mjs --install-rules');
  }

  const legacyPath = join(toplevel, '.pre-push-patterns');
  if (existsSync(legacyPath)) {
    try {
      const legacy = readFileSync(legacyPath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      const sharedSources = new Set((rules?.forbidden ?? []).map((r) => r.source));
      const missing = legacy.filter((s) => !sharedSources.has(s));
      lines.push(
        `legacy patterns : ${displayPath(legacyPath)} present (${legacy.length} rule(s)) — ${missing.length === 0 ? 'all covered by shared rules ✓' : `${missing.length} NOT in shared rules ✗ (run --install-rules to migrate)`}`,
      );
      if (missing.length > 0) problems.push(`${missing.length} legacy pattern(s) not yet migrated into the shared rules`);
    } catch {
      lines.push(`legacy patterns : ${displayPath(legacyPath)} not readable ✗`);
      problems.push('legacy .pre-push-patterns not readable — fix permissions or remove the file after migrating');
    }
  } else {
    lines.push('legacy patterns : none (clean)');
  }

  const ident = git.try('var', 'GIT_COMMITTER_IDENT') ?? '';
  const identEmail = /<([^>]*)>/.exec(ident)?.[1] ?? '';
  const identOk = rules ? rules.selfEmails.has(identEmail.toLowerCase()) : false;
  lines.push(`effective ident : committer email ${identOk ? 'allowed ✓' : 'NOT an allowed self address ✗ (value withheld; see  git var GIT_COMMITTER_IDENT )'}`);
  if (rules && !identOk) problems.push('effective committer email is not in [self-emails]');

  console.error(lines.join('\n'));
  if (problems.length > 0) {
    console.error('NOT READY:');
    for (const p of problems) console.error(`  - ${displayPath(p).replace(/(\/(?:Users|home)\/)[^\s/]+/g, '$1<redacted>')}`);
    process.exit(1);
  }
  console.error('READY');
  process.exit(0);
}

/* -------------------------------------------------------- install-rules */

function runInstallRules() {
  const { toplevel, commonDir } = repoPaths();
  const git = makeGit(toplevel);
  const infoDir = join(commonDir, 'info');
  const rp = rulesPath(commonDir);

  // Legacy rules from BOTH the current worktree and the main tree (the
  // shared file serves both; a worktree-only or main-tree-only legacy file
  // must not lose its rules in the migration).
  const collectLegacy = () => {
    const seen = new Set();
    const sources = [];
    for (const root of [toplevel, dirname(commonDir)]) {
      const lp = join(root, '.pre-push-patterns');
      if (!existsSync(lp)) continue;
      for (const raw of readFileSync(lp, 'utf8').split('\n')) {
        const s = raw.trim();
        if (!s || s.startsWith('#') || seen.has(s)) continue;
        seen.add(s);
        sources.push(s);
      }
    }
    return sources;
  };

  if (existsSync(rp)) {
    // Never overwrite user-edited rules: only APPEND legacy rules that are
    // not present yet, and only after keeping a timestamped backup.
    const before = readFileSync(rp, 'utf8');
    let known = new Set();
    let parseErr = null;
    try {
      known = new Set(parseRulesText(before, RULES_BASENAME).forbidden.map((r) => r.source));
    } catch (e) {
      if (e instanceof ConfigError) parseErr = e;
      else throw e;
    }
    const toAdd = collectLegacy().filter((s) => !known.has(s));
    if (parseErr) {
      console.log(`install-rules: ${displayPath(rp)} has pre-existing problems — NOT modified (fix them by hand):`);
      for (const p of parseErr.problems ?? []) console.log(`  - ${p}`);
      if (toAdd.length > 0) console.log(`install-rules: ${toAdd.length} legacy rule(s) also pending migration once the file is valid`);
      return;
    }
    if (toAdd.length === 0) {
      console.log(`install-rules: shared rules already present and cover all legacy patterns — left unchanged (${displayPath(rp)})`);
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const bak = `${rp}.bak-${stamp}`;
    copyFileSync(rp, bak);
    chmodSync(bak, 0o600);
    const note = `# migrated from worktree .pre-push-patterns on ${new Date().toISOString().slice(0, 10)}\n[forbidden]\n${toAdd.join('\n')}\n`;
    writeFileSync(rp, `${before.replace(/\s*$/, '\n')}${note}`, { mode: 0o600 });
    chmodSync(rp, 0o600);
    console.log(`install-rules: kept a backup at ${displayPath(bak)}; appended ${toAdd.length} legacy rule(s) to ${displayPath(rp)}`);
    return;
  }

  const ident = git.try('var', 'GIT_COMMITTER_IDENT') ?? '';
  const identEmail = /<([^>]*)>/.exec(ident)?.[1] ?? '';
  const identName = (/^([^<]+?)\s*</.exec(ident)?.[1] ?? '').trim();
  const legacy = collectLegacy();
  const noreply = GITHUB_NOREPLY_EMAIL.test(identEmail) ? identEmail : '';
  const selfName = identName && !identName.toLowerCase().startsWith('unknown') ? identName : '';
  const body = `# PathBlender private privacy rules — LOCAL ONLY, never commit, never quote in logs.
# Shared by every worktree of this repository (lives under the common git dir).
# Sections:
#   [forbidden]       one RegExp source per line (case-insensitive) — never-leave-machine values;
#                     applied to commit/tag metadata, messages, paths, symlink targets, file contents
#   [forbidden-paths] one RegExp source per line — applied to tree paths and symlink targets only
#   [self-names]      literal names (case-insensitive) identifying YOUR commits
#   [self-emails]     literal addresses allowed for YOUR commits (GitHub noreply)
[forbidden]
${legacy.join('\n')}
[forbidden-paths]
[self-names]
${selfName}
[self-emails]
${noreply}
`;
  mkdirSync(infoDir, { recursive: true });
  writeFileSync(rp, body, { mode: 0o600 });
  chmodSync(rp, 0o600);
  console.log(`install-rules: created ${displayPath(rp)}`);
  console.log(
    `install-rules: prefilled ${legacy.length} forbidden rule(s) from legacy .pre-push-patterns; self-name ${selfName ? 'from git config' : '(none — fill in)'}; self-email ${noreply ? 'from git config (GitHub noreply)' : '(git config is not a noreply address — set user.email, then fill in)'}`,
  );
  console.log('install-rules: REQUIRED before pushing: at least one [forbidden] rule and a non-empty [self-emails] — check with  node scripts/pre-push-check.mjs --doctor');
}

/* ------------------------------------------------------------------ cli */

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const sanitize = (t) =>
    String(t)
      .replace(/\/(?:Users|home)\/[A-Za-z0-9_][A-Za-z0-9_.-]*\//g, (m) => m.replace(/(?<=\/(?:Users|home)\/)[^/]+/, '<redacted>'))
      .split('\n')[0];
  try {
    if (args.includes('--doctor')) {
      runDoctor();
    } else if (args.includes('--install-rules')) {
      runInstallRules();
    } else if (args.includes('--range')) {
      const rangesArg = args[args.indexOf('--range') + 1];
      if (!rangesArg) {
        console.error('pre-push-check: --range needs a value (A..B or a single rev)');
        process.exit(EXIT_CANNOT_CONCLUDE);
      }
      await runScan({ mode: 'manual', rangesArg });
    } else if (!process.stdin.isTTY) {
      // Git pre-push passes <remote> <url> on argv and ref lines on stdin.
      // Empty stdin (never happens from git) falls back to the manual range
      // so bare invocations from scripts still scan something.
      const stdinText = readFileSync(0, 'utf8');
      if (stdinText.trim() === '') {
        const git = makeGit(process.cwd());
        const range = git.try('rev-parse', '@{u}') ? '@{u}..HEAD' : 'HEAD';
        console.log(`pre-push-check: manual run — scanning ${range}`);
        await runScan({ mode: 'manual', rangesArg: range });
      } else {
        await runScan({ mode: 'hook', remote: args[0] || '', stdinText });
      }
    } else {
      const git = makeGit(process.cwd());
      const range = git.try('rev-parse', '@{u}') ? '@{u}..HEAD' : 'HEAD';
      console.log(`pre-push-check: manual run — scanning ${range}`);
      await runScan({ mode: 'manual', rangesArg: range });
    }
  } catch (e) {
    console.error(`pre-push-check: CANNOT CONCLUDE — ${sanitize(e?.message ?? e)}`);
    if (e?.problems) for (const p of e.problems) console.error(`  - ${sanitize(p)}`);
    process.exit(EXIT_CANNOT_CONCLUDE);
  }
}

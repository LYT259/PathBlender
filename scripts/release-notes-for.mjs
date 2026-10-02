/**
 * Single source of user-facing release notes (2026-10-02): one composition
 * drives the GitHub Release body, the updater feed's `notes` field (via
 * bundle/RELEASE_NOTES.md + gen-latest-json.mjs) — and it is derived from the
 * same VERSION_NOTES registry the in-app About page shows (maintained by
 * bump-version.mjs). Commits/PR lists are a supplement appended by
 * `gh release create --generate-notes`, never the user explanation itself.
 *
 * Usage: node scripts/release-notes-for.mjs <version> [version-info.ts path]
 *   (the second argument is a test hook: run against a fixture registry
 *    instead of the real generated file; CI never passes it)
 *
 * A beta version prints its own note; a stable version aggregates every note
 * since the PREVIOUS stable (users upgrading stable→stable care about the
 * whole span, not the last commit). Both then append the fixed sections:
 * platforms & download, known issues (docs/release-notes/known-issues.md),
 * and how to update.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [versionArg, notesTsArg] = process.argv.slice(2);
if (!versionArg) {
  console.error('usage: release-notes-for.mjs <version> [version-info.ts path]');
  process.exit(1);
}
const version = versionArg.replace(/^v/, '');

const PRERELEASE = /-(?:alpha|beta|rc)[0-9A-Za-z.+-]*$/i;
const isStable = (v) => !PRERELEASE.test(v);

/** Parse "0.1.6-beta.3" → [[0,1,6], 'beta.3'] (stable → tag null). */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(v);
  if (!m) return null;
  return [[+m[1], +m[2], +m[3]], m[4] ?? null];
}
function cmpSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    if (pa[0][i] !== pb[0][i]) return pa[0][i] - pb[0][i];
  }
  // same triple: release > prerelease; two prereleases compare by tag text
  if (pa[1] === null) return pb[1] === null ? 0 : 1;
  if (pb[1] === null) return -1;
  return pa[1] < pb[1] ? -1 : pa[1] > pb[1] ? 1 : 0;
}

/** Extract the VERSION_NOTES registry from the generated version-info.ts. */
function readVersionNotes() {
  const ts = readFileSync(notesTsArg ? resolve(notesTsArg) : join(root, 'packages/web/src/version-info.ts'), 'utf-8');
  const entries = [];
  const re = /\{ version: '((?:\\.|[^'\\])*)', date: '((?:\\.|[^'\\])*)', note: '((?:\\.|[^'\\])*)' \}/g;
  for (const m of ts.matchAll(re)) {
    const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    entries.push({ version: unesc(m[1]), date: m[2], note: unesc(m[3]) });
  }
  if (entries.length === 0) throw new Error('no VERSION_NOTES entries parsed from version-info.ts');
  return entries; // newest-first (bump-version.mjs prepends)
}

const entries = readVersionNotes();

let selected;
if (isStable(version)) {
  // Aggregate everything newer than the previous stable release.
  const prevStableIdx = entries.findIndex(
    (e) => isStable(e.version) && cmpSemver(e.version, version) < 0,
  );
  selected = prevStableIdx === -1 ? entries : entries.slice(0, prevStableIdx);
} else {
  const own = entries.find((e) => e.version === version);
  if (!own) {
    console.error(`release-notes-for: no VERSION_NOTES entry for beta ${version} — run bump-version.mjs with a user-facing note first`);
    process.exit(1);
  }
  selected = [own];
}

const changes = selected
  .filter((e) => e.note.trim() !== '')
  .map((e) => `- v${e.version} (${e.date}): ${e.note.trim()}`);
const changesBlock =
  changes.length > 0
    ? changes.join('\n')
    : `- v${version}: improvements and fixes / 改进与修复（详见应用内关于页）`;

const knownIssuesPath = process.env.PB_KNOWN_ISSUES ? resolve(process.env.PB_KNOWN_ISSUES) : join(root, 'docs/release-notes/known-issues.md');
const knownIssues = existsSync(knownIssuesPath)
  ? readFileSync(knownIssuesPath, 'utf-8')
      // The file carries its own H1 and a maintainer-facing blockquote note;
      // the release body already provides the section heading, and the
      // maintenance note is not for users. Skip both (first seen doubled in
      // the v0.1.6-beta.22 release body).
      .split('\n')
      .filter((l) => !l.startsWith('# ') && !l.startsWith('> '))
      .join('\n')
      .trim()
  : '(none / 暂无)';

const dmg = `PathBlender_${version}_aarch64.dmg`;

console.log(`## What's new / 新变化

${changesBlock}

## Platforms & download / 平台与下载

- **macOS (Apple Silicon, 13.0+)** — download \`${dmg}\` from the assets below, open it, and drag PathBlender to Applications.
- **Windows / Linux** — installers are not provided yet; they are planned for a follow-up release. (The code is cross-platform; this release ships macOS only.)
- **网页版 / Web app** — not yet re-published for this version; the desktop app above is the current distribution.

## Known issues & limitations / 已知问题与限制

${knownIssues}

## How to update / 更新方法

- **Desktop app**: menu **PathBlender → Check for Updates…** (beta builds: enable the Beta channel in **Preferences → Updates** first), or simply download the dmg above and replace the app.
- Full per-version notes live inside the app: **PathBlender → About PathBlender**.
- 桌面版：菜单 **PathBlender → 检查更新…**（Beta 版先在 **偏好设置 → 更新** 打开 Beta 通道），或直接下载上方 dmg 覆盖安装。
`);

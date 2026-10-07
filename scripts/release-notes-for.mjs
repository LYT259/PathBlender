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
import { Converter } from 'opencc-js';
import translations from './release-notes-locales.json' with { type: 'json' };
const toHK = await Converter({ from: 'cn', to: 'hk' });

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
  const aa = pa[1].split('.'), bb = pb[1].split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === undefined) return -1;
    if (bb[i] === undefined) return 1;
    if (aa[i] === bb[i]) continue;
    const an = /^\d+$/.test(aa[i]), bn = /^\d+$/.test(bb[i]);
    if (an && bn) return Number(aa[i]) - Number(bb[i]);
    if (an !== bn) return an ? -1 : 1;
    return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

/** Extract the VERSION_NOTES registry from the generated version-info.ts. */
function readVersionNotes() {
  const ts = readFileSync(notesTsArg ? resolve(notesTsArg) : join(root, 'packages/web/src/version-info.ts'), 'utf-8');
  const entries = [];
  // New shape (2026-10-03): each entry carries a per-language note object.
  const re = /\{ version: '((?:\\.|[^'\\])*)', date: '((?:\\.|[^'\\])*)', note: \{\s*([\s\S]*?)\s*\} \}/g;
  for (const m of ts.matchAll(re)) {
    const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    const langVal = /(?:(?:'([a-z][a-z-]*)')|([a-z][a-z-]*))\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
    const note = {};
    for (const lm of m[3].matchAll(langVal)) note[lm[1] ?? lm[2]] = unesc(lm[4]);
    entries.push({ version: unesc(m[1]), date: m[2], note });
  }
  if (entries.length === 0) throw new Error('no VERSION_NOTES entries parsed from version-info.ts');
  return entries; // newest-first (bump-version.mjs prepends)
}

const entries = readVersionNotes();

let selected;
if (isStable(version)) {
  // Aggregate everything newer than the previous stable release.
  const eligible = entries.filter((e) => cmpSemver(e.version, version) <= 0);
  const previous = eligible.filter((e) => isStable(e.version) && cmpSemver(e.version, version) < 0)
    .sort((a, b) => cmpSemver(b.version, a.version))[0];
  selected = eligible.filter((e) => !previous || cmpSemver(e.version, previous.version) > 0);
} else {
  const own = entries.find((e) => e.version === version);
  if (!own) {
    console.error(`release-notes-for: no VERSION_NOTES entry for beta ${version} — run bump-version.mjs with a user-facing note first`);
    process.exit(1);
  }
  selected = [own];
}

const manifest = process.env.PB_RELEASE_ARTIFACTS
  ? JSON.parse(readFileSync(resolve(process.env.PB_RELEASE_ARTIFACTS), 'utf8')) : null;
if (manifest && manifest.version !== version) throw new Error('release artifact manifest version mismatch');
const assets = manifest ? [
  ['macos', manifest.macos.dmg], ['windows', manifest.windows.nsis],
  ['deb', manifest.linux.deb], ['appimage', manifest.linux.appimage], ['rpm', manifest.linux.rpm],
] : [['macosLegacy', `PathBlender_${version}_aarch64.dmg`]];
if (assets.some(([, name]) => typeof name !== 'string' || !/^[\w.+-]+$/.test(name))) throw new Error('invalid release artifact name');

const knownIssuesPath = process.env.PB_KNOWN_ISSUES ? resolve(process.env.PB_KNOWN_ISSUES) : join(root, 'docs/release-notes/known-issues.md');
if (!existsSync(knownIssuesPath)) throw new Error('known issues document is missing');
const issuesText = readFileSync(knownIssuesPath, 'utf8').split('\n')
  .filter((line) => !line.startsWith('# ') && !line.startsWith('> ')).join('\n').trim();
function issuesFor(lang) {
  if (!issuesText.includes('<!-- language:')) return lang === 'zh-hk' ? toHK(issuesText) : issuesText;
  const sections = Object.fromEntries([...issuesText.matchAll(/<!-- language: ([a-z-]+) -->\s*([\s\S]*?)(?=<!-- language:|$)/g)].map((m) => [m[1], m[2].trim()]));
  if (sections[lang]) return sections[lang];
  if (lang === 'zh-hk' && sections.zh) return toHK(sections.zh);
  throw new Error(`known issues translation missing: ${lang}`);
}
function render(lang) {
  const t = translations[lang];
  const changes = selected.filter((e) => e.note.en?.trim()).map((e) => {
    const text = lang === 'zh-hk' ? (e.note['zh-hk'] ?? (e.note.zh ? toHK(e.note.zh) : null)) : e.note[lang];
    if (!text?.trim()) throw new Error(`release note translation missing: ${e.version} ${lang}`);
    return `- v${e.version} (${e.date}): ${text.trim()}`;
  }).join('\n') || t.fallback;
  const downloads = assets.map(([platform, name]) => `- **${t.platforms[platform]}** — \`${name}\``).join('\n');
  return `## ${t.changes}\n\n${changes}\n\n## ${t.download}\n\n${downloads}\n\n${t.web}\n\n## ${t.issues}\n\n${issuesFor(lang)}\n\n## ${t.update}\n\n${t.instructions}`;
}
console.log(render('en') + Object.entries(translations).filter(([lang]) => lang !== 'en').map(([lang, t]) =>
  `\n\n<details>\n<summary>${t.label}</summary>\n\n${render(lang)}\n\n</details>`).join(''));

#!/usr/bin/env node
/**
 * Version single-entry bump (user directive 2026-10-01: every merge into
 * beta allocates the next number; scheme 0.1.4-beta.1 → … → 0.1.4).
 *
 *   node scripts/bump-version.mjs beta  "修复地图切换"      # 0.1.4-beta.2 → -beta.3
 *   node scripts/bump-version.mjs release                    # 0.1.4-beta.3 → 0.1.4
 *
 * Writes every copy the shipped product carries (four package.jsons,
 * tauri.conf.json, Cargo.toml + the Cargo.lock entry, plus the four workspace
 * entries package-lock.json stamps), and registers the user-facing note in
 * packages/web/src/version-info.ts (rendered in the About block of the
 * preferences dialog). `npm run version:check` guards all eight copies; a
 * build never re-bumps (the number lives in source, so repeated builds keep
 * it — only a merge does).
 *
 * Concurrency rule: run this on the feature branch right
 * before merging. If another merge reached beta in the meantime, rebase
 * first and run it again — the number is allocated by the branch state at
 * merge time, so two merges can never carry the same number.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const JSON_FILES = [
  'package.json',
  'packages/core/package.json',
  'packages/web/package.json',
  'packages/desktop/package.json',
  'packages/desktop/src-tauri/tauri.conf.json',
];
const TOML = 'packages/desktop/src-tauri/Cargo.toml';
const LOCK = 'packages/desktop/src-tauri/Cargo.lock';
const NPM_LOCK = 'package-lock.json';
const INFO = 'packages/web/src/version-info.ts';

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const write = (p, t) => writeFileSync(resolve(ROOT, p), t);

const current = JSON.parse(read('package.json')).version;

const [mode, ...rest] = process.argv.slice(2);
const note = rest.join(' ').trim();
if (mode !== 'beta' && mode !== 'release') {
  console.error('usage: bump-version.mjs beta "<note>" | bump-version.mjs release ["<note>"]');
  process.exit(1);
}
if (mode === 'beta' && !note) {
  console.error('a beta bump needs a short user-facing note: bump-version.mjs beta "修复地图切换"');
  process.exit(1);
}

// Version math lives in the shipped module so tests cover it; the script
// re-implements nothing. (Dynamic import keeps the script dependency-free.)
const { nextBetaVersion, releaseVersion } = await import('../packages/web/src/version.ts');
const next = mode === 'beta' ? nextBetaVersion(current) : releaseVersion(current);

// Guard: refuse to move a version whose copies have already drifted
// (version:check is the CI gate; don't paper over drift here).
for (const f of JSON_FILES) {
  if (JSON.parse(read(f)).version !== current) {
    console.error(`version drift: ${f} ≠ ${current} — run npm run version:check first`);
    process.exit(1);
  }
}
if (!/^version\s*=\s*"/m.test(read(TOML)) || !read(TOML).includes(`version = "${current}"`)) {
  console.error(`version drift: ${TOML} ≠ ${current}`);
  process.exit(1);
}

// Update-note i18n discipline (2026-10-03): dates use the
// YYYY.MM.DD form, and a new note enters with the English text only —
// fill the remaining languages in the same commit (version-notes.test.ts
// refuses a newest entry that misses a language).
const iso = new Date();
const pad = (n) => String(n).padStart(2, '0');
const date = `${iso.getFullYear()}.${pad(iso.getMonth() + 1)}.${pad(iso.getDate())}`;
for (const f of JSON_FILES) {
  const t = read(f);
  write(f, t.replace(`"version": "${current}"`, `"version": "${next}"`));
}
write(TOML, read(TOML).replace(`version = "${current}"`, `version = "${next}"`));
// Cargo.lock carries the version inside the app's own [[package]] block.
write(LOCK, read(LOCK).replace(
  new RegExp(`(name = "pathblender-desktop"\\nversion = )"${current}"`),
  `$1"${next}"`,
));
// package-lock.json stamps the same number into every workspace entry, and
// `npm install` rewrites those stamps — so a bump that skipped them left the
// tree dirty for the next install in every other session (seen 2026-10-06:
// the lock still read beta.47 after two bumps). Round-trip is byte-identical
// for this file, verified before switching from text surgery to JSON.
{
  const npmLock = JSON.parse(read(NPM_LOCK));
  npmLock.version = next;
  const workspaceKeys = Object.entries(npmLock.packages ?? {})
    .filter(([key, entry]) => (key === '' || key.startsWith('packages/')) && entry.version === current)
    .map(([key]) => key);
  if (workspaceKeys.length === 0) {
    console.error(`version drift: ${NPM_LOCK} has no workspace entry stamped ${current} — run npm run version:check first`);
    process.exit(1);
  }
  for (const key of workspaceKeys) npmLock.packages[key].version = next;
  write(NPM_LOCK, JSON.stringify(npmLock, null, 2) + '\n');
}

// Regenerate version-info.ts from its own previous shape.
const info = read(INFO);
const APP_LINE = /export const APP_VERSION = '[^']*';/;
const NOTES_EMPTY = /export const VERSION_NOTES: VersionNote\[\] = \[\];/;
const noteEn = note.replaceAll("'", "\\'");
const entry = `  { version: '${next}', date: '${date}', note: { en: '${noteEn}' } },`;
let nextInfo;
if (NOTES_EMPTY.test(info)) {
  nextInfo = info
    .replace(APP_LINE, `export const APP_VERSION = '${next}';`)
    .replace(NOTES_EMPTY, `export const VERSION_NOTES: VersionNote[] = [\n${entry}\n];`);
} else {
  nextInfo = info
    .replace(APP_LINE, `export const APP_VERSION = '${next}';`)
    .replace(/export const VERSION_NOTES: VersionNote\[\] = \[\n/, `export const VERSION_NOTES: VersionNote[] = [\n${entry}\n`);
}
if (nextInfo === info || !nextInfo.includes(`'${next}'`)) {
  console.error('could not rewrite version-info.ts — unexpected shape');
  process.exit(1);
}
write(INFO, nextInfo);

console.log(`version: ${current} → ${next}${note ? ` — ${note}` : ''}`);
console.log(`touched: ${[...JSON_FILES, TOML, LOCK, INFO].join(', ')}`);

#!/usr/bin/env node
/**
 * Version single-source check.
 *
 * The release number lives in eight copies on purpose (npm workspaces each
 * carry their own manifest, the Tauri shell reads its own two, and both lock
 * files stamp the number too). Nothing keeps
 * them in sync, and the service worker's cache name is stamped from the ROOT
 * version — so a drift is not cosmetic: users keep a stale app while the
 * desktop bundle reports a newer one. Fail loudly instead.
 *
 * Usage: npm run version:check
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCES = [
  ['package.json', (t) => JSON.parse(t).version],
  ['packages/core/package.json', (t) => JSON.parse(t).version],
  ['packages/web/package.json', (t) => JSON.parse(t).version],
  ['packages/desktop/package.json', (t) => JSON.parse(t).version],
  ['packages/desktop/src-tauri/tauri.conf.json', (t) => JSON.parse(t).version],
  ['packages/desktop/src-tauri/Cargo.toml', (t) => /^version\s*=\s*"([^"]+)"/m.exec(t)?.[1]],
  ['packages/web/src/version-info.ts', (t) => /^export const APP_VERSION = '([^']+)';/m.exec(t)?.[1]],
  // package-lock.json repeats the number once per workspace; internal drift
  // there is just as fatal, so the reader refuses to report a single value
  // unless every workspace entry agrees.
  ['package-lock.json', (t) => {
    const stamps = new Set(Object.entries(JSON.parse(t).packages ?? {})
      .filter(([key, pkg]) => (key === '' || key.startsWith('packages/')) && typeof pkg.version === 'string')
      .map(([, pkg]) => pkg.version));
    return stamps.size === 1 ? [...stamps][0] : `<drift inside: ${[...stamps].sort().join(' / ')}>`;
  }],
];

const found = [];
for (const [rel, read] of SOURCES) {
  let value;
  try {
    value = read(readFileSync(resolve(ROOT, rel), 'utf8'));
  } catch (e) {
    value = `<unreadable: ${e.message}>`;
  }
  found.push([rel, typeof value === 'string' ? value : `<missing>`]);
}

const distinct = [...new Set(found.map(([, v]) => v))];
if (distinct.length > 1) {
  console.error('version:check — the release number has drifted apart:\n');
  for (const [rel, v] of found) console.error(`  ${v === distinct[0] ? '   ' : '>> '} ${v.padEnd(24)} ${rel}`);
  console.error('\nSet them all to the same value before tagging a release.');
  process.exit(1);
}
console.log(`version:check — all ${found.length} manifests agree at ${distinct[0]}`);

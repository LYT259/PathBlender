/**
 * Stamp the service-worker cache name with the app version before each
 * build — every release automatically ships a fresh SW cache namespace
 * (report v1.10 release checklist; was a manual bump item).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root is two levels up from THIS script — resolved from the script
// location (not cwd) so it works from any working directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version;
// Build-time stamp: every deployment ships a fresh cache namespace, so
// returning visitors get the new assets without a manual hard-refresh
// (a plain version bump only changes at release time — site deployments
// between releases would otherwise serve stale content forever).
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const swPath = resolve(root, 'packages/web/public/sw.js');
const sw = readFileSync(swPath, 'utf-8');
const next = sw.replace(/const CACHE = 'pb-[^']*';/, `const CACHE = 'pb-${version}-${stamp}';`);
if (next === sw && !sw.includes(`const CACHE = 'pb-${version}-${stamp}';`)) {
  console.error('set-sw-version: CACHE line not found in sw.js');
  process.exit(1);
}
writeFileSync(swPath, next);
console.log(`sw cache name -> pb-${version}-${stamp}`);

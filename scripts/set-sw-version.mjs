/**
 * Stamp the service-worker cache name with the app version before each
 * build — every release automatically ships a fresh SW cache namespace
 * (report v1.10 release checklist; was a manual bump item).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Invoked from packages/web: repo root is two levels up.
const root = resolve(process.cwd(), '../..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version;
const swPath = resolve(root, 'packages/web/public/sw.js');
const sw = readFileSync(swPath, 'utf-8');
const next = sw.replace(/const CACHE = 'pb-[^']*';/, `const CACHE = 'pb-${version}';`);
if (next === sw && !sw.includes(`const CACHE = 'pb-${version}';`)) {
  console.error('set-sw-version: CACHE line not found in sw.js');
  process.exit(1);
}
writeFileSync(swPath, next);
console.log(`sw cache name -> pb-${version}`);

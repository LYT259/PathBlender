import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Deliberately narrow: packaged notices, runtime translations, configuration,
// samples and build inputs are not documentation-only, regardless of suffix.
export function docsOnly(paths) {
  return paths.length > 0 && paths.every(p =>
    /^README(?:\.[A-Za-z-]+)?\.md$/.test(p) ||
    /^(?:CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/.test(p) ||
    (/^docs\/.*\.md$/.test(p) && !p.startsWith('docs/release-notes/')));
}
export function checkVersion(previous, next) {
  const parse = v => /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const n = parse(next);
  const p = parse(previous) ?? (/^(\d+)\.(\d+)\.(\d+)$/.exec(previous)?.slice(1).map(Number));
  if (!n || !p) throw new Error('A unique beta version is required');
  if (p.length === 3) p.push(Number.MAX_SAFE_INTEGER);
  const different = n.findIndex((v, i) => v !== p[i]);
  if (different === -1 || n[different] < p[different]) throw new Error('Beta version must increase over the base branch');
}
export function classify(base, head, git = args => execFileSync('git', args, {encoding:'utf8'})) {
  if (![base,head].every(s => /^[0-9a-f]{40}$/.test(s))) throw new Error('Expected two full commit SHAs');
  const paths = git(['diff','--name-only','--no-renames','-z',base,head]).split('\0').filter(Boolean);
  const onlyDocs = docsOnly(paths);
  const version = JSON.parse(git(['show',`${head}:package.json`])).version;
  if (!onlyDocs) checkVersion(JSON.parse(git(['show',`${base}:package.json`])).version, version);
  return {docs_only: String(onlyDocs), tag: `v${version}`};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = classify(process.argv[2],process.argv[3]);
  for (const [key,value] of Object.entries(result)) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`${key}=${value}\n`);
  }
}

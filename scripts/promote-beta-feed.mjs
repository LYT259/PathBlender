import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const releaseVersion = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

function parseVersion(version) {
  const match = releaseVersion.exec(version);
  if (!match) throw new Error('Unsupported release version');
  return [Number(match[1]), Number(match[2]), Number(match[3]),
    match[4] === undefined ? Infinity : Number(match[4])];
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function planPromotion(releases, stable) {
  if (stable.draft || stable.prerelease || !/^v\d+\.\d+\.\d+$/.test(stable.tag_name)) {
    throw new Error('Latest release must be a published stable version');
  }
  // The destination may have lost latest-beta.json during an interrupted
  // --clobber upload. It comes from /releases/latest independently of sources.
  // Stable latest.json remains its canonical feed after beta pointer updates.
  const sources = releases
    .filter(release => !release.draft && releaseVersion.test(release.tag_name))
    .map(release => ({
      tag: release.tag_name,
      asset: release.tag_name.includes('-beta.') ? 'latest-beta.json' : 'latest.json',
      assets: release.assets,
    }))
    .filter(source => source.assets.some(asset =>
      asset.name === source.asset && asset.state === 'uploaded' && asset.size > 0));
  sources.sort((a, b) => compareVersions(b.tag, a.tag));
  if (!sources.length) throw new Error('No completed release feed is available');
  return { sourceTag: sources[0].tag, sourceAsset: sources[0].asset, destinationTag: stable.tag_name };
}

function promote() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Missing repository');
  const gh = args => execFileSync('gh', args, { encoding: 'utf8' });
  const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]));
  const releases = pages.flat();
  if (!releases.some(release => !release.draft && !release.prerelease)) {
    console.log('No stable release to host the beta feed');
    return;
  }
  const stable = JSON.parse(gh(['api', `repos/${repo}/releases/latest`]));
  const plan = planPromotion(releases, stable);
  const dir = mkdtempSync(join(tmpdir(), 'pb-feed-'));
  try {
    gh(['release', 'download', plan.sourceTag, '--repo', repo, '--pattern', plan.sourceAsset, '--dir', dir]);
    const source = join(dir, plan.sourceAsset);
    const feed = JSON.parse(readFileSync(source, 'utf8'));
    if (compareVersions(feed.version, plan.sourceTag) !== 0) {
      throw new Error('Newest release feed has an unexpected version');
    }
    const destination = join(dir, 'latest-beta.json');
    if (source !== destination) copyFileSync(source, destination);
    gh(['release', 'upload', plan.destinationTag, destination, '--repo', repo, '--clobber']);
    console.log(`Promoted ${feed.version} onto ${plan.destinationTag}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) promote();

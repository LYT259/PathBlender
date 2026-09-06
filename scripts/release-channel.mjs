/**
 * Map a release tag to its update channel: a pre-release suffix
 * (-alpha / -beta / -rc, e.g. v0.2.0-beta.1) routes to the beta channel;
 * plain versions are stable. Shared by the release workflow (feed filename
 * + --prerelease flag) and gen-latest-json.mjs (beta note), unit-tested in
 * packages/web/test/release-feed.test.ts.
 */
import { pathToFileURL } from 'node:url';

/** @param {string} tag @returns {'stable' | 'beta'} */
export function deriveReleaseChannel(tag) {
  return /-(?:alpha|beta|rc)[0-9A-Za-z.+-]*$/i.test(tag) ? 'beta' : 'stable';
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const tag = process.argv[2];
  if (!tag) {
    console.error('usage: release-channel.mjs <tag>');
    process.exit(1);
  }
  console.log(deriveReleaseChannel(tag));
}

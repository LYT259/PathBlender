/**
 * Generate one Tauri updater feed (JSON on stdout) from a release bundle
 * directory. Used by the release workflow (and locally to smoke-test the
 * feed shape against the updater client).
 *
 * Usage:
 *   node scripts/gen-latest-json.mjs <version> <bundle-root> > latest.json
 *
 * <bundle-root> is the tauri build output root (…/target/release/bundle);
 * the script discovers updater artifacts per platform:
 *   macOS:   macos/PathBlender.app.tar.gz(.sig)      → darwin-aarch64
 *   Windows: nsis/PathBlender_<v>_x64-setup.exe(.sig) (when configured)
 *   Linux:   appimage/PathBlender_<v>_amd64.AppImage(.sig) (when configured)
 *
 * Channel routing (release.yml decides the filename): a stable release
 * publishes BOTH feeds (stable raises the beta channel); a pre-release tag
 * publishes only latest-beta.json and marks the GitHub Release
 * --prerelease, which keeps it out of GitHub's "latest" — so stable users
 * can never be offered a beta build. The version's own pre-release suffix
 * (detected via release-channel.mjs) only drives the beta note below.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deriveReleaseChannel } from './release-channel.mjs';

const REPO = 'LYT259/pathblender';

const [version, bundleRootArg] = process.argv.slice(2);
if (!version || !bundleRootArg) {
  console.error('usage: gen-latest-json.mjs <version> <bundle-root>');
  process.exit(1);
}
const root = resolve(bundleRootArg);

const platform = (name, file) => {
  const gz = join(root, name, file);
  const sig = `${gz}.sig`;
  if (!existsSync(gz) || !existsSync(sig)) return null;
  const url = `https://github.com/${REPO}/releases/download/v${version}/${file}`;
  return {
    [name === 'macos' ? 'darwin-aarch64' : name === 'nsis' ? 'windows-x86_64' : 'linux-x86_64']: {
      signature: readFileSync(sig, 'utf-8').trim(),
      url,
    },
  };
};

const platforms = [
  platform('macos', 'PathBlender.app.tar.gz'),
  process.env.PB_WINDOWS_ARTIFACT
    ? platform('nsis', process.env.PB_WINDOWS_ARTIFACT)
    : null,
  process.env.PB_LINUX_ARTIFACT
    ? platform('appimage', process.env.PB_LINUX_ARTIFACT)
    : null,
].filter(Boolean);

if (platforms.length === 0) {
  console.error('gen-latest-json: no signed updater artifacts found under', root);
  process.exit(1);
}

const isPrerelease = deriveReleaseChannel(version) === 'beta';

const notesPath = join(root, 'RELEASE_NOTES.md');
const feed = {
  version,
  notes:
    (existsSync(notesPath) ? readFileSync(notesPath, 'utf-8').trim() : `PathBlender v${version}`) +
    (isPrerelease ? '\n\nBeta channel build — may be less tested than stable.' : ''),
  pub_date: new Date().toISOString(),
  platforms: Object.assign({}, ...platforms),
};

console.log(JSON.stringify(feed, null, 2));

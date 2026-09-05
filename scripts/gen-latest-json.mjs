/**
 * Generate the Tauri updater feed (latest.json) from a release bundle
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
 * Release URLs point at the GitHub release this feed ships with, so the
 * feed and artifacts always travel together.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = 'GH-FRC/PathBlender';

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

// Channel: PB_CHANNEL=beta writes latest-beta.json keys (prerelease flag is
// on the GitHub Release itself; the feed just needs to exist under its name).
const channel = process.env.PB_CHANNEL === 'beta' ? 'beta' : 'stable';

const notesPath = join(root, 'RELEASE_NOTES.md');
const feed = {
  version,
  notes:
    (existsSync(notesPath) ? readFileSync(notesPath, 'utf-8').trim() : `PathBlender v${version}`) +
    (channel === 'beta' ? '\n\nBeta channel build — may be less tested than stable.' : ''),
  pub_date: new Date().toISOString(),
  platforms: Object.assign({}, ...platforms),
};

if (channel === 'beta') {
  // Also emit under the beta feed name so both channels coexist.
  console.log(JSON.stringify(feed, null, 2));
  const { writeFileSync } = await import('node:fs');
  writeFileSync('latest-beta.json', JSON.stringify(feed, null, 2));
  console.error('wrote latest-beta.json');
} else {
  console.log(JSON.stringify(feed, null, 2));
}

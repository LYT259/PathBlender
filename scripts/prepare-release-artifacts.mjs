/** Collect the complete release, or fail before creating any public assets.
 * Usage: node scripts/prepare-release-artifacts.mjs VERSION ARTIFACTS BUNDLE RELEASE
 * Input is actions/download-artifact's macos/windows/linux directories.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [version, inputArg, bundleArg, releaseArg] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '') || !inputArg || !bundleArg || !releaseArg) {
  throw new Error('usage: prepare-release-artifacts.mjs VERSION ARTIFACTS BUNDLE RELEASE');
}
const input = resolve(inputArg), bundle = resolve(bundleArg), release = resolve(releaseArg);
const one = (platform, suffix) => {
  const dir = join(input, platform);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)) : [];
  if (files.length !== 1) throw new Error(`${platform}: expected exactly one ${suffix} artifact, found ${files.length}`);
  return join(dir, files[0]);
};
const macUpdater = join(input, 'macos', 'PathBlender.app.tar.gz');
const macDmg = one('macos', '.dmg');
if (basename(macDmg) !== `PathBlender_${version}_universal.dmg`) throw new Error('macOS: missing the version-matched Universal DMG');
const win = one('windows', '-setup.exe');
const deb = one('linux', '.deb'), appimage = one('linux', '.AppImage'), rpm = one('linux', '.rpm');
const sources = [macDmg, macUpdater, `${macUpdater}.sig`, win, `${win}.sig`, deb, appimage, `${appimage}.sig`, rpm];
for (const file of sources) {
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) throw new Error(`missing or empty release artifact: ${basename(file)}`);
  if (file.endsWith('.sig') && !readFileSync(file, 'utf8').trim()) throw new Error(`empty updater signature: ${basename(file)}`);
}
if (new Set(sources.map((file) => basename(file))).size !== sources.length) throw new Error('duplicate release artifact names');
// Validate the whole set before copying; no partial release can look ready.
for (const dir of [bundle, release]) {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`destination must be empty: ${dir}`);
}
for (const dir of [bundle, release]) mkdirSync(dir, { recursive: true });
for (const file of sources) copyFileSync(file, join(release, basename(file)));
for (const [dir, files] of [['macos', [macUpdater, `${macUpdater}.sig`]], ['nsis', [win, `${win}.sig`]], ['appimage', [appimage, `${appimage}.sig`]]]) {
  mkdirSync(join(bundle, dir), { recursive: true });
  for (const file of files) copyFileSync(file, join(bundle, dir, basename(file)));
}
const manifest = {
  version,
  macos: { dmg: basename(macDmg), architectures: ['aarch64', 'x86_64'] },
  windows: { nsis: basename(win) },
  linux: { deb: basename(deb), appimage: basename(appimage), rpm: basename(rpm) },
};
writeFileSync(join(bundle, 'release-artifacts.json'), JSON.stringify(manifest, null, 2) + '\n');
const environment = {
  PB_MACOS_ARCHES: 'aarch64,x86_64', PB_WINDOWS_ARTIFACT: basename(win),
  PB_LINUX_ARTIFACT: basename(appimage), PB_REQUIRED_PLATFORMS: 'darwin-aarch64,darwin-x86_64,windows-x86_64,linux-x86_64',
  PB_RELEASE_ARTIFACTS: join(bundle, 'release-artifacts.json'),
};
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, Object.entries(environment).map(([k, v]) => `${k}=${v}\n`).join(''));
console.log(JSON.stringify({ manifest, environment }, null, 2));

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const OFFLINE_NAME = 'PathBlender_0.2.0_x64-offline-setup.exe';
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pb-release-'));
  dirs.push(dir);
  const input = join(dir, 'artifacts'), bundle = join(dir, 'bundle'), output = join(dir, 'release');
  const files = {
    macos: ['PathBlender_0.2.0_universal.dmg', 'PathBlender.app.tar.gz', 'PathBlender.app.tar.gz.sig'],
    windows: ['PathBlender_0.2.0_x64-setup.exe', 'PathBlender_0.2.0_x64-setup.exe.sig'],
    'windows-offline': [OFFLINE_NAME],
    linux: ['PathBlender_0.2.0_amd64.deb', 'PathBlender_0.2.0_amd64.AppImage', 'PathBlender_0.2.0_amd64.AppImage.sig', 'PathBlender-0.2.0-1.x86_64.rpm'],
  };
  for (const [platform, names] of Object.entries(files)) {
    mkdirSync(join(input, platform), { recursive: true });
    for (const name of names) writeFileSync(join(input, platform, name), name + '\n');
  }
  // The offline installer is claimed sparse: ftruncate to a plausible offline
  // size instead of materializing 110 MB of disk per test run.
  const offlineFd = openSync(join(input, 'windows-offline', OFFLINE_NAME), 'r+');
  ftruncateSync(offlineFd, 110 * 1024 * 1024);
  closeSync(offlineFd);
  const collect = () => JSON.parse(execFileSync('node', [join(ROOT, 'scripts/prepare-release-artifacts.mjs'), '0.2.0', input, bundle, output], { encoding: 'utf8', env: { ...process.env, GITHUB_ENV: '' }, stdio: ['ignore', 'pipe', 'pipe'] }));
  return { input, bundle, output, collect };
}
describe('complete release collection', () => {
  it('copies exact bytes and generates all four updater platform entries from the same manifest', () => {
    const f = fixture(), result = f.collect();
    expect(readdirSync(f.output)).toHaveLength(10);
    expect(readFileSync(join(f.output, result.manifest.linux.rpm), 'utf8')).toBe(result.manifest.linux.rpm + '\n');
    expect(result.manifest.windows.nsisOffline).toBe(OFFLINE_NAME);
    expect(result.manifest.windows.nsisOfflineBytes).toBe(110 * 1024 * 1024);
    const bundleFiles = readdirSync(f.bundle, { recursive: true }) as string[];
    expect(bundleFiles).toContain(join('nsis', 'PathBlender_0.2.0_x64-setup.exe'));
    expect(bundleFiles).toContain(join('nsis', 'PathBlender_0.2.0_x64-setup.exe.sig'));
    expect(bundleFiles.filter((file) => file.includes('offline'))).toEqual([]);
    const feed = JSON.parse(execFileSync('node', [join(ROOT, 'scripts/gen-latest-json.mjs'), '0.2.0', f.bundle], { encoding: 'utf8', env: { ...process.env, ...result.environment } }));
    expect(Object.keys(feed.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']);
    expect(feed.platforms['darwin-x86_64']).toEqual(feed.platforms['darwin-aarch64']);
    expect(feed.platforms['linux-x86_64'].url).toContain(result.manifest.linux.appimage);
    expect(feed.platforms['windows-x86_64'].url.endsWith('_x64-setup.exe')).toBe(true);
    expect(feed.platforms['windows-x86_64'].url).not.toContain('offline');
    const registry = join(f.input, 'version-info.ts');
    writeFileSync(registry, "{ version: '0.2.0', date: '2026.10.07', note: { en: 'Update', zh: '更新', es: 'Actualización', fr: 'Mise à jour', tr: 'Güncelleme', 'pt-br': 'Atualização', he: 'עדכון' } }");
    const notes = execFileSync('node', [join(ROOT, 'scripts/release-notes-for.mjs'), '0.2.0', registry], { encoding: 'utf8', env: { ...process.env, ...result.environment } });
    for (const file of [result.manifest.macos.dmg, result.manifest.windows.nsis, ...Object.values(result.manifest.linux)]) expect(notes).toContain(file);
    expect(notes).toContain(result.manifest.windows.nsisOffline);
    expect(notes).toMatch(/\(\d+ MB\)/);
    for (const label of [
      'Windows x86_64 (NSIS, offline — embeds WebView2)',
      'Windows x86_64（NSIS 离线版，内嵌 WebView2）',
      'Windows x86_64（NSIS 離線版，內嵌 WebView2）',
      'Windows x86_64 (NSIS sin conexión, con WebView2 integrado)',
      'Windows x86_64 (NSIS hors ligne, WebView2 intégré)',
      'Windows x86_64 (NSIS çevrimdışı, WebView2 gömülü)',
      'Windows x86_64 (NSIS offline, com WebView2 integrado)',
      'Windows x86_64 (NSIS ללא חיבור לאינטרנט, כולל WebView2 מוטמע)',
    ]) expect(notes).toContain(label);
    expect(notes).not.toContain('installers are not provided');
  });
  it.each(['rpm', 'signature', 'duplicate', 'staleVersion', 'offlineMissing', 'offlineUndersized', 'offlineWrongName'])('rejects %s before creating release assets', (problem) => {
    const f = fixture();
    if (problem === 'rpm') rmSync(join(f.input, 'linux/PathBlender-0.2.0-1.x86_64.rpm'));
    if (problem === 'signature') writeFileSync(join(f.input, 'windows/PathBlender_0.2.0_x64-setup.exe.sig'), ' \n');
    if (problem === 'duplicate') writeFileSync(join(f.input, 'linux/extra.deb'), 'extra');
    if (problem === 'staleVersion') {
      rmSync(join(f.input, 'macos/PathBlender_0.2.0_universal.dmg'));
      writeFileSync(join(f.input, 'macos/PathBlender_0.1.9_universal.dmg'), 'stale');
    }
    if (problem === 'offlineMissing') rmSync(join(f.input, 'windows-offline'), { recursive: true, force: true });
    if (problem === 'offlineUndersized') {
      const fd = openSync(join(f.input, 'windows-offline', OFFLINE_NAME), 'r+');
      ftruncateSync(fd, 1024 * 1024);
      closeSync(fd);
    }
    if (problem === 'offlineWrongName') renameSync(join(f.input, 'windows-offline', OFFLINE_NAME), join(f.input, 'windows-offline', 'PathBlender_0.1.9_x64-offline-setup.exe'));
    expect(f.collect).toThrow();
    expect(existsSync(f.output)).toBe(false);
    expect(existsSync(f.bundle)).toBe(false);
  });
  it('refuses to silently omit a configured updater or a required Intel entry', () => {
    const f = fixture(), { environment } = f.collect();
    const run = (env: Record<string, string>) => execFileSync('node', [join(ROOT, 'scripts/gen-latest-json.mjs'), '0.2.0', f.bundle], { env: { ...process.env, ...environment, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(() => run({ PB_MACOS_ARCHES: 'aarch64' })).toThrow();
    rmSync(join(f.bundle, 'nsis/PathBlender_0.2.0_x64-setup.exe.sig'));
    expect(() => run({})).toThrow();
  });
});

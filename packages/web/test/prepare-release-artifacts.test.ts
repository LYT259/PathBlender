import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pb-release-'));
  dirs.push(dir);
  const input = join(dir, 'artifacts'), bundle = join(dir, 'bundle'), output = join(dir, 'release');
  const files = {
    macos: ['PathBlender_0.2.0_universal.dmg', 'PathBlender.app.tar.gz', 'PathBlender.app.tar.gz.sig'],
    windows: ['PathBlender_0.2.0_x64-setup.exe', 'PathBlender_0.2.0_x64-setup.exe.sig'],
    linux: ['PathBlender_0.2.0_amd64.deb', 'PathBlender_0.2.0_amd64.AppImage', 'PathBlender_0.2.0_amd64.AppImage.sig', 'PathBlender-0.2.0-1.x86_64.rpm'],
  };
  for (const [platform, names] of Object.entries(files)) {
    mkdirSync(join(input, platform), { recursive: true });
    for (const name of names) writeFileSync(join(input, platform, name), name + '\n');
  }
  const collect = () => JSON.parse(execFileSync('node', [join(ROOT, 'scripts/prepare-release-artifacts.mjs'), '0.2.0', input, bundle, output], { encoding: 'utf8', env: { ...process.env, GITHUB_ENV: '' }, stdio: ['ignore', 'pipe', 'pipe'] }));
  return { input, bundle, output, collect };
}
describe('complete release collection', () => {
  it('copies exact bytes and generates all four updater platform entries from the same manifest', () => {
    const f = fixture(), result = f.collect();
    expect(readdirSync(f.output)).toHaveLength(9);
    expect(readFileSync(join(f.output, result.manifest.linux.rpm), 'utf8')).toBe(result.manifest.linux.rpm + '\n');
    const feed = JSON.parse(execFileSync('node', [join(ROOT, 'scripts/gen-latest-json.mjs'), '0.2.0', f.bundle], { encoding: 'utf8', env: { ...process.env, ...result.environment } }));
    expect(Object.keys(feed.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'windows-x86_64']);
    expect(feed.platforms['darwin-x86_64']).toEqual(feed.platforms['darwin-aarch64']);
    expect(feed.platforms['linux-x86_64'].url).toContain(result.manifest.linux.appimage);
    const registry = join(f.input, 'version-info.ts');
    writeFileSync(registry, "{ version: '0.2.0', date: '2026.10.07', note: { en: 'Update', zh: '更新', es: 'Actualización', fr: 'Mise à jour', tr: 'Güncelleme', 'pt-br': 'Atualização', he: 'עדכון' } }");
    const notes = execFileSync('node', [join(ROOT, 'scripts/release-notes-for.mjs'), '0.2.0', registry], { encoding: 'utf8', env: { ...process.env, ...result.environment } });
    for (const file of [result.manifest.macos.dmg, result.manifest.windows.nsis, ...Object.values(result.manifest.linux)]) expect(notes).toContain(file);
    expect(notes).not.toContain('installers are not provided');
  });
  it.each(['rpm', 'signature', 'duplicate', 'staleVersion'])('rejects %s before creating release assets', (problem) => {
    const f = fixture();
    if (problem === 'rpm') rmSync(join(f.input, 'linux/PathBlender-0.2.0-1.x86_64.rpm'));
    if (problem === 'signature') writeFileSync(join(f.input, 'windows/PathBlender_0.2.0_x64-setup.exe.sig'), ' \n');
    if (problem === 'duplicate') writeFileSync(join(f.input, 'linux/extra.deb'), 'extra');
    if (problem === 'staleVersion') {
      rmSync(join(f.input, 'macos/PathBlender_0.2.0_universal.dmg'));
      writeFileSync(join(f.input, 'macos/PathBlender_0.1.9_universal.dmg'), 'stale');
    }
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

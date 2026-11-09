import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/gen-homebrew-cask.mjs');
const SHA = 'a'.repeat(64);
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const run = (args: string[], cwd?: string) =>
  execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ENV: '' }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });

describe('homebrew cask generator', () => {
  it('prints the cask body for LYT259/homebrew-tap from validated inputs', () => {
    const out = run(['0.1.10', SHA]);
    for (const s of [
      'cask "pathblender" do',
      'version "0.1.10"',
      `sha256 "${SHA}"`,
      'url "https://github.com/LYT259/pathblender/releases/download/v#{version}/PathBlender_#{version}_universal.dmg"',
      'verified: "github.com/LYT259/pathblender/"',
      'name "PathBlender"',
      'desc "Free, open-source FRC autonomous path viewer"',
      'homepage "https://github.com/LYT259/pathblender"',
      'depends_on macos: :ventura',
      'app "PathBlender.app"',
    ]) expect(out).toContain(s);
    expect(out.endsWith('end\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it.each([
    ['an uppercase sha256', ['0.1.10', 'A'.repeat(64)]],
    ['a truncated sha256', ['0.1.10', 'a'.repeat(63)]],
    ['a leading-v version', ['v0.1.10', SHA]],
    ['a non-semver version', ['0.1', SHA]],
    ['a single argument', ['0.1.10']],
    ['three arguments', ['0.1.10', SHA, 'extra']],
  ])('rejects %s', (_problem, args) => {
    expect(() => run(args as string[])).toThrow();
  });

  it('writes no file and runs no git (stdout-only generator)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-cask-'));
    dirs.push(dir);
    const out = run(['0.1.10', SHA], dir);
    expect(out).toContain('cask "pathblender" do');
    expect(readdirSync(dir)).toEqual([]);
  });
});

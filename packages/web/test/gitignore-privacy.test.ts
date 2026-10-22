/**
 * .gitignore privacy-coverage tests (2026-10-22): the general private-file
 * rules added for the privacy-prevention hardening must ignore local AI/MCP
 * configs, private-key material, crash dumps, caches and temp logs at any
 * directory level — while leaving public sample/config/certificate paths
 * trackable, and while no already-tracked file silently becomes ignored.
 *
 * All probed paths are fictitious (never created on disk); the checks run
 * through `git check-ignore --no-index`, the same channel the pre-push gate
 * uses to detect force-added ignored files.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

function checkIgnore(paths: string[]): Map<string, { ignored: boolean; rule: string }> {
  const out = execFileSync(
    'git',
    ['check-ignore', '--no-index', '-z', '-v', '-n', '--stdin'],
    { cwd: ROOT, input: paths.join('\0') + '\0', encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const fields = out.split('\0');
  const map = new Map<string, { ignored: boolean; rule: string }>();
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [src, , pat, path] = fields.slice(i, i + 4);
    const matched = pat !== '';
    const negated = pat.startsWith('!');
    map.set(path, { ignored: matched && !negated, rule: pat || '' });
  }
  return map;
}

describe('.gitignore: private material is ignored at any depth', () => {
  it('ignores local AI/MCP configs, keys, dumps, caches and temp logs', () => {
    const privatePaths = [
      '.agents/config.json',
      'packages/web/.agents/probe.json',
      '.mcp.json',
      'packages/web/.mcp.json',
      'mcp.json',
      '.mcp/servers.json',
      '.gemini/settings.json',
      '.windsurf/rules.md',
      '.aider.conf.yml',
      '.aider.chat.history.md',
      'credentials.pem',
      'packages/desktop/src-tauri/updater-private.pem',
      'private.key',
      'packages/desktop/AuthKey_9X8Y7Z.p8',
      'signing.p12',
      'dist.pfx',
      'android.keystore',
      'id_rsa',
      'id_ed25519',
      '.ssh/id_ecdsa',
      'service-account.json',
      'gcp-service-account-prod.json',
      'google-credentials.json',
      '.netrc',
      'diagnostic.dmp',
      'java.hprof',
      'node.heapsnapshot',
      '.cache/anything',
      'packages/web/.cache/vite',
      '.turbo/build.log',
      '.eslintcache',
      'scripts/__pycache__/board.cpython-313.pyc',
      'tmp/debug.log',
      'packages/web/tmp/scratch.txt',
      'temp/whatever',
      'npm-debug.log.1',
      'yarn-error.log',
      'logs/app.log',
      'session.swp',
      'notes.txt~',
    ];
    const result = checkIgnore(privatePaths);
    for (const p of privatePaths) {
      expect(result.get(p)?.ignored, `${p} should be ignored (rule: ${result.get(p)?.rule})`).toBe(true);
    }
  });

  it('keeps the established private-file rules working (AGENTS/log/redbook/board)', () => {
    const legacy = [
      'AGENTS.md',
      'CLAUDE.md',
      '.claude/settings.json',
      'PathBlender_红皮书.md',
      'engineering-log/2026.10.22.md',
      '转公开前最后准备.md',
      'reference/2026/manual.pdf',
      '.agent-board/state.json',
      '.zcode/session.json',
      '.pre-push-patterns',
      '.env',
      '.env.production',
      'packages/web/dist/app.js',
      'coverage/lcov.info',
    ];
    const result = checkIgnore(legacy);
    for (const p of legacy) {
      expect(result.get(p)?.ignored, `${p} should stay ignored`).toBe(true);
    }
  });
});

describe('.gitignore: legitimate public files stay trackable', () => {
  it('does not sweep up samples, product configs, docs or public certificates', () => {
    const publicPaths = [
      'packages/web/public/fields3d/2026-rebuilt/config.json',
      'samples/invalid/unknown.json',
      'samples/2026/team11019.traj',
      'scripts/release-notes-locales.json',
      'packages/desktop/src-tauri/tauri.conf.json',
      'packages/web/test/i18n-edge-render.json',
      'packages/core/src/index.ts',
      'public-cert.crt',
      'server.cer',
      'id_rsa_helper_notes.md',
      'docs/mcp-example.md',
      'docs/private-key-handling.md',
      'docs/keys.md',
      'samples/keynote-notes.md',
      'scripts/gen_ghostauto_samples.py',
      '.vscode/extensions.json',
      'README.md',
      'CHANGELOG.md',
      'packages/web/public/robots/mk5i.glb',
    ];
    const result = checkIgnore(publicPaths);
    for (const p of publicPaths) {
      expect(result.get(p)?.ignored, `${p} must remain trackable`).toBe(false);
    }
  });

  it('no already-tracked file matches the ignore rules (nothing silently untracked)', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(500);
    let hits: string[] = [];
    try {
      const out = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
        cwd: ROOT,
        input: tracked.join('\0') + '\0',
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
      });
      hits = out.split('\0').filter(Boolean);
    } catch (e) {
      const err = e as { status?: number };
      expect(err.status).toBe(1); // exit 1 = nothing matched = the expected outcome
    }
    expect(hits).toEqual([]); // any tracked-but-ignorable file is a finding
  });
});

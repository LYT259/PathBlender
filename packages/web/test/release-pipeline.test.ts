/**
 * Release pipeline contract tests — pinned after the v0.1.6-beta.22
 * incident: the packaging script wrote the processed dmg to bundle/macos/
 * while release.yml collected Tauri's untouched pre-seal image from
 * bundle/dmg/, and the release went green because nothing opened the
 * uploaded file. These tests keep the artifact path contract and the
 * verification gates from silently drifting apart again (full behavioral
 * verification happens in CI: the script mounts and checks the finished
 * dmg before staging).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const script = readFileSync(resolve(ROOT, 'scripts/package-desktop-artifacts.sh'), 'utf-8');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf-8');

describe('dmg artifact path contract', () => {
  it('the packaging script writes the dmg into bundle/dmg — the path the workflow collects from', () => {
    expect(script).toContain('DMG_DIR="$(dirname "$(dirname "$APP")")/dmg"');
    expect(script).toContain('DMG="$DMG_DIR/PathBlender_${VERSION}_${DMG_ARCH}.dmg"');
  });

  it('the tauri-era dmg directory is wiped before repackaging (no stale pre-seal image survives)', () => {
    expect(script).toMatch(/rm -rf "\$DMG_DIR"/);
  });

  it('the workflow stages the dmg without a failure-swallowing `|| true`', () => {
    const line = workflow.split('\n').find((l) => l.includes('_universal.dmg" release/'));
    expect(line).toBeDefined();
    expect(line!).not.toContain('|| true');
  });
});

describe('shipped-artifact verification gates', () => {
  it('builds and verifies Universal Mac binaries before collecting the version-matched image', () => {
    expect(workflow).toContain('npx tauri build --target universal-apple-darwin --bundles app');
    expect(workflow).toContain('target/universal-apple-darwin/release/bundle');
    expect(script).toContain('lipo -verify_arch arm64 x86_64');
    expect(script).toContain('verify_architectures "$MNT/PathBlender.app"');
  });

  it('keeps public deployment dormant while private and builds the viewer on beta pushes', () => {
    const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toContain('if: github.event.repository.private == false');
    expect(deploy).toContain('branches: [beta]');
    expect(deploy).toContain("VITE_VIEWER_ONLY: '1'");
    expect(workflow).toContain('if: github.event.repository.private == false');
    expect(workflow).toContain('needs: [build-macos, build-windows, build-linux]');
    expect(workflow).toContain('node scripts/prepare-release-artifacts.mjs');
  });
  it('the finished dmg is mounted and its content seal-checked before staging', () => {
    expect(script).toContain('hdiutil attach');
    expect(script).toMatch(/codesign --verify --deep --strict "\$MNT\/PathBlender\.app"/);
  });

  it('the mounted dmg must carry the day+night icon catalog', () => {
    expect(script).toContain('Assets.car');
  });

  it('the updater archive is regenerated from the sealed bundle (never tauri’s pre-seal wrap)', () => {
    expect(script).toContain('rm -f "$UPDATER" "$UPDATER.sig"');
  });
});

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

/**
 * Assertion-oriented YAML subset parser for GitHub workflow files (2026-11-01,
 * release-verify contract tests). The repo deliberately ships no YAML
 * dependency (toolchain freeze), so this parses the subset the workflows
 * actually use: nested mappings, sequences of inline mappings or scalars,
 * `|` block scalars, quoted plain scalars and full-line comments. Flow
 * collections, `>` blocks, anchors and tags throw — the parser doubles as a
 * style constraint on the files it covers.
 */
type WorkflowNode = string | { [key: string]: WorkflowNode } | WorkflowNode[];

function parseWorkflowYaml(text: string): { [key: string]: WorkflowNode } {
  const raw = text.split(/\r?\n/);
  let cursor = 0;
  const fail = (line: number, why: string): never => {
    throw new Error(`workflow YAML subset parser: line ${line}: ${why}`);
  };
  const indentOf = (s: string) => s.length - s.trimStart().length;
  const isBlank = (s: string) => s.trim() === '';
  const isComment = (s: string) => s.trimStart().startsWith('#');
  const KEY_VALUE = /^([^:#]+?):(?:\s+(.*))?$/;
  const peek = (): { index: number; indent: number; content: string } | null => {
    let i = cursor;
    while (i < raw.length && (isBlank(raw[i]) || isComment(raw[i]))) i++;
    return i >= raw.length ? null : { index: i, indent: indentOf(raw[i]), content: raw[i].trim() };
  };
  const unquote = (v: string) =>
    v.length > 1 && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"'))) ? v.slice(1, -1) : v;

  const readBlockScalar = (from: number, keyIndent: number, key: string): string => {
    let end = from;
    while (end < raw.length && (isBlank(raw[end]) || indentOf(raw[end]) > keyIndent)) end++;
    while (end > from && isBlank(raw[end - 1])) end--;
    if (end === from) fail(from + 1, `empty block scalar for key: ${key}`);
    const first = raw.slice(from, end).findIndex((l) => !isBlank(l));
    const base = indentOf(raw[from + first]);
    const text = raw.slice(from, end).map((l) => l.slice(base)).join('\n');
    cursor = end;
    return text;
  };

  const parseMapping = (indent: number): { [key: string]: WorkflowNode } => {
    const out: { [key: string]: WorkflowNode } = {};
    for (
      let next = peek();
      next && next.indent === indent && next.content !== '-' && !next.content.startsWith('- ');
      next = peek()
    ) {
      const match = KEY_VALUE.exec(next.content);
      if (!match) fail(next.index + 1, `cannot parse mapping entry: ${next.content}`);
      const [, key, value = ''] = match;
      if (key in out) fail(next.index + 1, `duplicate key: ${key}`);
      cursor = next.index + 1;
      if (value === '|') {
        out[key] = readBlockScalar(next.index + 1, indent, key);
      } else if (value === '') {
        const nested = peek();
        out[key] = nested && nested.indent > indent ? parseBlock(nested.indent) : '';
      } else if (value.startsWith('|') || value.startsWith('>') || value.startsWith('{') || value.startsWith('[')) {
        fail(next.index + 1, `unsupported YAML feature on the right of ${key}: ${value}`);
      } else {
        out[key] = unquote(value);
      }
    }
    return out;
  };

  const parseSequence = (indent: number): WorkflowNode[] => {
    const items: WorkflowNode[] = [];
    for (
      let next = peek();
      next && next.indent === indent && (next.content === '-' || next.content.startsWith('- '));
      next = peek()
    ) {
      const rest = next.content === '-' ? '' : next.content.slice(2);
      cursor = next.index;
      if (rest === '') {
        cursor = next.index + 1;
        const nested = peek();
        items.push(nested && nested.indent > indent ? parseBlock(nested.indent) : '');
      } else if (KEY_VALUE.test(rest)) {
        // "- key: value" begins an inline mapping whose first key sits at indent + 2.
        raw[next.index] = ' '.repeat(indent + 2) + rest;
        items.push(parseMapping(indent + 2));
      } else {
        cursor = next.index + 1;
        items.push(unquote(rest));
      }
    }
    return items;
  };

  const parseBlock = (indent: number): WorkflowNode => {
    const next = peek();
    if (!next) return '';
    return next.content === '-' || next.content.startsWith('- ') ? parseSequence(indent) : parseMapping(indent);
  };

  return parseMapping(0);
}

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

describe('third-party legal notices', () => {
  it('ships the project notices and FRC Designs MIT license as desktop resources', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/tauri.conf.json'), 'utf8'));
    expect(config.bundle.resources).toMatchObject({
      '../../../LICENSE': 'LICENSE',
      '../../../NOTICE.md': 'NOTICE.md',
      '../../../licenses/FRCDesignApp-MIT.txt': 'licenses/FRCDesignApp-MIT.txt',
    });
  });

  it('copies the same legal files into the web distribution after Vite empties it', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/web/package.json'), 'utf8'));
    const copyScript = readFileSync(resolve(ROOT, 'scripts/copy-legal-files.mjs'), 'utf8');
    expect(pkg.scripts.build).toContain('vite build && node ../../scripts/copy-legal-files.mjs');
    for (const file of ['LICENSE', 'NOTICE.md', 'licenses']) expect(copyScript).toContain(`'${file}'`);
  });

  it('keeps the upstream copyright and permission notice with the MK5i assets', () => {
    const notice = readFileSync(resolve(ROOT, 'NOTICE.md'), 'utf8');
    const license = readFileSync(resolve(ROOT, 'licenses/FRCDesignApp-MIT.txt'), 'utf8');
    expect(notice).toContain('version V235, with Kraken X60 motors');
    expect(notice).toContain('packages/web/public/models/mk5i-module.glb');
    expect(license).toContain('Copyright (c) 2026 FRCDesign.org');
    expect(license).toContain('Permission is hereby granted, free of charge');
  });

  it('separates the repository license from the Onshape educational-use evidence', () => {
    const notice = readFileSync(resolve(ROOT, 'NOTICE.md'), 'utf8');
    const cad = readFileSync(resolve(ROOT, 'scripts/cad/README.md'), 'utf8');
    expect(notice).not.toContain('MK5i swerve module** (MIT)');
    expect(notice).toContain('The FRCDesignApp GitHub repository is MIT-licensed.');
    expect(notice).toContain("this is the project's interpretation, not an itemized confirmation");
    expect(notice).toContain('the reply expressly leaves their licensing to them');
    expect(cad).toContain('screenshot displays 2026-10-09, timezone unverified');
    expect(cad).toContain('does not separately confirm public-repository distribution, GLB conversion,');
    expect(cad).not.toContain("which covers this free FRC strategy tool's use case");
  });

  it('records SDS permission only for its CAD-derived visualization assets', () => {
    const notice = readFileSync(resolve(ROOT, 'NOTICE.md'), 'utf8');
    expect(notice).toContain('SDS MK5i CAD-derived visualization assets are used and distributed with PathBlender with express permission from Swerve Drive Specialties.');
    expect(notice).toContain('does not relicense these assets under Apache-2.0, MIT, CC0, or any other standard open-source license');
    expect(notice).toContain('does not cover the Kraken X60 geometry or the maintainer-built frame assemblies');
  });
});

describe('shipped-artifact verification gates', () => {
  it('builds and verifies Universal Mac binaries before collecting the version-matched image', () => {
    expect(workflow).toContain('npx tauri build --target universal-apple-darwin --bundles app');
    expect(workflow).toContain('target/universal-apple-darwin/release/bundle');
    expect(script).toContain('verify_arch arm64');
    expect(script).toContain('verify_arch x86_64');
    expect(script).toContain('lipo "$app/Contents/MacOS/$executable" -verify_arch "$1"');
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
  it('mirrors the same viewer build to Cloudflare Pages and verifies both sites', () => {
    const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(deploy).toContain('name: viewer-dist');
    expect(deploy).toContain('path: packages/web/dist');
    expect(deploy).toContain('actions/download-artifact@v4');
    expect(deploy).toContain('wrangler@4.147.0 pages deploy viewer-dist');
    expect(deploy).toContain('--project-name=pathblender');
    expect(deploy).toContain('--branch=stable');
    expect(deploy).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(deploy).toContain("if: env.CF_TOKEN_SET == 'true'");
    expect(deploy).not.toMatch(/if:[^\n]*secrets\./);
    expect(deploy).not.toContain('\\\"');
    expect(deploy).toContain('https://lyt259.github.io/PathBlender/sw.js');
    expect(deploy).toContain('https://pathblender.pages.dev/sw.js');
    expect(deploy).toContain('"$version" = "$expected"');
  });
  it('installs locked Node dependencies before composing release notes in the publish job', () => {
    const publish = workflow.slice(workflow.indexOf('  publish:'));
    const setupNode = publish.indexOf('actions/setup-node@v4');
    const install = publish.indexOf('run: npm ci');
    const compose = publish.indexOf('name: Compose user-facing release notes');
    expect(setupNode).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(setupNode);
    expect(compose).toBeGreaterThan(install);
  });

  it('the finished dmg is mounted and its content seal-checked before staging', () => {
    expect(script).toContain('hdiutil attach');
    expect(script).toMatch(/codesign --verify --deep --strict "\$MNT\/PathBlender\.app"/);
  });

  it('the mounted dmg must carry the day+night icon catalog', () => {
    expect(script).toContain('Assets.car');
  });

  it('the app and mounted dmg must carry the legal notices', () => {
    expect(script).toContain('verify_legal_notices "$APP"');
    expect(script).toContain('verify_legal_notices "$MNT/PathBlender.app"');
    expect(script).toContain('licenses/FRCDesignApp-MIT.txt');
  });

  it('the updater archive is regenerated from the sealed bundle (never tauri’s pre-seal wrap)', () => {
    expect(script).toContain('rm -f "$UPDATER" "$UPDATER.sig"');
  });
});

describe('Windows smoke installation contract', () => {
  it('removes registry path quotes before joining the installed executable path', () => {
    const smoke = readFileSync(resolve(ROOT, '.github/workflows/windows-smoke.yml'), 'utf8');
    const normalize = smoke.indexOf(String.raw`$installDir = $installDir.Trim(`);
    const join = smoke.indexOf('Join-Path $installDir "pathblender-desktop.exe"');
    expect(normalize).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(normalize);
    expect(smoke).toContain('Get-Process -Name "pathblender-desktop"');
    expect(smoke).toContain('pathblender-desktop.exe not found at $exe');
  });
});

describe('FIRST copyright disclaimers', () => {
  it('carries both required English disclaimers in the packaged notice and every README', () => {
    const trademark = 'FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are registered trademarks of FIRST® (www.firstinspires.org) which is not overseeing, involved with, or responsible for this activity, product, or service.';
    const copyright = '©2025 For Inspiration and Recognition of Science and Technology (FIRST). Used by special permission. All rights reserved. FIRST is not overseeing, involved with, or responsible for this activity, product, or service.';
    for (const file of ['NOTICE.md', 'README.md', 'README.zh-CN.md', 'README.zh-Hant.md', 'README.es.md', 'README.fr.md', 'README.he.md', 'README.pt-BR.md', 'README.tr.md']) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      expect(text, `${file}: trademark disclaimer`).toContain(trademark);
      expect(text, `${file}: copyright disclaimer`).toContain(copyright);
    }
  });
});

describe('published-release verification workflow (release-verify.yml)', () => {
  const verifyText = readFileSync(resolve(ROOT, '.github/workflows/release-verify.yml'), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verify = parseWorkflowYaml(verifyText) as any;
  const jobs = verify.jobs as Record<string, any>;
  const windows = jobs['windows-installer'];
  const macos = jobs['macos-intel-dmg'];
  const linux = jobs['linux-packages'];
  const runText = (job: any) => job.steps.map((step: any) => step.run ?? '').join('\n');

  it('dispatches manually with the stable tag as default and read-only permissions', () => {
    expect(verify.on.workflow_dispatch.inputs.tag).toMatchObject({ default: 'v0.1.9', required: 'true' });
    expect(verify.permissions).toEqual({ contents: 'read' });
  });

  it('runs on the official Intel macOS and ubuntu runners, public-repo guarded like deploy.yml', () => {
    expect(windows['runs-on']).toBe('windows-latest');
    expect(macos['runs-on']).toBe('macos-15-intel');
    expect(linux['runs-on']).toBe('ubuntu-24.04');
    for (const job of [windows, macos, linux]) {
      expect(job.if).toBe('github.event.repository.private == false');
    }
    expect(windows['timeout-minutes']).toBe('30');
    expect(macos['timeout-minutes']).toBe('25');
    expect(linux['timeout-minutes']).toBe('40');
  });

  it('verifies published assets only — no checkout, no rebuild, no secrets', () => {
    for (const job of [windows, macos, linux]) {
      expect(job.steps.some((step: any) => step.uses === 'actions/checkout@v4')).toBe(false);
    }
    // The built-in read-only github.token IS allowed (metadata lookups only);
    // repo secrets and token-bearing downloads stay banned. 'Authorization'
    // is deliberately absent here — its only legal use is the metadata
    // Bearer header, asserted separately below.
    for (const banned of ['npx tauri build', 'npm ci', 'cargo ', 'tauri signer generate', 'secrets.', 'GITHUB_TOKEN', 'GH_TOKEN']) {
      expect(verifyText, `must not contain ${banned}`).not.toContain(banned);
    }
  });

  it('downloads anonymously and pins every asset against the server-side sha256 digest', () => {
    // Metadata lookups go through the built-in read-only github.token — the
    // anonymous API hit shared-runner-IP 403 rate limits in the Windows job.
    // The ASSET download itself stays strictly anonymous (browser URL, no
    // Authorization header), which is what a real user's download proves.
    expect((verifyText.match(/GH_METADATA_TOKEN: \$\{\{ github\.token \}\}/g) ?? []).length).toBe(3);
    expect((verifyText.match(/-H "Authorization: Bearer \$GH_METADATA_TOKEN" "https:\/\/api\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/tags\//g) ?? []).length).toBe(3);
    const downloadLine = verifyText.split('\n').find((l) => l.includes('curl -fL --retry 3'));
    expect(downloadLine).toBeDefined();
    expect(downloadLine).not.toContain('Authorization');
    for (const job of [windows, macos, linux]) {
      const run = runText(job);
      expect(run).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+');
      expect(run).toContain('browser_download_url');
      expect(run).toContain('/^sha256:[0-9a-f]{64}$/');
      expect(run).toContain('sha256 mismatch');
      expect(run).toContain('size mismatch');
      expect(run).toContain('curl -fL --retry 3 -o "dl/$WANT" "$URL"');
    }
    expect(runText(windows)).toContain('sha256sum "dl/$WANT"');
    expect(runText(linux)).toContain('sha256sum "dl/$WANT"');
    expect(runText(macos)).toContain('shasum -a 256 "dl/$WANT"');
    expect(runText(macos)).toContain('hdiutil verify');
    expect(runText(linux)).toContain('fetch_asset "_amd64.deb"');
    expect(runText(linux)).toContain('fetch_asset "_amd64.AppImage"');
    expect(runText(linux)).toContain('fetch_asset ".x86_64.rpm"');
  });

  it('macOS: proves a native Intel runner, then a Universal, sealed, legal DMG that really launches', () => {
    const run = runText(macos);
    expect(run).toContain('uname -m');
    expect(run).toContain('"x86_64"');
    expect(run).toContain('sysctl.proc_translated');
    expect(run).toContain('-verify_arch x86_64');
    expect(run).toContain('-verify_arch arm64');
    expect(run).toContain('codesign --verify --deep --strict');
    expect(run).toContain('CFBundleShortVersionString');
    expect(run).toContain('hdiutil attach -readonly -mountpoint');
    expect(run).toContain('NOTICE.md');
    expect(run).toContain('licenses/FRCDesignApp-MIT.txt');
    expect(run).toContain('Assets.car');
    expect(run).toContain('open "$APP"');
    expect(run).toContain('pgrep -f "$MNT/PathBlender.app/Contents/MacOS/$EXE"');
    expect(run).toContain('screencapture -x "$PWD/mac-screenshot.png"');
  });

  it('Windows: silently installs, launches and screenshots the published installer with the tag version', () => {
    const run = runText(windows);
    expect(run).toContain('-ArgumentList "/S"');
    expect(run).toContain('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    expect(run).toContain('$installDir.Trim(');
    expect(run).toContain('Join-Path $installDir "pathblender-desktop.exe"');
    expect(run).toContain('Get-Process -Name "pathblender-desktop"');
    expect(run).toContain('MainWindowTitle');
    expect(run).toContain('VersionInfo.ProductVersion');
    expect(run).toContain('$env:RELEASE_TAG -replace "^v", ""');
    expect(run).toContain('CopyFromScreen');
  });

  it('Linux: apt-installs the DEB, runs the AppImage FUSE-free and unpacks the RPM payload', () => {
    const run = runText(linux);
    // Virtual display with a real WM + session bus, and software-rendering
    // guards for WebKit under Xvfb — without them the capture is all-black
    // (run 41269941209: three 1600x900 screenshots with PIL mean=stddev=0
    // while the process and the window both existed).
    expect(run).toContain('Xvfb :99 -screen 0 1600x900x24');
    expect(linux.env.DISPLAY).toBe(':99');
    expect(run).toContain('sudo apt-get install -y xvfb xdotool imagemagick rpm rpm2cpio cpio openbox dbus-x11');
    expect(run).toContain('dbus-launch --sh-syntax');
    expect(run).toContain('openbox > openbox.log 2>&1 &');
    expect(run).toContain('pgrep -x openbox');
    expect((run.match(/GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1/g) ?? []).length).toBe(3);
    // DEB: a real system install, with version/NOTICE/binary from package metadata.
    expect(run).toContain('sudo apt-get install -y "./$DEB"');
    expect(run).toContain('dpkg-deb -f "$DEB" Version');
    expect(run).toContain('dpkg -L "$PKG" | grep -E "NOTICE\\.md$"');
    expect(run).toContain('bin/pathblender-desktop$');
    // AppImage: no FUSE on hosted runners — extract to inspect, extract-and-run to launch.
    expect(run).toContain('--appimage-extract > /dev/null');
    expect(run).toContain('--appimage-extract-and-run');
    expect(run).toContain('chmod +x "$APPIMG"');
    // Version anchor for the AppImage = the download chain itself (input tag
    // -> that release -> the unique _amd64.AppImage -> server-side digest).
    // The binary is NEVER hashed: the packager rewrites it (run 41268762661:
    // NOTICE hashes matched, binary hashes differed) and no text version
    // exists anywhere in the image (runs 41267274881/41267886164). NOTICE
    // content is still cross-checked against the apt-installed DEB
    // (measured identical in that same run).
    expect(run).not.toContain('grep -lF "$VER"');
    expect(run).not.toContain('grep -aqF "$VER" "$BIN"');
    expect(run).not.toContain('sha256sum "$BIN"');
    expect(run).not.toContain('deb-binary.sha256');
    expect(run).toContain('deb-notice.sha256');
    expect((run.match(/sha256sum "\$NOTICE"/g) ?? []).length).toBe(2);
    expect(run).toContain('AppImage NOTICE differs from the installed DEB NOTICE');
    // RPM: metadata version + staged payload expansion (run from the tree).
    expect(run).toContain('rpm -qp --nosignature --qf "%{version}"');
    // rpm2cpio may exit nonzero AFTER emitting a complete payload (run
    // 41269273195: the pipe died under set -o pipefail with no cpio error,
    // while the same command succeeded without pipefail on the Linux host),
    // so the payload is captured to a file first — empty payload fails
    // loudly — and cpio's own exit status is the authoritative check.
    expect(run).not.toContain('rpm2cpio "../$RPM" | cpio -idm --quiet');
    expect(run).toContain('rpm2cpio "../$RPM" > rpm-payload.cpio 2> rpm2cpio.log || true');
    expect(run).toContain('[[ ! -s rpm-payload.cpio ]]');
    expect(run).toContain('::error::rpm2cpio produced no payload');
    expect(run).toContain('cpio -idm --quiet < rpm-payload.cpio');
    // Each launch must survive 15s and expose a PathBlender window; the
    // screenshot captures the X ROOT screen, not the window id — window-id
    // grabs fail on Xvfb with MIT-SHM EAGAIN ("Resource temporarily
    // unavailable", real run 41266701676), root grabs do not.
    expect((run.match(/sleep 15/g) ?? []).length).toBe(3);
    expect((run.match(/pgrep -f "pathblender-desktop"/g) ?? []).length).toBe(3);
    expect((run.match(/xdotool search --onlyvisible --name "PathBlender"/g) ?? []).length).toBe(3);
    expect(run).not.toContain('xdotool search --name "PathBlender" | head -1');
    expect(run).not.toContain('import -window "$WIN"');
    expect((run.match(/import -window root (\S+-screen\.png)/g) ?? []).length).toBe(3);
    expect(run).toContain('import -window root deb-screen.png');
    expect(run).toContain('import -window root appimage-screen.png');
    expect(run).toContain('import -window root rpm-screen.png');
    // Screenshot evidence is validated: full root geometry via identify…
    expect((run.match(/identify -format "%wx%h" (\S+-screen\.png)/g) ?? []).length).toBe(3);
    expect((run.match(/expected the 1600x900 root screen/g) ?? []).length).toBe(3);
    // …AND not all-black: gray mean/standard deviation on the 0-255 scale
    // must both exceed 1, or the step fails explicitly.
    expect((run.match(/-colorspace gray -format/g) ?? []).length).toBe(3);
    expect((run.match(/screenshot looks black \(mean=\$MEAN stddev=\$STD/g) ?? []).length).toBe(3);
    // The verification tools themselves never guess runtime library names.
    expect(run).toContain('sudo apt-get install -y xvfb xdotool imagemagick rpm rpm2cpio cpio');
    expect(run).not.toContain('libwebkit2gtk');
  });

  it('uploads screenshot and evidence artifacts that must exist', () => {
    for (const [job, shots] of [
      [windows, ['windows-screenshot.png']],
      [macos, ['mac-screenshot.png']],
      [linux, ['deb-screen.png', 'appimage-screen.png', 'rpm-screen.png', 'deb-notice.sha256', 'rpm-tree/rpm2cpio.log', 'openbox.log']],
    ] as [any, string[]][]) {
      const upload = job.steps.find((step: any) => step.uses === 'actions/upload-artifact@v4');
      expect(upload).toBeDefined();
      expect(upload.with['if-no-files-found']).toBe('error');
      for (const shot of shots) expect(upload.with.path).toContain(shot);
      expect(upload.with.path).toContain('sha256.log');
      expect(upload.with.path).toContain('release.json');
    }
  });

  it('the subset parser also handles the repo’s other real workflow (parser sanity)', () => {
    const smoke = parseWorkflowYaml(readFileSync(resolve(ROOT, '.github/workflows/windows-smoke.yml'), 'utf-8')) as any;
    expect(smoke.jobs.smoke['runs-on']).toBe('windows-latest');
    expect(smoke.jobs.smoke.steps.length).toBeGreaterThanOrEqual(10);
    expect(smoke.jobs.smoke.steps.some((step: any) => (step.run ?? '').includes('-ArgumentList "/S"'))).toBe(true);
    expect(smoke.jobs.smoke.steps.some((step: any) => (step.run ?? '').includes('CopyFromScreen'))).toBe(true);
  });
});

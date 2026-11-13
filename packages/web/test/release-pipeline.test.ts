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
import { readdirSync, readFileSync } from 'node:fs';
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

  it('ships the five BLE dependency licenses as desktop bundle resources', () => {
    const config = JSON.parse(readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/tauri.conf.json'), 'utf8'));
    expect(config.bundle.resources).toMatchObject({
      '../../../licenses/ble-peripheral-rust-MIT.txt': 'licenses/ble-peripheral-rust-MIT.txt',
      '../../../licenses/btleplug-LICENSE.md': 'licenses/btleplug-LICENSE.md',
      '../../../licenses/x25519-dalek-LICENSE': 'licenses/x25519-dalek-LICENSE',
      '../../../licenses/chacha20poly1305-LICENSE': 'licenses/chacha20poly1305-LICENSE',
      '../../../licenses/hkdf-LICENSE': 'licenses/hkdf-LICENSE',
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

  it('registers the WebView2 Runtime redistribution in the notice', () => {
    const notice = readFileSync(resolve(ROOT, 'NOTICE.md'), 'utf8');
    expect(notice).toContain('**Microsoft Edge WebView2 Runtime** (Microsoft Software License Terms');
    expect(notice).toContain('https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution');
    expect(notice).toContain('Evergreen Standalone Installer');
    const releasing = readFileSync(resolve(ROOT, 'docs/releasing.md'), 'utf8');
    expect(releasing).toContain('WebView2');
  });
});

describe('install guidance (offline installer + OS security prompts)', () => {
  it('both user guides explain the offline installer and both OS prompts', () => {
    const en = readFileSync(resolve(ROOT, 'docs/user-guide.en.md'), 'utf8');
    const zh = readFileSync(resolve(ROOT, 'docs/user-guide.zh.md'), 'utf8');
    for (const s of ['_x64-offline-setup.exe', 'Open Anyway', 'More info', 'Run anyway']) expect(en).toContain(s);
    for (const s of ['_x64-offline-setup.exe', '仍要打开', '更多信息', '仍要运行']) expect(zh).toContain(s);
  });
  it('every README download section mentions the offline Windows installer', () => {
    for (const file of ['README.md', 'README.zh-CN.md', 'README.zh-Hant.md', 'README.es.md', 'README.fr.md', 'README.tr.md', 'README.pt-BR.md', 'README.he.md']) {
      expect(readFileSync(resolve(ROOT, file), 'utf8'), file).toContain('_x64-offline-setup.exe');
    }
  });
  it('frames ≈130 MB as the WebView2 increment, never as a measured installer total', () => {
    const en = readFileSync(resolve(ROOT, 'docs/user-guide.en.md'), 'utf8');
    const zh = readFileSync(resolve(ROOT, 'docs/user-guide.zh.md'), 'utf8');
    const plan = readFileSync(resolve(ROOT, 'docs/superpowers/plans/2026-11-07-offline-install-distribution.md'), 'utf8');
    // ≈130 MB is the estimated size the embedded WebView2 Runtime ADDS over
    // the online installer; the actual total is only known once CI measures
    // it (manifest bytes -> release notes). Guides must not guess a total.
    expect(en).toContain('adds ≈130 MB over the online installer');
    expect(en).toContain('total size is measured');
    expect(en).toContain('listed in each release’s notes');
    expect(zh).toContain('比在线版约多 130 MB');
    expect(zh).toContain('实际总大小以 CI 实测为准');
    expect(plan).not.toContain('(larger, ≈130 MB;');
    // Review Focus 2 must not guess the offline exe's total either: ~127 MB
    // is the WebView2 increment over the online exe, never the payload size.
    expect(plan).toContain('~127 MB larger than the online exe');
    expect(plan).not.toContain('would ship a ~127 MB update');
  });
});

describe('public plan documents privacy hygiene', () => {
  it('tracked plan docs carry no personal absolute paths', () => {
    const dir = resolve(ROOT, 'docs/superpowers/plans');
    const plans = readdirSync(dir);
    expect(plans.length).toBeGreaterThan(0);
    for (const name of plans) {
      const text = readFileSync(resolve(dir, name), 'utf8');
      expect(text, name).not.toMatch(/\/Users\/[^\s`"')]+/);
      expect(text, name).not.toMatch(/\/home\/[^\s`"')]+/);
    }
  });
});

describe('not-verified environment registry', () => {
  it('releasing.md pins the remaining unverified items with explicit markers', () => {
    const releasing = readFileSync(resolve(ROOT, 'docs/releasing.md'), 'utf8');
    for (const s of [
      '未验环境清单',
      '无浏览器裸机冒烟',
      'NOT performed — no clean Windows 10 (without WebView2), macOS or Linux machine is available',
      'SmartScreen / Gatekeeper prompt screenshots: NOT captured',
    ]) expect(releasing).toContain(s);
    // The Homebrew tap went live 2026-11-09 (LYT259/homebrew-tap@e1455129)
    // and passed brew style / audit --online / livecheck plus a real isolated
    // install; the registry must no longer list it as unverified.
    expect(releasing).not.toContain('not yet created');
    expect(releasing).not.toContain('尚未对实际 tap 运行过');
    expect(releasing).not.toContain('当前无本地 tap');
    expect(releasing).not.toContain('以下三项');
  });
});

describe('homebrew tap distribution', () => {
  it('releasing.md records the published tap and its 2026-11-09 verification', () => {
    const releasing = readFileSync(resolve(ROOT, 'docs/releasing.md'), 'utf8');
    for (const s of [
      'LYT259/homebrew-tap',
      'e1455129',
      'brew style',
      'brew audit --cask --online',
      'brew livecheck',
      '2026-11-09',
      'brew trust LYT259/tap',
    ]) expect(releasing).toContain(s);
  });
  it('both user guides give the Homebrew 7 install steps with Releases as the direct download', () => {
    for (const file of ['docs/user-guide.en.md', 'docs/user-guide.zh.md']) {
      const md = readFileSync(resolve(ROOT, file), 'utf8');
      for (const s of [
        'brew tap LYT259/tap',
        'brew trust LYT259/tap',
        'brew install --cask LYT259/tap/pathblender',
        'https://github.com/LYT259/pathblender/releases',
      ]) expect(md, file).toContain(s);
    }
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
    // Windows checkouts carry CRLF; assert against LF-normalized content.
    const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
    expect(deploy).toContain('if: github.event.repository.private == false');
    expect(deploy).toContain('branches: [beta]');
    expect(deploy).toContain("VITE_VIEWER_ONLY: '1'");
    expect(workflow).toContain('if: github.event.repository.private == false');
    expect(workflow).toContain('needs: [build-macos, build-windows, build-linux]');
    expect(workflow).toContain('node scripts/prepare-release-artifacts.mjs');
  });
  // Behavioral double for the Pages deploy retry (review 2026-11-09 MAJOR-1):
  // the old shape (no continue-on-error + failure()) could never recover,
  // because a failed step sinks the job before the retry runs and a later
  // success cannot clear it. This test parses the deploy job's steps from
  // deploy.yml and EXECUTES them under a controlled model of GitHub's
  // documented semantics instead of asserting source strings.
  //
  // Simulation scope (deliberately narrow, no real deployment involved):
  // - uses-steps take their outcome from the scenario table below;
  // - plain run-steps (the sleep) succeed when executed;
  // - the closing gate step (a run: step containing `exit 1`) fails the job
  //   when its condition evaluates true;
  // - continue-on-error: a failed step records its outcome but does not
  //   fail the job (docs.github.com actions contexts);
  // - a skipped step has outcome 'skipped' and never runs;
  // - the job fails iff any executed step failed without continue-on-error.
  const deployWorkflow = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
  const deployJob = deployWorkflow.slice(deployWorkflow.indexOf('  deploy:\n'), deployWorkflow.indexOf('  deploy-cloudflare:'));
  const steps: Array<{ name: string; id?: string; if?: string; continueOnError: boolean; kind: 'uses' | 'run' | 'gate' }> = [];
  for (const m of deployJob.matchAll(/      - name: ([^\n]+)\n((?:        .+\n)+?)(?=      - |    outputs:|$)/g)) {
    const body = m[2];
    const id = /        id: (\S+)/.exec(body)?.[1];
    const cond = /        if: ([^\n]+)/.exec(body)?.[1].trim();
    const continueOnError = /        continue-on-error: true/.test(body);
    const kind = body.includes('exit 1') ? 'gate' : body.includes('uses:') ? 'uses' : 'run';
    steps.push({ name: m[1], id, if: cond, continueOnError, kind });
  }
  // Minimal evaluator for the expression grammar this job uses:
  // steps.<id>.outcome [!=|==] 'success' (&& same)*
  const evalCond = (cond: string | undefined, outcomes: Record<string, string>): boolean => {
    if (!cond) return true;
    return cond.split('&&').every((clause) => {
      const m = /steps\.(\w+)\.outcome\s*([!=]=)\s*'success'/.exec(clause.trim());
      if (!m) throw new Error(`unmodeled condition grammar: ${clause.trim()}`);
      const actual = outcomes[m[1]!] ?? 'skipped';
      return m[2] === '!=' ? actual !== 'success' : actual === 'success';
    });
  };
  const runJob = (attempt1: string, retryWhenRun: string): 'success' | 'failure' => {
    const outcomes: Record<string, string> = {};
    let jobFailed = false;
    for (const step of steps) {
      if (!evalCond(step.if, outcomes)) {
        if (step.id) outcomes[step.id] = 'skipped';
        continue;
      }
      let failed = false;
      if (step.kind === 'uses') {
        const outcome = step.id === 'deploy1' ? attempt1 : step.id === 'deploy2' ? retryWhenRun : 'success';
        if (step.id) outcomes[step.id] = outcome;
        failed = outcome !== 'success';
      } else if (step.kind === 'gate') {
        failed = true;
      }
      if (failed && !step.continueOnError) jobFailed = true;
    }
    return jobFailed ? 'failure' : 'success';
  };
  it('retry state machine: first-attempt success needs no retry', () => {
    expect(steps.find((s) => s.id === 'deploy1')?.continueOnError).toBe(true);
    expect(steps.find((s) => s.id === 'deploy2')?.continueOnError).toBeFalsy();
    expect(runJob('success', 'skipped')).toBe('success');
  });
  it('retry state machine: platform timeout then successful retry recovers the job', () => {
    expect(runJob('failure', 'success')).toBe('success');
  });
  it('retry state machine: both attempts failing sinks the job for verify', () => {
    expect(runJob('failure', 'failure')).toBe('failure');
  });
  it('retry state machine: the old shape (no continue-on-error, failure()-keyed) cannot recover', () => {
    // Counterfactual guard: apply the OLD step shape to the same model and
    // show the recovery scenario stays failed — proving this test detects
    // the regression it was written for, not just the happy path.
    const oldShape = steps.map((s) => ({
      ...s,
      continueOnError: false,
      if: s.if?.includes('steps.deploy1.outcome') ? 'failure()' : s.if,
    }));
    const runOld = (attempt1: string, retryWhenRun: string): string => {
      const outcomes: Record<string, string> = {};
      let jobFailed = false;
      for (const step of oldShape) {
        const cond = step.if === 'failure()' ? jobFailed : (() => { try { return evalCond(step.if, outcomes); } catch { return true; } })();
        if (!cond) { if (step.id) outcomes[step.id] = 'skipped'; continue; }
        let failed = false;
        if (step.kind === 'uses') {
          const outcome = step.id === 'deploy1' ? attempt1 : step.id === 'deploy2' ? retryWhenRun : 'success';
          if (step.id) outcomes[step.id] = outcome;
          failed = outcome !== 'success';
        } else if (step.kind === 'gate') failed = true;
        if (failed && !step.continueOnError) jobFailed = true;
      }
      return jobFailed ? 'failure' : 'success';
    };
    expect(runOld('failure', 'success')).toBe('failure');
  });

  it('mirrors the same viewer build to Cloudflare Pages and verifies both sites', () => {
    const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
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
    // Verification binds to THIS build's full cache identifier (version +
    // build timestamp) and refuses to go green when any deployment failed
    // (acceptance 2026-11-06: a version-only compare passed while Pages was
    // down and the mirror had the new build).
    expect(deploy).toContain('outputs:\n      cache_name: ${{ steps.cache.outputs.name }}');
    expect(deploy).toContain('needs: [build, deploy, deploy-cloudflare]');
    expect(deploy).toContain('Require every deployment to have succeeded');
    expect(deploy).toContain('"$cache" = "$expected"');
    expect(deploy).not.toContain('"$version" = "$expected"');
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
    for (const f of [
      'licenses/FRCDesignApp-MIT.txt',
      'licenses/ble-peripheral-rust-MIT.txt',
      'licenses/btleplug-LICENSE.md',
      'licenses/x25519-dalek-LICENSE',
      'licenses/chacha20poly1305-LICENSE',
      'licenses/hkdf-LICENSE',
    ]) expect(script, `packaging script must check ${f}`).toContain(f);
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
    for (const f of [
      'licenses/FRCDesignApp-MIT.txt',
      'licenses/ble-peripheral-rust-MIT.txt',
      'licenses/btleplug-LICENSE.md',
      'licenses/x25519-dalek-LICENSE',
      'licenses/chacha20poly1305-LICENSE',
      'licenses/hkdf-LICENSE',
    ]) expect(run, `release-verify mac mount check must cover ${f}`).toContain(f);
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

describe('Windows offline NSIS overlay config', () => {
  const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
  it('flips only webviewInstallMode to offlineInstaller', () => {
    const overlay = read('packages/desktop/src-tauri/tauri.windows-offline.conf.json');
    expect(overlay.bundle.windows.webviewInstallMode).toEqual({ type: 'offlineInstaller' });
    expect(Object.keys(overlay.bundle.windows)).toEqual(['webviewInstallMode']);
    expect(Object.keys(overlay.bundle)).toEqual(['windows']);
    expect(Object.keys(overlay).filter((k) => k !== '$schema')).toEqual(['bundle']);
  });
  it('keeps the base config on the online installer and updater untouched', () => {
    const base = read('packages/desktop/src-tauri/tauri.conf.json');
    expect(base.bundle.windows.webviewInstallMode).toEqual({ type: 'downloadBootstrapper' });
    expect(base.bundle.createUpdaterArtifacts).toBe(true);
    expect(base.plugins.updater.endpoints).toContain('https://github.com/LYT259/pathblender/releases/latest/download/latest.json');
  });
});

describe('Windows offline installer pipeline', () => {
  it('release.yml builds the overlay, renames to the pinned offline name and uploads windows-offline', () => {
    expect(workflow).toContain('--config src-tauri/tauri.windows-offline.conf.json --bundles nsis');
    expect(workflow).toContain('release-offline/PathBlender_${V}_x64-offline-setup.exe');
    expect(workflow).toContain('name: windows-offline');
    // The online pair is staged BEFORE the offline build overwrites bundle/nsis.
    const stageOnline = workflow.indexOf('cp packages/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe release/');
    const offlineBuild = workflow.indexOf('--config src-tauri/tauri.windows-offline.conf.json');
    expect(stageOnline).toBeGreaterThan(-1);
    expect(offlineBuild).toBeGreaterThan(stageOnline);
  });
  it('beta-verify builds, size-checks, installs and launches the offline installer', () => {
    const beta = readFileSync(resolve(ROOT, '.github/workflows/beta-verify.yml'), 'utf-8');
    const windows = beta.slice(beta.indexOf('  windows:'), beta.indexOf('  macos:'));
    expect(windows).toContain('--config src-tauri/tauri.windows-offline.conf.json');
    expect(windows).toContain('104857600');
    expect(windows).toContain('_x64-offline-setup.exe');
    expect(windows).toContain('-ArgumentList "/S"');
  });
  it('opens Preferences and finds the channel control on the actual Windows candidate build', () => {
    const beta = readFileSync(resolve(ROOT, '.github/workflows/beta-verify.yml'), 'utf-8');
    const windows = beta.slice(beta.indexOf('  windows:'), beta.indexOf('  macos:'));
    // update-verify intentionally uses only published artifacts, so it cannot
    // prove a branch-side blank-window fix. The PR's own Windows package must
    // open Preferences through the native Help menu and expose its combobox.
    expect(windows).toContain('Open Preferences on the candidate build');
    expect(windows).toContain('"Help"');
    expect(windows).toContain('"Check for updates"');
    expect(windows).toContain('[System.Windows.Automation.ControlType]::ComboBox');
    expect(windows.indexOf('Open Preferences on the candidate build')).toBeLessThan(windows.indexOf('Stop the online-installed PathBlender before the offline install'));
  });
  it('release-verify downloads, digest-pins, size-floors, installs and launches the offline asset', () => {
    const verifyText2 = readFileSync(resolve(ROOT, '.github/workflows/release-verify.yml'), 'utf-8');
    const windows = verifyText2.slice(verifyText2.indexOf('  windows-installer:'), verifyText2.indexOf('  macos-intel-dmg:'));
    for (const s of [
      'PathBlender_${VER}_x64-offline-setup.exe',
      'sha256-offline.log',
      '104857600',
      'offline installer is smaller than 100 MiB',
    ]) expect(windows).toContain(s);
    expect((windows.match(/-ArgumentList "\/S"/g) ?? []).length).toBe(2);
  });
  it('stops leftover online-launched PathBlender processes before each offline install', () => {
    const beta = readFileSync(resolve(ROOT, '.github/workflows/beta-verify.yml'), 'utf-8');
    const betaWin = beta.slice(beta.indexOf('  windows:'), beta.indexOf('  macos:'));
    const rel = readFileSync(resolve(ROOT, '.github/workflows/release-verify.yml'), 'utf-8');
    const relWin = rel.slice(rel.indexOf('  windows-installer:'), rel.indexOf('  macos-intel-dmg:'));
    // The online assert step leaves the app running; the offline install
    // must not reinstall over a live process, and the offline launch assert
    // must not be satisfied by that leftover process.
    const cases: Array<[string, string, string]> = [
      ['beta-verify', betaWin, 'Silent install (offline)'],
      ['release-verify', relWin, 'Silently install the offline installer'],
    ];
    for (const [label, job, installStep] of cases) {
      const stop = job.indexOf('Stop the online-installed PathBlender before the offline install');
      const install = job.indexOf(installStep);
      expect(stop, `${label}: stop step missing`).toBeGreaterThan(-1);
      expect(install, `${label}: offline install step missing`).toBeGreaterThan(-1);
      expect(stop, `${label}: stop must precede the offline install`).toBeLessThan(install);
      const stopBlock = job.slice(stop, install);
      // Targeted stop: only the app's own pinned process name, never a
      // broad kill (wildcards, window-title matching) that could hit
      // unrelated processes. The kill itself must be per-PID on exactly
      // those enumerated processes, under pwsh (the syntax is PowerShell),
      // and the wait must poll with a real deadline before giving up.
      expect(stopBlock, label).toContain('shell: pwsh');
      expect(stopBlock, label).toContain('Get-Process -Name "pathblender-desktop"');
      expect(stopBlock, label).toContain('Stop-Process -Id $p.Id -Force');
      expect(stopBlock, label).not.toContain('Stop-Process -Name');
      expect(stopBlock, label).toContain('AddSeconds(30)');
      expect(stopBlock, label).toContain('Start-Sleep -Milliseconds 500');
      expect(stopBlock, label).toContain('$ErrorActionPreference = "Stop"');
      // A survivor must fail the job — the stop must not be swallowed.
      expect(stopBlock, label).toContain('::error::');
      expect(stopBlock, label).toContain('exit 1');
      expect(stopBlock, label).not.toContain('|| true');
    }
  });
});

describe('update chain verification workflow (update-verify.yml)', () => {
  const text = readFileSync(resolve(ROOT, '.github/workflows/update-verify.yml'), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wf = parseWorkflowYaml(text) as any;
  const job = wf.jobs['windows-update'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (job.steps as any[]).map((step: any) => step.run ?? '').join('\n');

  it('dispatches manually only, with read-only permissions and a public-repo guard', () => {
    expect(wf.on.workflow_dispatch.inputs.from_tag).toMatchObject({ default: 'v0.1.10-beta.16', required: 'true' });
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.pull_request).toBeUndefined();
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job['runs-on']).toBe('windows-latest');
    expect(job['timeout-minutes']).toBe('45');
    expect(job.if).toBe('github.event.repository.private == false');
  });

  it('verifies published artifacts only — no checkout, no rebuild, no repo secret material', () => {
    expect((job.steps as any[]).some((step: any) => step.uses === 'actions/checkout@v4')).toBe(false);
    for (const banned of ['npx tauri build', 'npm ci', 'cargo ', 'tauri signer generate', 'secrets.', 'GITHUB_TOKEN', 'GH_TOKEN']) {
      expect(text, `must not contain ${banned}`).not.toContain(banned);
    }
    // The only credential-shaped env var is the built-in read-only token for
    // release METADATA (anonymous API hits shared-runner-IP 403 limits);
    // every asset and feed download stays anonymous.
    expect((text.match(/GH_METADATA_TOKEN: \$\{\{ github\.token \}\}/g) ?? []).length).toBe(1);
  });

  it('takes the TARGET version from the live feed, never from a workflow input', () => {
    expect(run).toContain('releases/latest/download/latest-beta.json');
    expect(run).toContain('platforms["windows-x86_64"]');
    expect(run).toContain('feed has no signed windows-x86_64 entry');
    // The old version must sort below the feed version, or the run is
    // measuring "no update available", not the takeover chain.
    expect(run).toContain('TARGET version');
    expect(run).toContain('must sort below');
  });

  it('downloads the old installer anonymously and pins it against the server-side digest', () => {
    expect(run).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+');
    expect(run).toContain('browser_download_url');
    expect(run).toContain('/^sha256:[0-9a-f]{64}$/');
    expect(run).toContain('sha256 mismatch');
    expect(run).toContain('size mismatch');
    expect(run).toContain('curl -fL --retry 3 -o "dl/$WANT" "$URL"');
    const downloadLine = text.split('\n').find((l) => l.includes('curl -fL --retry 3'));
    expect(downloadLine).toBeDefined();
    expect(downloadLine).not.toContain('Authorization');
  });

  it('installs and launches the OLD version first and asserts it', () => {
    expect(run).toContain('-ArgumentList "/S"');
    expect(run).toContain('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    expect(run).toContain('Join-Path $installDir "pathblender-desktop.exe"');
    expect(run).toContain('VersionInfo.ProductVersion');
    expect(run).toContain('FROM_VERSION');
    expect(run).toContain('Get-Process -Name "pathblender-desktop"');
    expect(run).toContain('MainWindowTitle');
  });

  it('drives the real UI — no test hooks, no injected state', () => {
    expect(run).toContain('System.Windows.Automation');
    expect(run).toContain('"Update channel"');
    expect(run).toContain('"Beta"');
    expect(run).toContain('"Save"');
    expect(run).toContain('"Check for updates"');
    expect(run).toContain('"Install and relaunch"');
    // Saved-channel semantics: the draft channel must be SAVED before the
    // check, and the fallback clicks are the prefs two-step flow.
    expect(run).toContain('Updates');
  });

  it('watches the real NSIS takeover: old process exits, file bumps, app returns', () => {
    // The install click / channel save is followed by a bounded poll that
    // distinguishes an installer-driven relaunch from a manual one — both
    // recorded, neither assumed.
    expect(run).toContain('old process still running');
    expect(run).toContain('auto-relaunch');
    expect(run).toContain('relaunched manually by the workflow');
    expect(run).toContain('TO_VERSION');
    expect(run).toContain('CopyFromScreen');
    expect((job.steps as any[]).some((step: any) => step.uses === 'actions/upload-artifact@v4')).toBe(true);
  });

  it('detects the takeover by the OLD pid exiting, not by "no same-name process left"', () => {
    // A fast installer can exit the old app and start the new one between
    // two 500ms polls: an all-gone check then never fires while the dead
    // prefs window invites stray clicks on stale UIA elements. The watch
    // must key on the recorded $oldPid, and the all-gone condition must
    // stay out of the watch loop.
    expect(run).toContain('$oldAlive = Get-Process -Id $oldPid');
    expect(run).toContain('if (-not $oldAlive) { $flow = "channel-switch auto"; break }');
    expect(run).not.toContain('if (-not $alive) { $flow = "channel-switch auto"; break }');
  });

  it('re-checks the old pid at every decision point of the drive and reads a dead-window UIA failure as the takeover', () => {
    // The fallback's element waits can span the moment the channel-switch
    // install exits the old process: without re-checks, the next
    // Wait-Element runs $Root.FindAll on a dead window and a normal
    // update fails as a UIA crash. Five probe points are required: the
    // watch entry, the catch arm that must re-throw while the old
    // process is still alive (real UIA errors stay failures), the
    // post-loop guard (own test below), and phase 1's loop condition
    // plus its final re-query.
    expect((run.match(/Get-Process -Id \$oldPid -ErrorAction SilentlyContinue/g) ?? []).length).toBe(5);
    expect(run).toMatch(/\} catch \{\r?\n\s*if \(-not \(Get-Process -Id \$oldPid -ErrorAction SilentlyContinue\)\) \{ \$flow = "channel-switch auto"; break \}\r?\n\s*throw/);
  });

  it('consumes a found update before clicking check, and rate-limits check clicks', () => {
    // PreferencesPanel hides the install button while a check is in
    // flight, and a re-click resets a completed check back to checking
    // (clearing the button). The fallback must therefore (a) poll for
    // the install button FIRST each iteration so a check that completed
    // after the previous poll is consumed, and (b) re-click check at
    // most once per 45s — comfortably longer than a feed check — so an
    // in-flight check is never reset (the review simulated livelocks
    // at 5s and 25s per check; both must terminate with the install
    // button clicked).
    const checkClickIdx = run.indexOf('Invoke-Element $check');
    expect(checkClickIdx).toBeGreaterThan(0);
    const installPollIdx = run.indexOf('Wait-Element $prefs "Install and relaunch" 3');
    expect(installPollIdx).toBeGreaterThan(0);
    expect(installPollIdx).toBeLessThan(checkClickIdx);
    expect((run.match(/Invoke-Element \$check/g) ?? []).length).toBe(1);
    expect(run).toContain('if (($watch.Elapsed.TotalSeconds - $lastCheckAt) -ge 45) {');
    expect(run).toMatch(/Invoke-Element \$check\r?\n\s*\$lastCheckAt = \$watch\.Elapsed\.TotalSeconds/);
  });

  it('reads an empty flow with the old process already gone as a takeover, not a failure', () => {
    // The 150s watch window can expire between the final fallback probe
    // and the next loop-entry check: the takeover lands inside the last
    // element wait, Wait-Element returns null WITHOUT throwing (so the
    // catch arm never runs), and the loop exits with an empty flow while
    // the old process is already gone. The guard must sit OUTSIDE the
    // watch loop — pinned by brace-matching the loop's closing brace,
    // not by indentation (PowerShell scopes by braces) — and before the
    // empty-flow ::error::; a still-live old process keeps the failure
    // semantics (phase 2 then re-asserts the file version).
    const watchIdx = run.indexOf('while ($watch.Elapsed.TotalSeconds -lt 150) {');
    expect(watchIdx).toBeGreaterThan(0);
    let depth = 0;
    let loopEnd = -1;
    for (let i = run.indexOf('{', watchIdx); i < run.length; i++) {
      if (run[i] === '{') depth++;
      else if (run[i] === '}') { depth--; if (depth === 0) { loopEnd = i; break; } }
    }
    expect(loopEnd, 'watch loop closing brace not found').toBeGreaterThan(watchIdx);
    const guardIdx = run.indexOf('if (-not $flow) {', loopEnd);
    expect(guardIdx).toBeGreaterThan(loopEnd);
    const probe = 'if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) { $flow = "channel-switch auto" }';
    expect(run.slice(guardIdx, guardIdx + 700)).toContain(probe);
    const failIdx = run.indexOf('::error::neither the channel-switch install nor the prefs two-step produced an install');
    expect(failIdx).toBeGreaterThan(guardIdx);
    const phase1Idx = run.indexOf('# Takeover phase 1:');
    expect(phase1Idx).toBeGreaterThan(failIdx);
  });

  it('phase 1 re-queries the old pid before declaring the takeover failed', () => {
    // The 180s deadline can expire during the last 500ms sleep with the
    // old process exiting inside it: trusting the loop's last
    // observation then fails a takeover that actually happened. The
    // loop condition must query fresh every iteration and the failure
    // branch must re-query again instead of reusing a stale object.
    expect(run).toMatch(/do \{\r?\n\s*Start-Sleep -Milliseconds 500\r?\n\s*\} while \(\(Get-Date\) -lt \$deadline -and \(Get-Process -Id \$oldPid -ErrorAction SilentlyContinue\)\)/);
    expect(run).toMatch(/if \(Get-Process -Id \$oldPid -ErrorAction SilentlyContinue\) \{ Write-Host "::error::old process still running/);
    expect(run).not.toContain('$alive = Get-Process -Name "pathblender-desktop" -ErrorAction SilentlyContinue | Where-Object');
  });

  it('reports every failure path with an explicit ::error:: annotation', () => {
    // Fail-closed alone is not enough on CI: the feed download, the feed
    // parse and the UIA invoke fallback all need a visible ::error:: marker
    // in the step log, not just a bare non-zero exit.
    expect(run).toContain('::error::failed to download latest-beta.json');
    expect(run).toContain('::error::latest-beta.json is not valid JSON');
    expect(run).toContain('::error::element not invokable');
  });

  it('carries the install dir between the pwsh steps via GITHUB_ENV (steps run in separate processes)', () => {
    const steps = job.steps as any[];
    const installStep = steps.find((s: any) => (s.name ?? '').includes('Install, launch and assert'));
    const driveStep = steps.find((s: any) => (s.name ?? '').includes('Drive the real UI'));
    expect(installStep).toBeDefined();
    expect(driveStep).toBeDefined();
    // PowerShell variables do NOT survive across run: steps — the install
    // step must export the resolved dir and the drive step must re-derive
    // $exe from $env:, or the takeover watcher dies on a null -Path.
    expect(installStep.run).toContain('INSTALL_DIR=');
    expect(installStep.run).toContain('$env:GITHUB_ENV');
    expect(driveStep.run).toContain('$installDir = $env:INSTALL_DIR');
    expect(driveStep.run).toContain('$exe = Join-Path $installDir "pathblender-desktop.exe"');
  });

  it('opens the channel combobox even when UIA exposes only ExpandCollapse, not Invoke', () => {
    // The channel control is a role="combobox" <button> (SelectControl.tsx);
    // UIA may expose only ExpandCollapsePattern for it, so the click helper
    // must fall back to Expand before giving up.
    expect(run).toContain('ExpandCollapsePattern');
  });

  it('finds the update channel by native ComboBox role when its text label is not exposed', () => {
    // Run 43393373576 opened Preferences through the native Help menu but
    // could not find Name="Update channel". The single combobox on the
    // Updates pane is SelectControl (PreferencesPanel.tsx). Preserve the
    // accessible-name path, then fall back to the native role and log the
    // remaining UIA names/types instead of failing without diagnostics.
    const nameLookup = run.indexOf('Wait-Element $prefs "Update channel"');
    const roleFallback = run.indexOf('Wait-ControlType $prefs ([System.Windows.Automation.ControlType]::ComboBox)');
    expect(nameLookup).toBeGreaterThan(0);
    expect(run).toContain('function Wait-ControlType');
    expect(roleFallback, 'native ComboBox role fallback missing').toBeGreaterThan(nameLookup);
    expect(run.indexOf('Invoke-Element $channel')).toBeGreaterThan(roleFallback);
    expect(run).toContain('uia diagnostic:');
    // The diagnostics capture the Preferences pane itself and must survive a
    // failed drive, not merely the initial window and the completed update.
    expect(run.match(/prefs-open\.png/g) ?? []).toHaveLength(1);
    expect(text.match(/prefs-open\.png/g) ?? []).toHaveLength(2);
  });

  it('creates the Preferences webview off the synchronous Windows menu thread', () => {
    // The real run 43396146347 shows a native Preferences frame with a blank
    // webview. Tauri documents WebviewWindowBuilder.build() as deadlocking in
    // synchronous commands/event handlers on Windows; creation must move to a
    // separate thread while the existing-window focus/eval path stays intact.
    const rust = readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/src/lib.rs'), 'utf-8');
    const start = rust.indexOf('fn open_prefs(');
    const end = rust.indexOf('\nfn create_prefs_window', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const opener = rust.slice(start, end);
    expect(opener).toContain('#[cfg(target_os = "windows")]');
    expect(opener).toContain('std::thread::spawn');
    expect(opener).toContain('create_prefs_window');
  });

  it('opens Preferences by expanding the native Help menu — no Ctrl+, SendKeys (dead on Windows)', () => {
    // Run 43390027355 proved the opener dead: CmdOrCtrl+, only exists in the
    // macOnly app menu (menu-spec.ts; build_menu_from_spec skips mac_only on
    // Windows, so the native menu has no Preferences item/accelerator) and
    // the web keydown handler early-returns on ctrl/meta — SendKeys "^," is
    // a no-op regardless of focus. The drive must instead expand the Help
    // menu-bar item and invoke its entries, with the Expand BEFORE the
    // dropdown-item search (a collapsed Win32 dropdown is not an invokable
    // descendant of the app window — the old fallback timed out on it).
    expect(run).not.toContain('SendWait("^,")');
    const helpFnIdx = run.indexOf('function Open-HelpMenuItem');
    expect(helpFnIdx, 'Help menu opener helper missing').toBeGreaterThan(0);
    const helpIdx = run.indexOf('"Help"', helpFnIdx);
    expect(helpIdx, 'Help menu-bar item lookup missing').toBeGreaterThan(helpFnIdx);
    const expandIdx = run.indexOf('$pat.Expand()', helpFnIdx);
    expect(expandIdx, 'menu Expand call missing').toBeGreaterThan(helpIdx);
    const checkIdx = run.indexOf('Open-HelpMenuItem "Check for updates"');
    expect(checkIdx, 'Check for updates menu invocation missing').toBeGreaterThan(expandIdx);
  });

  it('falls back to the About PathBlender menu entry before declaring the opener failed', () => {
    // Help > About PathBlender opens the plain Preferences window on desktop
    // (menuHandlers 'about'); it is the second menu attempt, and the failure
    // error only fires after both.
    const checkIdx = run.indexOf('Open-HelpMenuItem "Check for updates"');
    const aboutIdx = run.indexOf('Open-HelpMenuItem "About PathBlender"');
    expect(checkIdx).toBeGreaterThan(0);
    expect(aboutIdx).toBeGreaterThan(checkIdx);
    const failIdx = run.indexOf('::error::Preferences window never opened');
    expect(failIdx).toBeGreaterThan(aboutIdx);
  });

  it('searches the open dropdown both under the expanded item and under the desktop-root menu popup', () => {
    // A Win32 menu dropdown is a #32768 popup parented to the DESKTOP root,
    // not to the app window: the finder must cover the expanded bar item's
    // subtree AND root's child Menu windows, or a healthy menu looks empty.
    expect(run).toContain('[System.Windows.Automation.ControlType]::Menu');
    expect(run).toContain('RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $menuCond)');
  });

  it('invokes menu items via LegacyIAccessible DoDefaultAction when Invoke is absent, and logs menu discovery', () => {
    // Win32 menu items sometimes expose only the legacy MSAA pattern; the
    // item invoker must try Invoke then DoDefaultAction. And because this
    // workflow forbids screenshot viewing for diagnosis, the discovered
    // top-level menu names land in the step log AND update-log.txt.
    expect(run).toContain('LegacyIAccessiblePattern');
    expect(run).toContain('DoDefaultAction()');
    expect(run).toMatch(/Log-Line "menu bar: \$\(/);
    const logFn = run.slice(run.indexOf('function Log-Line'), run.indexOf('function Log-Line') + 400);
    expect(logFn).toContain('Write-Host');
    expect(logFn).toContain('Out-File -FilePath update-log.txt -Append');
  });

  it('orders prerelease identifiers numerically per semver §11 — beta.9 must gate-pass below beta.10', () => {
    // The FROM<TARGET gate runs as an inline node script inside the step.
    // Execute the very script the workflow ships (extracted from the run
    // text) so the contract is behavior, not a string match: lexicographic
    // "beta.9" < "beta.10" is false, which used to misread a real published
    // update as "no update to take" and abort the run before it started.
    // Several node -e scripts live in the run text; each closes at its own
    // trailing quote (they contain no single quotes), and the gate is the
    // one that fails the step with "must sort below".
    const scripts = [...run.matchAll(/node -e '\n([\s\S]*?)'/g)].map((x) => x[1]);
    const gateScript = scripts.find((s) => s.includes('must sort below'));
    if (!gateScript) throw new Error('FROM<TARGET gate script not found in the run text');
    const gateAllows = (from: string, to: string): boolean => {
      let code = 0;
      const fakeProcess = { argv: ['node', from, to], exit: (c: number) => { code = c; } };
      new Function('process', 'console', gateScript)(fakeProcess, { error: () => undefined });
      return code === 0;
    };
    const updates: Array<[string, string]> = [
      ['0.1.10-beta.9', '0.1.10-beta.10'],
      ['0.1.10-beta.16', '0.1.10-beta.17'],
      ['0.1.10-beta.2', '0.1.10-beta.10'],
      ['0.1.10-beta.9', '0.1.10-beta.9.1'],
      ['0.1.10-beta.9', '0.1.10-beta.9x'],
      ['0.1.9-beta.9', '0.1.10-beta.9'],
      ['0.1.10-beta.17', '0.1.10'],
      // Hyphens are legal INSIDE alphanumeric prerelease identifiers
      // (semver §9-§11): the prerelease is everything after the FIRST
      // hyphen, so splitting on every hyphen truncates "beta.9-a" to
      // "beta.9" and misreads a real update as a downgrade.
      ['0.1.10-beta.9-a', '0.1.10-beta.9-b'],
      ['0.1.10-rc.1-x.2', '0.1.10-rc.1-x.10'],
      ['0.1.10-beta.10', '0.1.10-beta.10-a'],
    ];
    for (const [from, to] of updates) {
      expect(gateAllows(from, to), `${from} must be accepted as sorting below ${to}`).toBe(true);
    }
    const notUpdates: Array<[string, string]> = [
      ['0.1.10-beta.17', '0.1.10-beta.17'],
      ['0.1.10-beta.10', '0.1.10-beta.9'],
      ['0.1.10-beta.10', '0.1.10-beta.9.1'],
      ['0.1.10', '0.1.10-beta.17'],
      ['0.1.10-beta.9-b', '0.1.10-beta.9-a'],
      ['0.1.10-beta.9-x', '0.1.10-beta.9-a'],
      // Numeric identifiers sit BELOW alphanumeric ones (semver §11), so
      // beta.10 < beta.9-a: that pair is a downgrade, not an update.
      ['0.1.10-beta.9-a', '0.1.10-beta.10'],
    ];
    for (const [from, to] of notUpdates) {
      expect(gateAllows(from, to), `${from} must be rejected against ${to}`).toBe(false);
    }
  });

  it('uploads the evidence artifacts even when the run fails — without swallowing the failure', () => {
    const steps = job.steps as any[];
    const upload = steps.find((s: any) => s.uses === 'actions/upload-artifact@v4');
    expect(upload).toBeDefined();
    // Failure evidence (screenshots, update-log.txt) is the whole point of
    // this workflow's artifacts: a failed drive/takeover step must still
    // upload what it produced, not only green runs.
    expect(upload?.if).toBe('always()');
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    // always() must not degrade into failure masking: no step may swallow
    // its own failure, and the run steps keep their explicit ::error:: exits.
    for (const step of steps) {
      expect(step['continue-on-error'], `${step.name ?? step.uses}: continue-on-error must stay off`).toBeUndefined();
    }
    expect((run.match(/::error::/g) ?? []).length).toBeGreaterThan(0);
  });
});

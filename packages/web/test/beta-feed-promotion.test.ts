import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { compareVersions, planPromotion } from '../../../scripts/promote-beta-feed.mjs';

function release(tag: string, assets: string[]) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-beta.'),
    assets: assets.map(name => ({ name, state: 'uploaded', size: 100 })),
  };
}

describe('beta feed promotion recovery', () => {
  it('repairs the actual latest stable even when its beta feed disappeared', () => {
    const latest = release('v0.1.9', ['latest.json']);
    const plan = planPromotion([
      release('v0.1.8', ['latest.json', 'latest-beta.json']),
      latest,
      release('v0.1.10-beta.5', ['latest-beta.json']),
    ], latest);
    expect(plan).toEqual({
      sourceTag: 'v0.1.10-beta.5',
      sourceAsset: 'latest-beta.json',
      destinationTag: 'v0.1.9',
    });
  });

  it('uses the canonical stable feed and the API-selected latest destination', () => {
    const latest = release('v0.1.9', ['latest.json']);
    expect(planPromotion([
      latest,
      release('v0.1.10', ['latest.json', 'latest-beta.json']),
      release('v0.1.10-beta.12', ['latest-beta.json']),
    ], latest)).toEqual({
      sourceTag: 'v0.1.10', sourceAsset: 'latest.json', destinationTag: 'v0.1.9',
    });
    expect(compareVersions('0.1.10-beta.12', '0.1.10-beta.9')).toBe(1);
  });

  it('ignores draft or incomplete sources and rejects an invalid destination', () => {
    const stable = release('v0.1.9', ['latest.json']);
    expect(planPromotion([
      stable,
      { ...release('v0.1.10-beta.6', ['latest-beta.json']), draft: true },
      release('v0.1.10-beta.5', []),
      { ...release('v0.1.10-beta.4', []), assets: [{ name: 'latest-beta.json', state: 'new', size: 0 }] },
    ], stable).sourceTag).toBe('v0.1.9');
    expect(() => planPromotion([], stable)).toThrow('No completed');
    expect(() => planPromotion([stable], { ...stable, prerelease: true })).toThrow('stable');
  });
});

describe('beta feed promotion against a real gh invocation', () => {
  it('reads paginated releases larger than the default 1 MiB exec buffer and promotes the feed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pb-feed-promote-'));
    try {
      const state = join(root, 'state');
      const bin = join(root, 'bin');
      mkdirSync(state);
      mkdirSync(bin);
      const pad = 'release notes regression padding for the beta feed promotion test. ';
      const beta = {
        tag_name: 'v0.1.10-beta.23',
        draft: false,
        prerelease: true,
        body: pad.repeat(Math.ceil((2.5 * 1024 * 1024) / pad.length)),
        assets: [{ name: 'latest-beta.json', state: 'uploaded', size: 23082 }],
      };
      const stable = {
        tag_name: 'v0.1.9',
        draft: false,
        prerelease: false,
        assets: [{ name: 'latest.json', state: 'uploaded', size: 23081 }],
      };
      const releases = JSON.stringify([[beta, stable]]);
      expect(Buffer.byteLength(releases)).toBeGreaterThan(2 * 1024 * 1024);
      writeFileSync(join(state, 'releases.json'), releases);
      writeFileSync(join(state, 'latest.json'), JSON.stringify(stable));
      const feed = JSON.stringify({ version: '0.1.10-beta.23', pub_date: '2026-11-13T12:00:00Z', platforms: {} });
      writeFileSync(join(state, 'latest-beta-feed.json'), feed);
      const fakeGh = [
        '#!/usr/bin/env node',
        'const { copyFileSync, readFileSync, writeFileSync, writeSync } = require(\'node:fs\');',
        'const { join } = require(\'node:path\');',
        'const state = process.env.FAKE_GH_STATE;',
        'const args = process.argv.slice(2);',
        'if (args[0] === \'api\') {',
        '  const file = args.includes(\'--paginate\') ? \'releases.json\' : \'latest.json\';',
        '  const data = readFileSync(join(state, file));',
        '  let offset = 0;',
        '  while (offset < data.length) offset += writeSync(1, data, offset, data.length - offset);',
        '  process.exit(0);',
        '}',
        'if (args[0] === \'release\' && args[1] === \'download\') {',
        '  const dir = args[args.indexOf(\'--dir\') + 1];',
        '  const pattern = args[args.indexOf(\'--pattern\') + 1];',
        '  writeFileSync(join(dir, pattern), readFileSync(join(state, \'latest-beta-feed.json\'), \'utf8\'));',
        '  process.exit(0);',
        '}',
        'if (args[0] === \'release\' && args[1] === \'upload\') {',
        '  copyFileSync(args[3], join(state, \'uploaded-latest-beta.json\'));',
        '  process.exit(0);',
        '}',
        'process.stderr.write(\'fake gh: unexpected invocation \' + JSON.stringify(args) + \'\\n\');',
        'process.exit(64);',
        ''
      ].join('\n');
      writeFileSync(join(bin, 'gh'), fakeGh);
      chmodSync(join(bin, 'gh'), 0o755);
      const script = resolve(__dirname, '../../../scripts/promote-beta-feed.mjs');
      const stdout = execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'acme/widget',
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          FAKE_GH_STATE: state,
        },
      }).trim();
      expect(stdout).toBe('Promoted 0.1.10-beta.23 onto v0.1.9');
      expect(readFileSync(join(state, 'uploaded-latest-beta.json'), 'utf8')).toBe(feed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

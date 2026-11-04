import { describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { docsOnly, checkVersion, classify } from '../../../scripts/beta-change-policy.mjs';

describe('beta publication policy', () => {
  it('exempts prose only, never mixed changes or executable/packaged inputs', () => {
    expect(docsOnly(['README.md', 'README.zh-CN.md', 'docs/guide.md'])).toBe(true);
    for (const path of ['NOTICE.md','docs/release-notes/known-issues.md','.github/workflows/release.yml','package.json','packages/web/src/index.ts','docs/example.js','README.md\npackage.json']) {
      expect(docsOnly(['README.md', path]), path).toBe(false);
    }
    expect(docsOnly([])).toBe(false);
  });
  it('requires a monotonically increasing unique beta version', () => {
    checkVersion('0.1.10-beta.9','0.1.10-beta.10');
    checkVersion('0.1.9','0.1.10-beta.1');
    for (const pair of [['0.1.10-beta.9','0.1.10-beta.9'],['0.1.10-beta.9','0.1.10-beta.2'],['0.1.10','0.1.10-beta.1'],['0.1.10-beta.9','0.1.10']]) {
      expect(() => checkVersion(...pair)).toThrow();
    }
  });
  it('fails closed on bad references or missing base, and checks both rename paths', () => {
    expect(() => classify('beta','HEAD')).toThrow();
    expect(() => classify('a'.repeat(40),'b'.repeat(40), () => {throw new Error('missing base');})).toThrow('missing base');
    const git = (args: string[]) => args[0] === 'diff' ? 'scripts/run.js\0docs/run.md\0' : JSON.stringify({version: '0.1.10-beta.3'});
    expect(() => classify('a'.repeat(40),'b'.repeat(40),git)).toThrow('increase');
  });
});

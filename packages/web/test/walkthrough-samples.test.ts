import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { sampleFiles } from '../../../scripts/walkthrough-samples.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('walkthrough bulk-sample collection', () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-walkthrough-samples-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('collects only files, never fixture subdirectories', async () => {
    writeFileSync(join(root, 'A.path'), '{}');
    writeFileSync(join(root, 'B.auto'), '{}');
    // Fixture subfolders (samples/pathplanner/reference) are test data, not
    // library samples — and playwright setInputFiles rejects a list that
    // mixes files with a directory ("File paths must be all files or a
    // single directory").
    mkdirSync(join(root, 'reference'));
    writeFileSync(join(root, 'reference', 'settings.json'), '{}');
    const files = await sampleFiles(root);
    expect([...files].sort()).toEqual([join(root, 'A.path'), join(root, 'B.auto')]);
  });

  it('returns an empty list for a directory that holds no files', async () => {
    const empty = join(root, 'empty-dir');
    mkdirSync(empty);
    expect(await sampleFiles(empty)).toEqual([]);
  });

  it('returns absolute-resolved paths prefixed with the given directory', async () => {
    const files = await sampleFiles(root);
    for (const file of files) expect(file.startsWith(root)).toBe(true);
  });
});

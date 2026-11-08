import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * File entries directly under one sample directory, for the walkthrough's
 * bulk import. Directories are excluded: fixture subfolders such as
 * samples/pathplanner/reference are test data, not library samples, and
 * playwright's setInputFiles rejects a list that mixes files with a
 * directory ("File paths must be all files or a single directory").
 * Paths are platform-native (node:path join), so tests and callers agree
 * on every OS.
 */
export async function sampleFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name));
}

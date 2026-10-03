import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The migration module copies pre-rename `ghpb.*` localStorage entries to
 * their `pb.*` names as an import side effect — reset modules and re-import
 * to exercise a fresh run against each seeded store.
 */
async function runMigration(): Promise<void> {
  vi.resetModules();
  await import('../src/legacy-storage');
}

describe('legacy-storage migration (2026-10-03 rename)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('copies old ghpb.* entries to pb.* when the new key is absent', async () => {
    localStorage.setItem('ghpb.theme', 'dark');
    localStorage.setItem('ghpb.tip.play.v1', 'done');
    await runMigration();
    expect(localStorage.getItem('pb.theme')).toBe('dark');
    expect(localStorage.getItem('pb.tip.play.v1')).toBe('done');
  });

  it('never overwrites an existing pb.* value', async () => {
    localStorage.setItem('ghpb.lang', 'zh');
    localStorage.setItem('pb.lang', 'en');
    await runMigration();
    expect(localStorage.getItem('pb.lang')).toBe('en');
  });

  it('leaves unrelated keys and the old entries themselves untouched', async () => {
    localStorage.setItem('ghpb.theme', 'light');
    localStorage.setItem('unrelated', 'keep');
    await runMigration();
    expect(localStorage.getItem('ghpb.theme')).toBe('light');
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('is idempotent across repeated runs', async () => {
    localStorage.setItem('ghpb.field', '{"id":"x"}');
    await runMigration();
    localStorage.setItem('pb.field', '{"id":"y"}'); // a later real write
    await runMigration();
    expect(localStorage.getItem('pb.field')).toBe('{"id":"y"}');
  });
});

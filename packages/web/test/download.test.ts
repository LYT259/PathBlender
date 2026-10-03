/**
 * saveBytes argument contract (regression, found on Linux 2026-10-02):
 * Tauri v2 maps command arguments camelCase by default. The desktop shell
 * had been passing snake_case keys since the v2 migration, so every
 * `save_file` invoke rejected with "missing required key suggestedName"
 * and saves silently produced no dialog on any platform.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn((_c: string, ..._a: unknown[]) => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

describe('saveBytes desktop contract', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('calls save_file with camelCase argument keys', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: native.invoke };
    const { saveText } = await import('../src/download');
    await saveText('session-2026-10-02.pb', 'json', '{}');

    expect(native.invoke).toHaveBeenCalledTimes(1);
    const [command, args] = native.invoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('save_file');
    expect(Object.keys(args).sort()).toEqual(['data', 'filterExt', 'suggestedName']);
    expect(args.suggestedName).toBe('session-2026-10-02.pb');
    expect(args.filterExt).toBe('json');
    expect(args.data).toBeInstanceOf(Uint8Array);
  });
});

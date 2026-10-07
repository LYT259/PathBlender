/**
 * Behaviour of the welcome-example loader: one retry for transient chunk
 * failures, then a single guarded page reload (the only fix for a tab whose
 * chunk hashes went stale across a redeploy), and prefetches that never pin
 * a failure. Importers/reload are injected so the tests observe the actual
 * click-path behaviour without the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { createWelcomeExample } from '../src/welcome-example';

type Module = { createWelcomeExample: typeof createWelcomeExample };
const stub = { createWelcomeExample: () => ({ robots: [] }) } as unknown as Module;

async function freshLoader() {
  vi.resetModules();
  return import('../src/example-loader');
}

function failing(tries: number, err = new Error('chunk fetch failed')) {
  let calls = 0;
  return vi.fn(async (): Promise<Module> => {
    calls += 1;
    if (calls <= tries) throw err;
    return stub;
  });
}

beforeEach(() => sessionStorage.clear());

describe('loadWelcomeExample', () => {
  it('returns the module on the first attempt without touching reload', async () => {
    const { loadWelcomeExample } = await freshLoader();
    const importer = failing(0);
    const reload = vi.fn();
    await expect(loadWelcomeExample(importer as never, reload)).resolves.toBe(stub);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('pb.example.retry.v1')).toBeNull();
  });

  it('recovers from one transient failure via the retry', async () => {
    const { loadWelcomeExample } = await freshLoader();
    const importer = failing(1);
    const reload = vi.fn();
    await expect(loadWelcomeExample(importer as never, reload)).resolves.toBe(stub);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the document once (with the session flag set) when both attempts fail', async () => {
    const { loadWelcomeExample, EXAMPLE_RELOADING } = await freshLoader();
    const importer = failing(2);
    const reload = vi.fn();
    await expect(loadWelcomeExample(importer as never, reload)).rejects.toBe(EXAMPLE_RELOADING);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('pb.example.retry.v1')).toBe('1');
  });

  it('does not reload a second time within the same page lifetime, and throws for the toast', async () => {
    const { loadWelcomeExample } = await freshLoader();
    sessionStorage.setItem('pb.example.retry.v1', '1');
    const importer = failing(2);
    const reload = vi.fn();
    await expect(loadWelcomeExample(importer as never, reload)).rejects.toThrow('load failed after retry');
    expect(importer).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('prefetchWelcomeExample', () => {
  it('caches a successful prefetch so the click needs no second import', async () => {
    const { prefetchWelcomeExample } = await freshLoader();
    const importer = failing(0);
    await expect(prefetchWelcomeExample(importer as never)).resolves.toBe(stub);
    await expect(prefetchWelcomeExample(importer as never)).resolves.toBe(stub);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('never pins a failed prefetch — the next attempt imports again', async () => {
    const { prefetchWelcomeExample } = await freshLoader();
    const importer = failing(1);
    await expect(prefetchWelcomeExample(importer as never)).rejects.toThrow('chunk fetch failed');
    await expect(prefetchWelcomeExample(importer as never)).resolves.toBe(stub);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('consumeExampleRetryFlag', () => {
  it('reports and clears a pending auto-reopen exactly once', async () => {
    const { consumeExampleRetryFlag, EXAMPLE_RETRY_FLAG } = await freshLoader();
    expect(consumeExampleRetryFlag()).toBe(false);
    sessionStorage.setItem(EXAMPLE_RETRY_FLAG, '1');
    expect(consumeExampleRetryFlag()).toBe(true);
    expect(sessionStorage.getItem(EXAMPLE_RETRY_FLAG)).toBeNull();
    expect(consumeExampleRetryFlag()).toBe(false);
  });
});

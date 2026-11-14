import { afterEach, describe, expect, it, vi } from 'vitest';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.resetModules();
  vi.restoreAllMocks();
});

async function prepare(desktop: boolean, production = true) {
  const register = vi.fn().mockResolvedValue({});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  if (desktop) Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  vi.resetModules();
  const { registerServiceWorker } = await import('../src/pwa');
  cleanup.push(registerServiceWorker(production));
  return register;
}

describe('desktop service-worker boundary', () => {
  it('does not register a service worker in the desktop shell even on http', async () => {
    const register = await prepare(true);
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps production browser PWA registration after window load', async () => {
    const register = await prepare(false);
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(new URL('sw.js', document.baseURI).href);
  });

  it('does not register outside production', async () => {
    const register = await prepare(false, false);
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
  });

  it('can dispose a browser registration listener before load', async () => {
    const register = await prepare(false);
    cleanup.pop()!();
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
  });
});

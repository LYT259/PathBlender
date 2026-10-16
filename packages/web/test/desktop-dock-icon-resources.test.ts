/**
 * Packaging contract for the runtime Dock-icon override: the web side asks
 * for a (dark, style) pair (dock-icon.ts), the Rust whitelist maps it to a
 * bundled resource name (lib.rs dock_icon_resource), and tauri.conf.json
 * ships that file under exactly that name. This test pins the three layers
 * together — a rename on either side without the others is a compile-green
 * dead icon at runtime. It also holds the monochrome artwork identical
 * between the UI preview and the Dock tile (both are byte-copies of the
 * desktop source files).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ICON_STYLE_ARTWORK } from '../src/app-icon';

const repo = resolve(__dirname, '../../..');
const conf = JSON.parse(
  readFileSync(resolve(repo, 'packages/desktop/src-tauri/tauri.conf.json'), 'utf8'),
) as { bundle: { resources: Record<string, string> } };
const rustSource = readFileSync(resolve(repo, 'packages/desktop/src-tauri/src/lib.rs'), 'utf8');

const EXPECTED: Record<string, string> = {
  'icons/dock/icon-day-rounded.png': 'icons/icon-day.png',
  'icons/dock/icon-night-rounded.png': 'icons/icon-night.png',
  'icons/dock/icon-mono-day-rounded.png': 'icons/icon-mono-day.png',
  'icons/dock/icon-mono-night-rounded.png': 'icons/icon-mono-night.png',
};

describe('dock icon packaging contract', () => {
  it('ships all four dock resources under the whitelisted names', () => {
    for (const [source, target] of Object.entries(EXPECTED)) {
      expect(conf.bundle.resources[source], `${source} missing from bundle resources`).toBe(target);
      // The source file exists in the repo tree (a typo'd path bundles nothing).
      expect(
        () => readFileSync(resolve(repo, 'packages/desktop/src-tauri', source)),
        `${source} not on disk`,
      ).not.toThrow();
      // …and the Rust whitelist actually resolves that bundled name (the
      // whitelist holds bare names; the resource target carries the icons/
      // directory the shell joins itself).
      expect(rustSource, `${target} not in the Rust whitelist`).toContain(`"${target.split('/').pop()}"`);
    }
    expect(Object.keys(conf.bundle.resources)).toHaveLength(Object.keys(EXPECTED).length);
  });

  it('the Rust whitelist maps only the four fixed resource names', () => {
    // Every icon-[...].png literal the Rust source mentions is one of the
    // four bundled names — no caller-controlled path can slip in.
    const literals = [...rustSource.matchAll(/"(icon-[a-z-]+\.png)"/g)].map((m) => m[1]);
    expect(new Set(literals))
      .toEqual(new Set(Object.values(EXPECTED).map((t) => t.split('/').pop())));
  });

  it('the About panel opens with the current dock artwork, not the predefined about', () => {
    // The predefined about item builds its panel once from the bundle icon
    // and never re-reads the runtime override (user report 2026-10-16);
    // the shell must keep presenting the panel itself, icon included.
    expect(rustSource).toContain('orderFrontStandardAboutPanelWithOptions');
    expect(rustSource).toContain('NSAboutPanelOptionApplicationIcon');
    expect(rustSource).not.toMatch(/PredefinedMenuItem::about|about_with/);
  });

  it('Dock artwork and UI preview artwork are the same files (per family)', () => {
    const pairs: Array<[string, string]> = [
      ['icon-mono-day-rounded.png', ICON_STYLE_ARTWORK.monochrome.light],
      ['icon-mono-night-rounded.png', ICON_STYLE_ARTWORK.monochrome.dark],
    ];
    for (const [dockName, webImport] of pairs) {
      // The Vite asset import resolves to a URL whose basename is the asset
      // file — pin the Dock copy byte-for-byte against that same asset.
      const base = webImport.split('/').pop()!.split('?')[0];
      expect(base).toMatch(/^app-icon-mono-(day|night)\.png$/);
      const dockBytes = readFileSync(resolve(repo, 'packages/desktop/src-tauri/icons/dock', dockName));
      const webBytes = readFileSync(resolve(repo, 'packages/web/src/assets', base));
      expect(dockBytes.equals(webBytes), `${dockName} drifted from ${base}`).toBe(true);
    }
  });
});

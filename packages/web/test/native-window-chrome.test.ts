/**
 * Native window chrome source contract (2026-11-13, Approach B): both
 * desktop windows ship a visible native macOS title bar — `titleBarStyle:
 * Visible` with the title shown and no trafficLightPosition override — and
 * the web layer carries no Overlay-era leftovers (traffic-light padding in
 * the toolbars, prefs drag layer and its 44px column offsets). These tests
 * pin the source-level contract; the native menu's real appearance and
 * physical dragging are verified on the launched app, not from here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '..');
const TAURI = resolve(__dirname, '../../desktop/src-tauri');

const read = (p: string) => readFileSync(p, 'utf-8');
const appCss = read(resolve(WEB, 'src/app.css'));
const workspaceCss = read(resolve(WEB, 'src/workspace.css'));
const prefsCss = read(resolve(WEB, 'src/components/PreferencesPanel.css'));
const prefsTsx = read(resolve(WEB, 'src/prefs-window.tsx'));
const mainTsx = read(resolve(WEB, 'src/main.tsx'));
const rust = read(resolve(TAURI, 'src/lib.rs'));

describe('native title bar: main window (tauri.conf.json)', () => {
  const conf = JSON.parse(read(resolve(TAURI, 'tauri.conf.json')));
  const win = conf.app.windows.find((w: { label: string }) => w.label === 'main');

  it('uses a visible title bar with the title shown', () => {
    expect(win.titleBarStyle).toBe('Visible');
    expect(win.hiddenTitle).toBe(false);
  });

  it('carries no traffic-light position override', () => {
    expect(win).not.toHaveProperty('trafficLightPosition');
  });
});

describe('native title bar: preferences window (lib.rs)', () => {
  it('uses a visible title bar with the title shown', () => {
    expect(rust).toContain('tauri::TitleBarStyle::Visible');
    expect(rust).toContain('.hidden_title(false)');
  });

  it('carries no traffic-light position override and no overlay remnants', () => {
    expect(rust).not.toContain('traffic_light_position');
    expect(rust).not.toContain('TitleBarStyle::Overlay');
  });
});

describe('overlay-era layout is gone from the web layer', () => {
  it('workspace toolbar keeps no traffic-light left padding', () => {
    expect(workspaceCss).not.toContain('body.desktop.desktop-macos .workspace-toolbar { padding-left:');
  });

  it('toolbar and editor-bar keep no traffic-light left padding in app.css', () => {
    expect(appCss).not.toContain('body.desktop.desktop-macos .toolbar { padding-left:');
    expect(appCss).not.toContain('body.desktop.desktop-macos .editor-bar { padding-left:');
  });

  it('keeps desktop-macos for the unrelated native-vibrancy rule', () => {
    expect(appCss).toContain('body.desktop.desktop-macos { background: transparent; }');
  });

  it('preferences keep no drag layer or 44px traffic-light column offsets', () => {
    expect(prefsCss).not.toContain('.prefs-drag-layer');
    expect(prefsCss).not.toContain('calc(26px + 44px)');
    expect(prefsCss).not.toContain('.preferences-window .preferences-main { padding-top: 44px; }');
    expect(prefsCss).not.toContain('.preferences-window .preferences-sidebar { padding-top:');
  });

  it('prefs window no longer mounts a drag layer in source', () => {
    expect(prefsTsx).not.toContain('prefs-drag-layer');
    expect(prefsTsx).not.toContain('startDrag');
  });

  it('no Overlay/traffic-light wording survives in touched entrypoints', () => {
    const commentLines = (src: string) => src.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l));
    for (const [name, src] of [['prefs-window.tsx', prefsTsx], ['main.tsx', mainTsx], ['lib.rs', rust]] as const) {
      const stale = commentLines(src).filter((l) => /overlay title bar|traffic.?light/i.test(l));
      expect(stale, `${name} still describes the old overlay chrome`).toEqual([]);
    }
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const config = JSON.parse(readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/tauri.conf.json'), 'utf8'));
const rust = readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/src/lib.rs'), 'utf8');
const cargo = readFileSync(resolve(ROOT, 'packages/desktop/src-tauri/Cargo.toml'), 'utf8');

describe('overlay-preserving native window drag', () => {
  it('keeps the original Overlay main-window appearance and traffic-light placement', () => {
    const main = config.app.windows[0];
    expect(main.titleBarStyle).toBe('Overlay');
    expect(main.hiddenTitle).toBe(true);
    expect(main.trafficLightPosition).toEqual({ x: 18, y: 35 });
  });

  it('keeps the preferences window on the same Overlay chrome', () => {
    expect(rust).toContain('.title_bar_style(tauri::TitleBarStyle::Overlay)');
    expect(rust).toContain('.hidden_title(true)');
    expect(rust).toContain('LogicalPosition::new(18.0, 35.0)');
  });

  it('exposes a source-window command that sets movableByWindowBackground', () => {
    expect(rust).toContain('fn set_window_background_movable(');
    expect(rust).toContain('.setMovableByWindowBackground(movable)');
    expect(rust).toMatch(/generate_handler!\[[\s\S]*set_window_background_movable/);
  });

  it('uses the existing pinned AppKit dependency and does not restore the failed menu bridge', () => {
    expect(cargo).toContain('objc2-app-kit = { version = "=0.3.2"');
    expect(cargo).toMatch(/features = \[[^\]]*"NSWindow"/);
    expect(rust).not.toContain('show_titlebar_menu');
    expect(rust).not.toContain('NSEventType::RightMouseDown');
  });
});

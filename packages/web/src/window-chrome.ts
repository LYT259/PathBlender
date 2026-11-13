import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const IS_DESKTOP = typeof window !== 'undefined' && (
  '__TAURI_INTERNALS__' in window || location.protocol === 'tauri:' || location.protocol === 'asset:'
);
function isMacDesktop(): boolean {
  return IS_DESKTOP && typeof document !== 'undefined' && document.body.classList.contains('desktop-macos');
}

const INTERACTIVE_TARGET = [
  'button', 'a', 'input', 'select', 'textarea', 'label', 'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="combobox"]',
  '[role="listbox"]', '[role="menu"]', '[role="menubar"]', '[role="menuitem"]',
  '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]',
  '[role="radio"]', '[role="scrollbar"]', '[role="searchbox"]', '[role="slider"]',
  '[role="spinbutton"]', '[role="switch"]', '[role="tab"]', '[role="textbox"]',
  '[role="toolbar"]', '[role="tree"]',
].join(',');

interface ChromeMouseEvent {
  button: number;
  target: EventTarget | null;
}

interface ChromeHoverEvent {
  target: EventTarget | null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_TARGET) !== null;
}

function setBackgroundMovable(movable: boolean): void {
  if (!isMacDesktop()) return;
  invoke('set_window_background_movable', { movable }).catch(() => {});
}

export function updateWindowBackgroundDrag(event: ChromeHoverEvent): void {
  setBackgroundMovable(!isInteractiveTarget(event.target));
}

export function disableWindowBackgroundDrag(): void {
  setBackgroundMovable(false);
}

export function startWindowDrag(event: ChromeMouseEvent): void {
  if (event.button !== 0 || isInteractiveTarget(event.target) || !IS_DESKTOP) return;
  try {
    getCurrentWindow().startDragging().catch(() => {});
  } catch {
    // The browser build has no native window to drag.
  }
}

import { afterEach, describe, expect, it } from 'vitest';
import { installFocusModality } from '../src/focus-modality';

const KEYBOARD_NAV = 'kbd-nav';

function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

function pointer() {
  document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

/** The behavior under test is class toggling — jsdom applies no CSS. */
describe('installFocusModality', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    document.documentElement.classList.remove(KEYBOARD_NAV);
  });

  it('defaults to pointer mode: no ring class on a fresh document', () => {
    disposers.push(installFocusModality());
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);
  });

  it('counts Tab as keyboard anywhere, including inside a text field', () => {
    disposers.push(installFocusModality());
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      key(input, 'Tab');
      expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(true);
    } finally {
      input.remove();
    }
  });

  it('counts arrows and Enter as keyboard on controls', () => {
    disposers.push(installFocusModality());
    key(document.body, 'ArrowDown');
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(true);
    document.documentElement.classList.remove(KEYBOARD_NAV);

    const button = document.createElement('button');
    document.body.appendChild(button);
    try {
      key(button, 'Enter');
      expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(true);
      document.documentElement.classList.remove(KEYBOARD_NAV);

      // Space on a checkbox activates it — keyboard use.
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);
      key(checkbox, ' ');
      expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(true);
      checkbox.remove();
    } finally {
      button.remove();
    }
  });

  it('treats typing — letters, caret arrows, Enter — as pointer-mode stays', () => {
    disposers.push(installFocusModality());
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    try {
      for (const k of ['a', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']) key(input, k);
      expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);

      const area = document.createElement('textarea');
      document.body.appendChild(area);
      key(area, 'ArrowUp');
      expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);
      area.remove();
    } finally {
      input.remove();
    }
  });

  it('ignores IME composition keydowns', () => {
    disposers.push(installFocusModality());
    key(document.body, 'Tab', { isComposing: true });
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);
  });

  it('a pointer press drops the flag set by a navigation key', () => {
    disposers.push(installFocusModality());
    key(document.body, 'Tab');
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(true);
    pointer();
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);
  });

  it('disposer removes the listeners', () => {
    const dispose = installFocusModality();
    dispose();
    key(document.body, 'Tab');
    expect(document.documentElement.classList.contains(KEYBOARD_NAV)).toBe(false);
  });
});

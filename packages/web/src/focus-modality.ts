// Focus modality — is the user driving focus with the keyboard right now?
//
// Focus rings are a keyboard affordance: a mouse user should never see one
// (user directive, 2026-10-14 — the ring on a rename input opened by a click
// reads as a stray box). Browsers guess via :focus-visible, but they ring
// text inputs, radios and checkboxes even when a mouse click focused them,
// so the app tracks modality itself: <html> carries .kbd-nav while the user
// navigates by keyboard, and every ring rule is gated on it
// (`:where(html.kbd-nav) … :focus-visible`, zero specificity delta).
//
// A key counts as navigation only when it navigates or activates a control:
// Tab anywhere; arrows/Home/End/PageUp/PageDown/Enter/Space outside text
// entry. Typing — caret arrows and Enter inside an input included — keeps
// rings hidden (plan B, user-approved 2026-10-14). Any pointer press drops
// the flag immediately. Default is pointer mode, matching "the ring appears
// only once the user actually touches the keyboard".

const KEYBOARD_NAV_CLASS = 'kbd-nav';

const NAV_KEYS_ANYWHERE = new Set(['Tab']);
const NAV_KEYS_OUTSIDE_TEXT = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  'Enter',
  ' ',
]);
const TEXT_INPUT_TYPES = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
}

/** Installs the modality listeners on `doc` (defaults to the main document). Returns a disposer. */
export function installFocusModality(doc: Document = document): () => void {
  const root = doc.documentElement;
  const onPointerDown = () => root.classList.remove(KEYBOARD_NAV_CLASS);
  const onKeyDown = (event: KeyboardEvent) => {
    // IME composition is typing by definition, whatever the key.
    if (event.isComposing || event.keyCode === 229) return;
    if (NAV_KEYS_ANYWHERE.has(event.key)) {
      root.classList.add(KEYBOARD_NAV_CLASS);
      return;
    }
    if (NAV_KEYS_OUTSIDE_TEXT.has(event.key) && !isTextEntry(event.target)) {
      root.classList.add(KEYBOARD_NAV_CLASS);
    }
  };
  // Capture phase: rings must track the physical input, not survive a
  // consumer calling stopPropagation.
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
  };
}

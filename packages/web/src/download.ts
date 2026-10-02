/**
 * Save-a-file helper that works in both hosts:
 * - Desktop (Tauri): neither WKWebView (macOS) nor WebKitGTK (Linux) runs
 *   blob downloads, so bytes go to the Rust `save_file` command (native
 *   save dialog + fs write).
 * - Browser: the classic object-URL <a download> click.
 */

// Protocol-only detection misses Linux/Windows, where Tauri serves the
// frontend over http(s); `__TAURI_INTERNALS__` is injected into every
// Tauri webview regardless of scheme (same check as App.tsx / main.tsx).
const IS_DESKTOP =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'asset:');

// Statically imported: a dynamic import() of the API chunk can silently
// lose the race against page load on WebKitGTK, leaving saves dead
// (ADR-0003). The module itself is inert in plain browser builds — invoke
// is only ever called on the IS_DESKTOP branch.
import { invoke } from '@tauri-apps/api/core';

export async function saveBytes(
  suggestedName: string,
  filterExt: string,
  data: Blob | Uint8Array,
): Promise<boolean> {
  if (IS_DESKTOP) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    // Tauri v2 maps command arguments camelCase by default — snake_case
    // keys are silently "missing" and the invoke rejects with
    // `missing required key suggestedName` (this is why desktop saves
    // produced no dialog on any platform; found on Linux 2026-10-02).
    const saved = await invoke<string | null>('save_file', {
      suggestedName,
      filterExt: filterExt,
      data: bytes,
    });
    return saved != null;
  }
  const blob =
    data instanceof Uint8Array
      ? new Blob([data.buffer as ArrayBuffer])
      : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

export function saveText(suggestedName: string, filterExt: string, text: string): Promise<boolean> {
  return saveBytes(suggestedName, filterExt, new Blob([text], { type: 'application/json' }));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export { IS_DESKTOP };

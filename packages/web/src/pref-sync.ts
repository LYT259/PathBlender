/**
 * Cross-window preference sync (desktop). The ⌘, preferences window and
 * the main window each hold their own React state over the same
 * localStorage — WKWebView storage events don't propagate between
 * webviews, so a change made in one window never reaches the other.
 * Tauri events bridge them: providers broadcast on local change and
 * apply remote values WITHOUT re-broadcasting (the no-op echo stops the
 * loop). Web/browser contexts: both helpers degrade to no-ops.
 */

type PrefKey = 'lang' | 'theme' | 'updateChannel';

const isDesktop =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'tauri:' || window.location.protocol === 'asset:');

export function broadcastPref(key: PrefKey, value: string): void {
  if (!isDesktop) return;
  void import('@tauri-apps/api/event')
    .then(({ emit }) => emit('pref', { key, value }))
    .catch(() => undefined);
}

/** Subscribe; returns an unlisten (no-op outside the desktop shell). */
export function listenPrefs(
  handler: (key: PrefKey, value: string) => void,
): () => void {
  if (!isDesktop) return () => undefined;
  let un: (() => void) | undefined;
  let disposed = false;
  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<{ key: PrefKey; value: string }>('pref', (e) => handler(e.payload.key, e.payload.value)),
    )
    .then((u) => {
      if (disposed) u();
      else un = u;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    un?.();
  };
}

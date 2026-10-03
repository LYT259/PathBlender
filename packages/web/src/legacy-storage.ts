/**
 * One-time localStorage migration for the 2026-10-03 rename: preferences
 * stored under the old `ghpb.*` prefix move to `pb.*` so nothing a user
 * saved (theme, language, field, 2D/3D, autosaved session, tips) is lost.
 * Runs as an import side effect — main.tsx imports this module first, so
 * the copies land before any consumer module reads its key. Old keys are
 * left in place (ignored); the new-key-absent guard makes re-runs no-ops.
 */
const OLD_PREFIX = 'ghpb.';
const NEW_PREFIX = 'pb.';

try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(OLD_PREFIX)) continue;
    const next = NEW_PREFIX + key.slice(OLD_PREFIX.length);
    if (localStorage.getItem(next) === null) {
      localStorage.setItem(next, localStorage.getItem(key) ?? '');
    }
  }
} catch {
  /* private browsing — stickiness is best-effort */
}

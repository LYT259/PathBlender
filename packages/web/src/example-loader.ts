/**
 * Resilient loader for the lazily-bundled welcome example.
 *
 * The example routes weigh ~1.6 MB of text (~456 KB gzipped) in a chunk that
 * is only fetched when the user clicks "Try an example" — on a flaky link to
 * pathblender.pages.dev that single request can time out, and a tab left open
 * across a redeploy references a chunk hash the new deployment no longer
 * serves (404). Both used to surface as a bare "failed to open" toast. The
 * click path here instead: retry the import once (transient blips), then —
 * still failing — reload the document exactly once per page lifetime with a
 * session flag the app consumes on startup to re-open the example by itself,
 * so the user never has to click twice. Only after that do we give up.
 */
import type { createWelcomeExample } from './welcome-example';

type WelcomeExampleModule = typeof import('./welcome-example');
type Importer = () => Promise<WelcomeExampleModule>;

const defaultImport: Importer = () => import('./welcome-example');

/** Session flag telling the freshly reloaded page to retry the example. */
export const EXAMPLE_RETRY_FLAG = 'pb.example.retry.v1';

/**
 * Thrown when the loader has triggered its one reload fallback: the page is
 * about to be replaced, so the caller must stay quiet (no error toast).
 */
export const EXAMPLE_RELOADING = Symbol('example-reloading');

let current: Promise<WelcomeExampleModule> | null = null;

/**
 * Warm the example chunk in the background (welcome-page idle time). A failed
 * prefetch is logged and forgotten — never pinned, so a later click retries
 * from scratch instead of reusing the rejection.
 */
export function prefetchWelcomeExample(importModule: Importer = defaultImport): Promise<WelcomeExampleModule> {
  if (!current) {
    const attempt = importModule();
    current = attempt;
    attempt.catch((err) => {
      if (current === attempt) current = null;
    });
  }
  return current;
}

/**
 * Click path: attempt, retry once, then fall back to a single guarded reload.
 * Prefetched successes are reused, so a warmed tab opens the example with no
 * network round-trip at all.
 */
export async function loadWelcomeExample(
  importModule: Importer = defaultImport,
  reloadPage: () => void = () => window.location.reload(),
): Promise<WelcomeExampleModule> {
  try {
    return await prefetchWelcomeExample(importModule);
  } catch (first) {
    console.error('[welcome-example] load failed, retrying once', first);
  }
  try {
    return await prefetchWelcomeExample(importModule);
  } catch (second) {
    console.error('[welcome-example] retry failed', second);
  }
  // A stale document keeps requesting its old chunk hash forever; one fresh
  // document is the only remedy. Guarded once per page lifetime.
  if (!sessionStorage.getItem(EXAMPLE_RETRY_FLAG)) {
    sessionStorage.setItem(EXAMPLE_RETRY_FLAG, '1');
    reloadPage();
    throw EXAMPLE_RELOADING;
  }
  throw new Error('welcome example: load failed after retry and reload');
}

/**
 * Startup side of the reload fallback: consume (clear) the retry flag and
 * report whether the example should re-open by itself on this launch.
 */
export function consumeExampleRetryFlag(): boolean {
  if (!sessionStorage.getItem(EXAMPLE_RETRY_FLAG)) return false;
  sessionStorage.removeItem(EXAMPLE_RETRY_FLAG);
  return true;
}

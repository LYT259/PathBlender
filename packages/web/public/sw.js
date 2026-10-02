/*
 * GHPathBlender service worker — static assets only (study §7.1 PWA).
 * App shell: cache-first for hashed /assets, network-first for the document
 * so updates land on reload. No user path data is ever cached or sent.
 */
// CACHE is rewritten by scripts/set-sw-version.mjs on every build
// so each release ships a fresh cache namespace automatically.
const CACHE = 'pb-0.1.4-beta.2-202610020151';
const CORE = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Hashed build assets: cache-first (immutable).
  if (url.pathname.startsWith(location.pathname.replace(/\/$/, '') + 'assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Documents & icons: network-first with cache fallback (offline reliability).
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (e.request.mode === 'navigate' || CORE.includes('./' + url.pathname.split('/').pop()))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('./'))),
  );
});

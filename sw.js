/**
 * Service worker: keeps the app openable offline without ever serving stale
 * code online.
 *
 * The first version was cache-first, which was a mistake: when files moved into
 * folders, phones kept serving the cached shell and a deploy simply never
 * arrived. Network-first inverts that — the cache is a fallback for offline,
 * not the source of truth. Registry data is never cached; declarations must be
 * current.
 */

const CACHE = 'pp-shell-v2';

const SHELL = [
  './',
  './index.html',
  './src/styles.css',
  './src/app.js',
  './src/lib/index.js',
  './src/lib/pib.js',
  './src/lib/registry.js',
  './src/lib/declaration.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll fails as a whole if any file is missing — cache them one by one.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything outside the shell (the registry API in particular) bypasses the cache.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      } catch {
        // Offline: fall back to whatever was cached, then to the shell, so a
        // home-screen launch still opens instead of showing a browser error.
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Офлайн', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});

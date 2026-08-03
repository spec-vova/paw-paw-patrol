/**
 * Service worker: caches the app shell so the home-screen icon opens instantly
 * and offline. Registry requests are never cached — declaration data is always
 * fetched fresh.
 */

const CACHE = 'pp-shell-v1';

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
      const cached = await caches.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => null);

      // Serve from cache first, refresh it from the network in the background.
      return cached || (await network) || new Response('Офлайн', { status: 503, statusText: 'Offline' });
    })()
  );
});

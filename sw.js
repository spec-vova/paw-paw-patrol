/**
 * Service worker: кешує оболонку застосунку, щоб іконка з домашнього екрана
 * відкривалась миттєво й без мережі. Запити до реєстру не кешуються —
 * дані декларацій завжди беруться свіжими.
 */

const CACHE = 'pp-shell-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './src/lib.js',
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
      // addAll падає цілком, якщо хоч один файл недоступний, — кладемо поштучно.
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
  // Усе, що не належить оболонці (зокрема API реєстру), йде повз кеш.
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

      // Спершу віддаємо кеш (швидко), у фоні оновлюємо його з мережі.
      return cached || (await network) || new Response('Офлайн', { status: 503, statusText: 'Offline' });
    })()
  );
});

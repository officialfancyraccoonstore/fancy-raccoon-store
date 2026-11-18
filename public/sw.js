/* Fancy Raccoon Studio — installable dashboard worker.
   Only static shell files are cached. Order data is always fetched live. */
const CACHE = 'fr-studio-v1';
const SHELL = [
  '/admin',
  '/css/styles.css?v=6',
  '/css/admin.css?v=6',
  '/css/theme.css?v=6',
  '/js/admin.js?v=6',
  '/js/palette.js?v=6',
  '/js/theme.js?v=6',
  '/img/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
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
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the dashboard API: orders and customer details must be fresh and private.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/admin')))
  );
});

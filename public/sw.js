// Sathvika MV service worker.
// Caches the static app shell only. All /api/* requests always go to the
// network -- prices and stock must never be served stale. See HANDOFF.md
// "Offline behavior" for what "works reliably on slower networks" means here:
// the shell loads instantly from cache, then data streams in.
const CACHE = 'sathvika-mv-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/i18n.js',
  '/js/icons.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API/data calls

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});

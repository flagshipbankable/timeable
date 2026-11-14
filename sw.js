// timeable service worker: keeps the app's files for offline use and
// announces new versions. Bump VERSION on every release. Changing this line
// changes this file, which is how every browser notices an update.
const VERSION = '0.1.0';
const CACHE = `timeable-${VERSION}`;

// Every file the app needs to open offline. Paths are relative because the
// app lives under /timeable/ on GitHub Pages, not at the domain root.
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/icons.js',
  './js/sw-client.js',
  './js/ui.js',
  './js/views/desk.js',
  './js/views/day.js',
  './js/views/week.js',
  './js/views/tasks.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never
  // stores an older copy of a file that GitHub Pages sent earlier.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
  // No skipWaiting() here: the new version waits until Josh taps
  // "Update available", so it never swaps files mid-entry.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('timeable-') && key !== CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads always get the cached app page, so the app opens offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

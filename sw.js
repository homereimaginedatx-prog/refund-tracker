/* Service worker — gives the installed app offline support and a clean update path.

   Update strategy (avoids the classic "PWA stuck on an old version" trap):
   - Navigations / HTML  -> NETWORK-FIRST: a launch with connectivity always gets the
     latest app, and falls back to cache only when offline.
   - Static assets (css/js/icons) -> CACHE-FIRST, but the cache name is keyed to the app
     version, so a new version uses a fresh cache and old caches are deleted on activate.

   All paths are RELATIVE ("./") so this works under a GitHub Pages subpath. */

importScripts('./version.js'); // sets self.APP_VERSION
const CACHE = 'refund-cache-' + (self.APP_VERSION || 'dev');

// Best-effort precache of the app shell. Missing files never block install.
const PRECACHE = [
  './',
  './index.html',
  './assets/styles.css',
  './version.js',
  './core/app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    // Do NOT skipWaiting automatically — the page asks us to, after telling the user.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// The page posts {type:'SKIP_WAITING'} when the user taps "Refresh" on the update toast.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST for everything same-origin: always the latest code when online, and the
  // cached copy keeps the app working offline. Eliminates the "stuck on an old version" trap.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.status === 200 && (fresh.type === 'basic' || fresh.type === 'default')) {
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (isNavigation(request)) {
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('', { status: 504 });
    }
  })());
});

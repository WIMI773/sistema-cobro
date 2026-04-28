const CACHE_NAME = 'cobrodiario-cache-v1';
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'login.html',
  'detalle.html',
  'styles.css',
  'app.js',
  'detalle.js',
  'firebase.js',
  'manifest.json',
  'logocobro.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then(fetchResponse => {
        if (event.request.method === 'GET' && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, fetchResponse.clone()));
        }
        return fetchResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
          return caches.match(event.request)
            .then(r => r || caches.match('/login.html') || caches.match('/login') || caches.match('login.html') || caches.match('index.html'));
        }
        return new Response('offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

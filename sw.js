const CACHE_NAME = 'cobrodiario-cache-v6';
const URLS_TO_CACHE = [
  '/',
  'index.html',
  'login.html',
  'detalle.html',
  'reportes.html',
  'gastos.html',
  'styles.css',
  'app.js',
  'detalle.js',
  'reportes.js',
  'gastos.js',
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
  // Para navegación entre páginas: red primero, caché como respaldo
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Guardar en caché la respuesta fresca
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          return response;
        })
        .catch(() => {
          // Sin red: buscar en caché por URL exacta
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Último recurso: index.html
            return caches.match('index.html');
          });
        })
    );
    return;
  }

  // Para recursos estáticos (CSS, JS, imágenes): caché primero
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then(fetchResponse => {
        if (
          fetchResponse &&
          fetchResponse.status === 200 &&
          event.request.method === 'GET' &&
          event.request.url.startsWith(self.location.origin)
        ) {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return fetchResponse;
      }).catch(() => {
        return new Response('offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
const CACHE_NAME = 'dioms-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/DIOMS-1.png',
  '/DEPOTEL_rounded22.jpg'
];

// Install Event - Pre-cache core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA SW] Pre-caching partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[PWA SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Handle offline requests & Web Share Target
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Web Share Target POST request (e.g. sharing receipt from BRImo or Gallery)
  if (event.request.method === 'POST' && url.pathname.includes('/?shared=true')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const photo = formData.get('photos');
          const title = formData.get('title') || '';
          const text = formData.get('text') || '';

          if (photo && photo instanceof File) {
            // Store shared file in IndexedDB or temporary Cache
            const cache = await caches.open('dioms-shared-files');
            const response = new Response(photo, {
              headers: {
                'content-type': photo.type,
                'x-file-name': encodeURIComponent(photo.name),
                'x-file-title': encodeURIComponent(title || text)
              }
            });
            await cache.put('/shared-incoming-receipt', response);

            // Notify all open clients about the received share
            const allClients = await self.clients.matchAll({ type: 'window' });
            for (const client of allClients) {
              client.postMessage({
                type: 'DIOMS_SHARED_FILE_RECEIVED',
                fileName: photo.name,
                fileType: photo.type
              });
            }
          }
        } catch (err) {
          console.error('[PWA SW] Error handling shared file:', err);
        }
        // Redirect to main app page after share
        return Response.redirect('/?shared_success=true', 303);
      })()
    );
    return;
  }

  // Skip non-GET requests for standard caching
  if (event.request.method !== 'GET') return;

  // Navigation requests (HTML pages) -> Network first, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html') || await caches.match('/');
          if (cachedIndex) return cachedIndex;
          return new Response('<h1>DIOMS Mode Offline</h1><p>Aplikasi sedang offline. Silakan sambungkan kembali koneksi internet Anda.</p>', {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
    return;
  }

  // Static assets (images, js, css) -> Cache first or Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update for cache freshness
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return networkResponse;
      }).catch((err) => {
        console.warn('[PWA SW] Fetch failed for:', event.request.url, err);
      });
    })
  );
});

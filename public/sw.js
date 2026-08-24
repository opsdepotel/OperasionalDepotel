const CACHE_NAME = 'dioms-depotel-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/DIOMS-icon192.png',
  '/DIOMS-icon512.png',
  '/DIOMS-1.png',
  '/DEPOTEL_rounded22.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Pre-caching assets warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Handle PWA Web Share Target POST request
  if (event.request.method === 'POST' && event.request.url.includes('/finance-share-target')) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          let file = null;

          // Search all formData fields for any file object
          for (const [key, value] of formData.entries()) {
            if (value && typeof value === 'object' && (value instanceof File || value.size > 0)) {
              file = value;
              break;
            }
          }

          if (file) {
            const db = await new Promise((resolve, reject) => {
              const req = indexedDB.open('DIOMS_SHARE_DB', 1);
              req.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('shared_receipts')) {
                  database.createObjectStore('shared_receipts', { keyPath: 'id' });
                }
              };
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });

            const record = {
              id: 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
              blob: file,
              fileName: file.name || `shared_receipt_${Date.now()}.jpg`,
              mimeType: file.type || 'image/jpeg',
              timestamp: Date.now(),
            };

            await new Promise((resolve, reject) => {
              const tx = db.transaction(['shared_receipts'], 'readwrite');
              const store = tx.objectStore('shared_receipts');
              const putReq = store.put(record);
              putReq.onsuccess = () => resolve();
              putReq.onerror = () => reject(putReq.error);
            });
          }
        } catch (err) {
          console.error('Service Worker Share Target handling error:', err);
        }
        return Response.redirect('/?shared_receipt=1', 303);
      })()
    );
    return;
  }

  // Ignore non-GET requests or API calls
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('google.com') || event.request.url.includes('googleapis.com')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

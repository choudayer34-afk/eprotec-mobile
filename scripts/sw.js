const CACHE_NAME = 'moneprotec-cache-v1';

const APP_SHELL = [
  './',
  './index.html',
  './bilan.html',
  './data/protection-civile-logo.png',
  './data/oasis-logo.png',
  './data/staying-alive-logo.png',
  './data/autodefense-poignet-1main-rotation.png',
  './data/autodefense-poignet-1main-traction.png',
  './data/autodefense-poignet-2mains.png',
  './data/autodefense-poignet-2mains-verticale.png',
  './data/autodefense-col-1main.png',
  './data/autodefense-col-2mains.png',
  './data/autodefense-etranglement-devant.png',
  './data/autodefense-etranglement-derriere.png',
  './data/autodefense-parades-coups.png',
  './data/autodefense-sol-immobilisation.png',
  './data/autodefense-sol-antiviol.png',
  './data/autodefense-prevention-posture.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});

const CACHE_NAME = 'moneprotec-cache-v2';

const APP_SHELL = [
  './',
  './index.html',

  // Ressources locales utilisées par eProtec
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
  './data/autodefense-prevention-posture.png',

  // JSON locaux nécessaires au fonctionnement
  './data/events.json',
  './data/suggestions.json',
  './data/status.json',
  './data/registrations-history.json',
  './data/changelog.json',

  // Ressource locale utilisée par l'import de fiches
  './data/prompt-universel-generation-fiches.md'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Un fichier absent ne doit jamais empêcher
      // le reste du cache de s'installer.
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn('[SW] Cache ignoré :', url, err);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /*
   * On ne gère ici que les ressources du même domaine.
   * Firebase / autres services externes restent des fonctions réseau.
   */
  if (url.origin !== self.location.origin) {
    return;
  }

  /*
   * NAVIGATION :
   * - en ligne : serveur prioritaire
   * - hors ligne : index.html en cache
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', response.clone()).catch(() => {});

          return response;
        } catch (err) {
          const cached = await caches.match('./index.html');

          return cached || Response.error();
        }
      })()
    );

    return;
  }

  /*
   * AUTRES RESSOURCES :
   * - en ligne : réseau puis mise en cache
   * - hors ligne : cache
   */
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);

        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }

        return response;
      } catch (err) {
        const cached = await caches.match(request, {
          ignoreSearch: true
        });

        return cached || Response.error();
      }
    })()
  );
});

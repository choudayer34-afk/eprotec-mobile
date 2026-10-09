const CACHE_NAME = 'moneprotec-cache-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './chart.umd.min.js',

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
   * Les routes du serveur (/api/...) ne sont jamais mises en cache :
   * données personnelles ou d'administration, toujours lues à jour.
   */
  if (url.pathname.startsWith('/api/')) {
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

/*
 * NOTIFICATIONS envoyées par le serveur (rappels d'inscriptions, nouveautés, suggestions).
 * Le message arrive chiffré, déjà déchiffré par le navigateur : { titre, corps, url, tag }.
 */
self.addEventListener('push', (event) => {
  let donnees = {};
  try {
    donnees = event.data.json();
  } catch (err) {
    donnees = { corps: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(donnees.titre || 'eProtec', {
      body: donnees.corps || '',
      icon: './data/protection-civile-logo.png',
      badge: './data/protection-civile-logo.png',
      tag: donnees.tag || 'eprotec',
      data: { url: donnees.url || './' }
    })
  );
});

/*
 * Toucher la notification ouvre (ou ramène au premier plan) l'application, sur l'écran visé.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cible = new URL(
    (event.notification.data && event.notification.data.url) || './',
    self.registration.scope
  ).href;

  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const fenetre of fenetres) {
        if ('focus' in fenetre) {
          try {
            if ('navigate' in fenetre) await fenetre.navigate(cible);
          } catch (err) { /* navigation impossible : on se contente de ramener la fenêtre */ }
          return fenetre.focus();
        }
      }
      return self.clients.openWindow(cible);
    })()
  );
});

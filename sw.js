// Service worker : l'application fonctionne hors ligne une fois chargée.
// Incrémente VERSION à chaque publication pour que les téléphones récupèrent les nouveaux fichiers.
const VERSION = 'respire-v52';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/views.js',
  './js/session.js',
  './js/stats.js',
  './js/breath.js',
  './js/content.js',
  './js/store.js',
  './js/audio.js',
  './js/track.js',
  './js/guide.js',
  './js/circle.js',
  './js/icons.js',
  './js/journey.js',
  './js/pip.js',
  './js/aura.js',
  './js/sync.js',
  './fonts/nunito-latin.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord pour la page (toujours à jour), cache puis mise à jour en arrière-plan pour le reste.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Fichiers de l'application : on répond tout de suite avec le cache, et on le met à jour en arrière-plan.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      });
      return hit || fresh;
    }),
  );
});

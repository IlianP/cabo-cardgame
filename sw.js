/**
 * Service Worker – macht Cabo offline spielbar.
 *
 * Strategie: beim Installieren alles in den Cache legen, danach
 * "stale-while-revalidate": sofort aus dem Cache ausliefern und im
 * Hintergrund nach einer neueren Fassung schauen.
 */

const VERSION = 'cabo-v7';
const ASSETS = [
  './',
  'index.html',
  'multi.html',
  'css/style.css',
  'css/multi.css',
  'js/app.js',
  'js/ui.js',
  'js/engine.js',
  'js/deck.js',
  'js/rules.js',
  'js/privacy.js',
  'js/art.js',
  'js/debug.js',
  'js/view.js',
  'js/host.js',
  'js/client.js',
  'js/transport.js',
  'js/multi.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  // Kartenbilder: müssen mit in den Cache, sonst bleiben Karten offline leer.
  ...Array.from({ length: 14 }, (_, v) => `art/${String(v).padStart(2, '0')}.webp`),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Seitenaufrufe zuerst aus dem Netz.
  //
  // Sonst zeigt der erste Aufruf nach einer neuen Fassung noch die alte
  // Seite aus dem Cache – neue Knöpfe fehlen dann, und man sucht sie an
  // einem Gerät, das sie noch gar nicht kennt. Fällt das Netz aus, greift
  // wie bisher der Cache; offline bleibt die App also spielbar.
  //
  // Ein HTTP-Fehler ist dabei kein Netzausfall: Bei 503 oder 404 *gelingt*
  // `fetch()`, nur eben mit einer Fehlerseite. Die darf weder ausgeliefert
  // werden, solange eine funktionierende Seite im Cache liegt, noch diese
  // überschreiben – sonst zeigt jeder spätere Offline-Besuch den Fehler statt
  // des Spiels. Gecacht wird deshalb nur, was `ok` ist. Liegt gar nichts im
  // Cache, ist die Fehlerseite immer noch besser als nichts.
  //
  // Ausnahme Weiterleitung: Seitenaufrufe holen sie als `opaqueredirect`
  // (Status 0, also nicht `ok`), und der Browser folgt ihr selbst. Die
  // gehört durchgereicht, nicht durch eine Seite aus dem Cache ersetzt.
  if (request.mode === 'navigate') {
    const fromCache = () => caches.match(request).then((c) => c || caches.match('index.html'));
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
            return response;
          }
          if (response.type === 'opaqueredirect') return response;
          return fromCache().then((cached) => cached || response);
        })
        .catch(fromCache),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('index.html'));
      return cached || network;
    }),
  );
});

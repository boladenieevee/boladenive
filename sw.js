/* =========================================================================
   Snowball · service worker (PWA)
   -------------------------------------------------------------------------
   • Guarda la app (HTML, CSS, JS e iconos) para abrirla sin conexión.
   • Red primero: con internet siempre sirve la versión más reciente.
   • No toca peticiones externas: Supabase, GitHub raw, reproductores embed
     e imágenes se piden directamente a su servidor.
   ========================================================================= */

var CACHE = 'snowball-v1';

var CORE = [
    './',
    './index.html',
    './css/styles.css',
    './js/config.js',
    './js/data/catalog.js',
    './js/app.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(CORE); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys
                    .filter(function (key) { return key !== CACHE; })
                    .map(function (key) { return caches.delete(key); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url;
    try { url = new URL(request.url); } catch (err) { return; }

    // Solo se cachea lo propio; lo externo (Supabase, GitHub, embeds) va directo
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(function (response) {
                if (response && response.ok) {
                    var copy = response.clone();
                    caches.open(CACHE).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            })
            .catch(function () {
                return caches.match(request).then(function (cached) {
                    if (cached) return cached;
                    if (request.mode === 'navigate') return caches.match('./index.html');
                    return Response.error();
                });
            })
    );
});

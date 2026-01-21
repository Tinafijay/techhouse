const CACHE_NAME = 'tech-house-v9';
const ASSETS = [
    './poisoning%20detector.html',
    './poisoning%20detector%20styles.css',
    './poisoning%20detector%20script.js',
    './manifest.json',
    './Tech%20House%20logo.png',
    './vista_startup.mp3'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => response || fetch(event.request))
    );
});
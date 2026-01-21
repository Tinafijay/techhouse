const CACHE_NAME = 'tech-house-v2';
const ASSETS = [
    '/',
    './poisoning%20detector.html',
    './poisoning%20detector%20styles.css',
    './poisoning%20detector%20script.js',
    './manifest.json',
    './Tech%20House%20logo.jpg',
    './vista_startup.mp3'
];

// Install: Cache all branding and the Vista audio file
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Forces the new worker to become active immediately
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activation: Clean up the old v1 cache to free up device space
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// Fetch: Serve from cache so the app works offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
const CACHE_NAME = 'tech-house-v3'; // Incremented version to force update
const ASSETS = [
    './', // Cache the root
    './poisoning%20detector.html',
    './poisoning%20detector%20styles.css',
    './poisoning%20detector%20script.js',
    './manifest.json',
    './Tech%20House%20logo.jpg',
    './vista_startup.mp3'
];

// Install: Cache all branding and audio files
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Force the new service worker to take over immediately
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activation: Clean up old versions to save space
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// Fetch: Serve from cache so it works offline/fast
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
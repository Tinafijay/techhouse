const CACHE_NAME = 'tech-house-v13'; // Bumped the version to trigger an update
const ASSETS = [
    './poisoning%20detector.html',
    './poisoning%20detector%20styles.css',
    './poisoning%20detector%20script.js',
    './manifest.json',
    './Tech%20House%20logo.png',
    './vista_startup.mp3'
];

self.addEventListener('install', (e) => {
    self.skipWaiting(); // Forces the waiting service worker to become the active service worker
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

// NEW: This deletes old versions of your cache (like v12) so they don't get stuck
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    // If the cache name doesn't match the current one, delete it
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Takes control of the page immediately
    );
});

// CHANGED: Network-First Strategy
self.addEventListener('fetch', (e) => {
    e.respondWith(
        // 1. Try to fetch from the network first
        fetch(e.request)
            .catch(() => {
                // 2. If the network fails (offline), fallback to the cache
                return caches.match(e.request);
            })
    );
});
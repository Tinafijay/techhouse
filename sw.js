const CACHE_NAME = 'tech-house-v12';
const ASSETS = [
    './poisoning%20detector.html',
    './poisoning%20detector%20styles.css',
    './poisoning%20detector%20script.js',
    './manifest.json',
    './Tech%20House%20logo.png',
    './vista_startup.mp3'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
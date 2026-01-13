const CACHE_NAME = 'th-v1';
const ASSETS = [
  'poisoning detector.html',
  'poisoning detector styles.css',
  'poisoning detector script.js',
  'Tech House logo.jpg',
  'vista_startup.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
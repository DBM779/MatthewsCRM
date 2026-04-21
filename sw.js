const CACHE_NAME = 'matthews-crm-v2';
const ASSETS = ['./', './index.html', './manifest.json'];
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // Firebase API calls: network only, never cache
  if (url.includes('firebaseio.com') || url.includes('nominatim')) return;

  // CDN assets: cache first (they're versioned)
  if (url.includes('unpkg.com') || url.includes('tile.openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return res;
    })));
    return;
  }

  // App files: stale-while-revalidate
  e.respondWith(caches.match(e.request).then(cached => {
    const fetched = fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => cached);
    return cached || fetched;
  }));
});

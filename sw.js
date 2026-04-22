// Matthews CRM Service Worker v8
// Network-first for everything. Cache is ONLY for offline fallback.
const CACHE_NAME = 'matthews-crm-v8';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('message', e => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never cache API calls or auth
  const url = e.request.url;
  if (url.includes('googleapis.com') || url.includes('firebaseio.com') || url.includes('accounts.google.com') || url.includes('cloudfunctions.net')) return;
  // Network first for everything
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

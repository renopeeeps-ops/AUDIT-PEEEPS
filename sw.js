/* Audit EP — service worker
   - Cache l'app shell (HTML, Leaflet, polices, icônes) → démarrage SANS réseau.
   - Cache les tuiles de carte (cache séparé, persistant) → carte visible hors réseau.
*/

const SHELL_CACHE = 'audit-ep-shell-v71';
const TILE_CACHE  = 'audit-ep-tiles-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://unpkg.com/proj4@2.11.0/dist/proj4.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map((u) => c.add(u)));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // on garde le shell courant ET le cache de tuiles (jamais purgé auto)
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isTile(href) {
  return /tile\.openstreetmap\.org/.test(href) || /\.tile\./.test(href)
    || /server\.arcgisonline\.com/.test(href)          // satellite Esri
    || /data\.geopf\.fr\/wmts/.test(href);             // orthophotos IGN
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // ── Tuiles carte : cache-first dans un cache dédié (réponses opaques OK) ──
  if (isTile(req.url)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      } catch (err) {
        // hors réseau et tuile non préchargée → tuile vide (comportement attendu)
        return new Response('', { status: 504, statusText: 'tile offline' });
      }
    })());
    return;
  }

  // ── App shell / libs / polices : cache-first + revalidation ──
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetchAndCache(req).catch(() => {});
      return cached;
    }
    try {
      return await fetchAndCache(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const idx = await caches.match('./index.html');
        if (idx) return idx;
      }
      throw err;
    }
  })());
});

async function fetchAndCache(req) {
  const resp = await fetch(req);
  if (resp && (resp.ok || resp.type === 'opaque')) {
    const c = await caches.open(SHELL_CACHE);
    c.put(req, resp.clone()).catch(() => {});
  }
  return resp;
}

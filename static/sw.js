/**
 * ============================================================================
 * DIVIDEND HUNTER - Service Worker
 * ============================================================================
 * Offline-first caching strategy:
 * - Static assets: Cache-first
 * - API requests: Network-first with cache fallback
 * - Fonts: Cache-first with long TTL
 */

const CACHE_VERSION = 'v1.0.5';
const STATIC_CACHE = `dividend-static-${CACHE_VERSION}`;
const API_CACHE = `dividend-api-${CACHE_VERSION}`;

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/styles.css',
    '/js/config.js',
    '/js/db.js',
    '/js/api.js',
    '/js/cards.js',
    '/js/app.js',
    '/icons/favicon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k.startsWith('dividend-') && k !== STATIC_CACHE && k !== API_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch: route requests to appropriate strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (!url.protocol.startsWith('http')) return;

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(request, API_CACHE));
    } else if (url.hostname.includes('fonts.g')) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
    } else {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
    }
});

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        if (request.mode === 'navigate') {
            return caches.match('/index.html');
        }
        throw e;
    }
}

async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

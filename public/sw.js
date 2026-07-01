importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js');

if (!workbox) {
    console.error('Workbox failed to load');
}

workbox.setConfig({
    debug: false
});

const CACHE_NAMES = {
    static: 'nook-static-v1',
    navigation: 'nook-navigation-v1',
    api: 'nook-api-v1',
    savedArticles: 'nook-saved-articles'
};

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAMES.static).then((cache) => {
            return cache.addAll([
                '/public/offline.html',
                '/public/manifest.json',
                '/public/icons/icon-192.png',
                '/public/icons/icon-512.png'
            ]);
        }).catch((err) => {
            console.error('SW precache failed:', err);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key.startsWith('nook-') && !Object.values(CACHE_NAMES).includes(key))
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

workbox.routing.registerRoute(
    ({ request }) => request.mode === 'navigate',
    new workbox.strategies.NetworkFirst({
        cacheName: CACHE_NAMES.navigation,
        plugins: [
            new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [200] }),
            {
                handlerDidError: async () => {
                    const fallback = await caches.match('/public/offline.html');
                    return fallback || new Response('Offline', { status: 503 });
                }
            }
        ]
    })
);

workbox.routing.registerRoute(
    ({ request }) => request.destination === 'style' || request.destination === 'script' || request.destination === 'font' || request.destination === 'image',
    new workbox.strategies.CacheFirst({
        cacheName: CACHE_NAMES.static,
        plugins: [
            new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] }),
            new workbox.expiration.ExpirationPlugin({
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60
            })
        ]
    })
);

const SENSITIVE_API_PATHS = ['/api/notifications', '/api/wallet', '/api/dashboard', '/api/admin'];

workbox.routing.registerRoute(
    ({ url }) => SENSITIVE_API_PATHS.some((p) => url.pathname.startsWith(p)),
    new workbox.strategies.NetworkOnly()
);

workbox.routing.registerRoute(
    ({ url }) => url.pathname.startsWith('/api/') && !SENSITIVE_API_PATHS.some((p) => url.pathname.startsWith(p)),
    new workbox.strategies.NetworkFirst({
        cacheName: CACHE_NAMES.api,
        plugins: [
            new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [200] }),
            new workbox.expiration.ExpirationPlugin({
                maxEntries: 50,
                maxAgeSeconds: 5 * 60
            })
        ]
    })
);

self.addEventListener('message', (event) => {
    if (!event.data) return;

    switch (event.data.action) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
        case 'SAVE_ARTICLE':
            handleSaveArticle(event);
            break;
        case 'GET_SAVED_ARTICLES':
            handleGetSavedArticles(event);
            break;
        case 'DELETE_SAVED_ARTICLE':
            handleDeleteSavedArticle(event);
            break;
    }
});

async function handleSaveArticle(event) {
    const url = event.data.url;
    try {
        const response = await fetch(url);
        const clone = response.clone();
        const cache = await caches.open(CACHE_NAMES.savedArticles);
        await cache.put(url, clone);
        event.source.postMessage({ action: 'ARTICLE_SAVED', url });
    } catch (err) {
        event.source.postMessage({ action: 'ARTICLE_SAVE_FAILED', url, error: err.message });
    }
}

async function handleGetSavedArticles(event) {
    const cache = await caches.open(CACHE_NAMES.savedArticles);
    const keys = await cache.keys();
    const urls = keys.map((req) => req.url);
    event.source.postMessage({ action: 'SAVED_ARTICLES_LIST', urls });
}

async function handleDeleteSavedArticle(event) {
    const cache = await caches.open(CACHE_NAMES.savedArticles);
    await cache.delete(event.data.url);
    event.source.postMessage({ action: 'ARTICLE_DELETED', url: event.data.url });
}

self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : { title: 'New update on NOOK' };

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body || '',
            icon: '/public/icons/icon-192.png',
            badge: '/public/icons/icon-192.png',
            data: { url: data.url || '/' },
            vibrate: [200, 100, 200]
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    const targetUrl = event.notification.data.url;
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// Service Worker for STC Play PWA
// Handles push notifications and basic caching

const CACHE_NAME = 'stc-play-v1';

// Install event - cache essential assets
self.addEventListener('install', (_event) => {
    console.log('[SW] Installing Service Worker...');
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
    console.log('[SW] Push received:', event);

    let payload = null;
    let data = {
        title: 'STC Play',
        body: 'Você tem uma nova notificação!',
        icon: '/android-chrome-192x192.png',
        badge: '/favicon-32.png',
        tag: 'stc-notification',
        data: {}
    };

    if (event.data) {
        try {
            payload = event.data.json();
            data = { ...data, ...payload };
        } catch {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        tag: data.tag,
        // Reavisa quando outra mensagem da mesma conversa substitui a anterior.
        renotify: Boolean(payload && payload.tag),
        // O servidor manda `url` na raiz do payload; o clique lê de data.url.
        data: { ...(data.data || {}), url: data.url || (data.data && data.data.url) || '/' },
        vibrate: [100, 50, 100],
        actions: data.actions || [],
        requireInteraction: false
    };

    // iOS exige uma notificação visível por push; o selo do ícone é um extra.
    const mostrar = self.registration.showNotification(data.title, options).then(async () => {
        if (!self.navigator || !('setAppBadge' in self.navigator)) return;
        try {
            const abertas = await self.registration.getNotifications();
            await self.navigator.setAppBadge(abertas.length);
        } catch {
            // Selo é opcional.
        }
    });

    event.waitUntil(mostrar);
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked:', event);

    event.notification.close();

    // Get URL from notification data or default to home
    const urlToOpen = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(async (clientList) => {
                if ('clearAppBadge' in self.navigator) {
                    self.navigator.clearAppBadge().catch(() => {});
                }
                // Check if app is already open
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        // navigate() falha se o cliente não for controlado; cai para openWindow.
                        try {
                            await client.navigate(urlToOpen);
                            return client.focus();
                        } catch {
                            break;
                        }
                    }
                }
                // Open new window if not
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});

// Background sync (for future use)
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync:', event.tag);
});

const CACHE_NAME = 'the-25th-chapter-v1';
const STORY_CACHE_NAME = 'story-content-v1';

// App Shell Resources
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  // Add other static assets if known or cache dynamically
];

// Install Event
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== STORY_CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
    ])
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle API Requests (Network First or specific logic)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  // Handle App Shell (Stale-While-Revalidate)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Cache the new response
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

async function handleApiRequest(request) {
  try {
    const response = await fetch(request);

    // Error Interception (409/426)
    if (response.status === 426) {
      // Broadcast HARD_UPDATE
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({ type: 'HARD_UPDATE' });
      });
      // Lock UI state in IndexedDB (mocking here, or using idb library if available in SW)
      // Since we can't easily import libraries in SW without bundling, we'll rely on the message.
      return response;
    }

    if (response.status === 409) {
      // Trigger state-sync event
      const channel = new BroadcastChannel('app-sync');
      channel.postMessage({ type: 'STATE_SYNC' });
      return response;
    }

    // Network First Strategy for Story Content
    if (request.url.includes('/api/blocks/current')) {
      const responseToCache = response.clone();
      caches.open(STORY_CACHE_NAME).then((cache) => {
        cache.put(request, responseToCache);
      });
      return response;
    }

    return response;
  } catch (error) {
    // Fallback to cache for story content if offline
    if (request.url.includes('/api/blocks/current')) {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
    throw error;
  }
}

// Push Notification Event
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/favicon.png',
    badge: '/favicon.png',
    data: {
      url: data.deepLink || '/',
    },
    tag: data.tag || 'story-update', // Collapses notifications with same tag
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'New Story Update', options)
  );
});

// Notification Click Event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data.url, self.location.origin).href;

  const promiseChain = self.clients
    .matchAll({
      type: 'window',
      includeUncontrolled: true,
    })
    .then((windowClients) => {
      // Check if there is already a window open with this URL
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    });

  event.waitUntil(promiseChain);
});

// Message Event (for SKIP_WAITING)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

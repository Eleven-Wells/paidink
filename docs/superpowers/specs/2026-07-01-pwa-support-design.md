# PWA Support — Design Spec

## Overview

Add Progressive Web App capabilities to NOOK: installability, offline reading, and push notifications.

## Architecture

```
Browser
  ├── manifest.json        → installability, splash screen
  ├── sw.js                → service worker (workbox-sw via CDN)
  │   ├── Cache strategies
  │   ├── Offline fallback
  │   └── Push event handlers
  └── Notification API     → permission request + subscription

Fastify Server
  ├── Static files (public/)
  ├── PushService.js       → VAPID keys, send push payloads
  └── routes/push.js       → POST /subscribe, POST /unsubscribe
```

## 1. Web App Manifest

**File:** `public/manifest.json`

```json
{
  "name": "NOOK",
  "short_name": "NOOK",
  "description": "A community reading and writing platform",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6d0a0a",
  "orientation": "portrait",
  "icons": [
    { "src": "/public/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/public/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- Linked from `<head>` in `default.ejs`: `<link rel="manifest" href="/public/manifest.json">` (matches `@fastify/static` prefix)
- Icons: generate 192×192 and 512×512 PNGs from the NOOK logo
- `theme_color: #6d0a0a` matches existing meta tag

## 2. Service Worker

**File:** `public/sw.js` (served at `/sw.js` via custom route)

SW must be served from the root origin for correct scope. In `app.js`:

```js
fastify.get('/sw.js', (req, reply) => {
  reply.header('Service-Worker-Allowed', '/');
  return reply.sendFile('sw.js');
});
```

Uses `workbox-sw` (loaded from CDN) with these caching strategies:

| Strategy | Route | Rationale |
|----------|-------|-----------|
| **Network-first** | Navigation (`/`, `/post/*`, `/dashboard`, etc.) | Always serve fresh HTML; cache as fallback for offline |
| **Cache-first** | Static assets (`/public/css/*`, `/public/js/*`, images, fonts) | Versioned filenames — immutable once deployed |
| **Network-first** | API (`/api/*`) | Fresh data preferred; cached response when offline |

### Offline fallback

- On `install`, precache `offline.html` (a simple branded page saying "You're offline")
- Navigation requests that fail the network step serve `offline.html` from cache

### Save-for-later

- SW listens for `message` events from the client with action `SAVE_ARTICLE`
- Saves the URL + page content to a named cache `nook-saved-articles`
- `postMessage({ action: 'GET_SAVED_ARTICLES' })` returns list of saved URLs

### Lifecycle

- **No `skipWaiting` / `clientsClaim`** — SW waits in `waiting` state until all tabs close
- On `controllerchange` event in the client, a banner appears: "Update available — refresh"
- Users opt into the new version by refreshing

## 3. Push Notifications

### Server side — `src/services/PushService.js`

- **VAPID keys**: Generated once, stored in `SystemConfig` (MongoDB)
- **Subscribe**: `POST /api/push/subscribe` — saves `{ userId, endpoint, keys: { p256dh, auth }, userAgent, createdAt }` to a `PushSubscription` collection
- **Unsubscribe**: `POST /api/push/unsubscribe` — removes the subscription
- **Send**: Accepts userId, title, body, url. Looks up all subscriptions for that user and sends via `web-push`

### Trigger points

| Event | Where | Payload |
|-------|-------|---------|
| New article in followed topic | After article creation | `{ title: "New in {topic}", body: "{article title}", url: "/post/{slug}" }` |
| Reply to comment | After comment creation | `{ title: "New reply", body: "{user} replied to your comment", url: "/post/{slug}#comment-{id}" }` |
| Mention/notification | In notification creation | `{ title: "You were mentioned", body: "...", url: "/post/{slug}" }` |

### Client side — `default.ejs`

- After login check, request `Notification.permission` (only if not already denied)
- If granted, call `POST /api/push/subscribe` with the subscription object
- Service worker listener (see Edge Cases below)

### Edge cases (mandatory)

#### 3a. `push` event — keep browser alive

```js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'New Update' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url }
    })
  );
});
```

#### 3b. `notificationclick` — avoid duplicate tabs

```js
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
```

#### 3c. Expired subscription housekeeping

When sending a push, wrap in try/catch. If the push service returns `410 Gone`, delete that `PushSubscription` record:

```js
try {
  await webpush.sendNotification(subscription, payload);
} catch (err) {
  if (err.statusCode === 410) {
    await PushSubscription.deleteOne({ endpoint: subscription.endpoint });
  }
}
```

## 4. Data Model

### `PushSubscription` (Mongoose)

```js
{
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  endpoint:  { type: String, required: true, unique: true },
  keys: {
    p256dh:  { type: String, required: true },
    auth:    { type: String, required: true }
  },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now }
}
```

## 5. Files Changed / Created

| File | Action |
|------|--------|
| `public/manifest.json` | Create |
| `public/sw.js` | Create |
| `public/offline.html` | Create |
| `public/icons/icon-192.png` | Create |
| `public/icons/icon-512.png` | Create |
| `src/services/PushService.js` | Create |
| `src/routes/push.js` | Create |
| `src/models/PushSubscription.js` | Create |
| `src/views/layouts/default.ejs` | Add manifest link (`/public/manifest.json`) + SW registration + update banner + push permission flow |
| `src/app.js` | Register `GET /sw.js` (with `Service-Worker-Allowed` header) + push routes (`/api/push`) |

## 6. Implementation Notes

### app.js changes

- Register `GET /sw.js` route (after static plugin — uses `reply.sendFile`)
- Register push routes at prefix `/api/push`

### default.ejs changes

- Add `<link rel="manifest" href="/public/manifest.json">` to `<head>`
- Add service worker registration script (deferred, after DOM ready)
- Add push notification permission + subscription logic (only for logged-in users)
- Add `controllerchange` listener for update banner

## 7. Open Questions / Future

- **Update banner**: Implement a UI component in the next iteration for the "Update available — refresh" prompt
- **Followed-topic notifications**: Topic-following model may need expansion to support per-user topic subscriptions
- **Notification preferences**: Per-user toggle for push types (topic, reply, mention) — future enhancement

# Haptic Feedback + SSE Notifications Design

## Motivation
Replace polling-based notification detection with Server-Sent Events (SSE) for real-time delivery. Add haptic (vibration) feedback on mobile when a notification arrives, controlled by a user preference toggle.

## Architecture

```
Notification created (anywhere in app)
    │
    ▼
NotificationService.createNotification()
    │  calls emitter.emitNotification(userId, data)
    ▼
NotificationEmitter (shared EventEmitter, namespaced by userId)
    │
    ▼
SSE endpoint: GET /api/notifications/stream
    │  authenticates via cookie JWT, subscribes to userId events
    │  sends { event: 'notification', data: {...} } messages
    ▼
Client EventSource (connected on every logged-in page)
    │  onmessage → showToast() + navigator.vibrate(40) + update badge
```

## Components

### 1. `src/services/NotificationEmitter.js` (NEW)
Singleton EventEmitter that decouples notification creation from delivery.
- `emitNotification(userId, data)` → emits `notif:<userId>`
- `onNotification(userId, handler)` → subscribes
- `removeNotificationListener(userId, handler)` → unsubscribes

### 2. `src/services/NotificationService.js` (EDIT)
After `Notification.create()` succeeds, call `emitter.emitNotification(userId, notifData)`.

### 3. `src/app.js` (EDIT)
Register `@fastify/sse` plugin on the fastify instance.

### 4. `src/routes/api.js` (EDIT)
Add `GET /api/notifications/stream`:
- `{ sse: true }` route config
- `preHandler: [fastify.authenticate]` for JWT auth
- Subscribe to `emitter.onNotification()` for `req.user.id`
- Send `{ event: 'notification', data: { title, message, type } }` per event
- Clean up handler on `request.raw.on('close')` to prevent leaks

### 5. Client-side (`src/views/partials/scripts.ejs` — EDIT)
Add EventSource connection script (only when `isLoggedIn` is true):
```js
var es = new EventSource('/api/notifications/stream');
es.addEventListener('notification', function(e) {
    var data = JSON.parse(e.data);
    showToast(data.message, 'info');
    if (document.body.dataset.hapticEnabled === 'true') {
        navigator.vibrate(40);
    }
    // Update unread badge state
});
```
Pass haptic preference via `data-haptic-enabled` on `<body>` (set in layout).

### 6. `src/models/User.js` (EDIT)
Add sub-document:
```js
preferences: {
    hapticFeedback: { type: Boolean, default: true }
}
```
Include `preferences` in `toPublicJSON()`.

### 7. `src/routes/api.js` — PATCH /api/user (EDIT)
Accept `preferences` object in request body and apply to user document.

### 8. `src/views/pages/profile.ejs` (EDIT)
In the settings tab, add a "Notifications" section with a toggle switch for "Vibration feedback on notifications". Submit via existing `PATCH /api/user` with `preferences: { hapticFeedback: true/false }`.

## Key Decisions
- **SSE over WebSocket**: Simpler, unidirectional (server→client), native browser API (`EventSource`), auto-reconnect, works over HTTP/1.1.
- **`@fastify/sse`** (official) over `fastify-sse-v2`: Full Fastify 5 integration, connection health, Last-Event-ID support.
- **EventEmitter per userId**: Lightweight (no Redis needed for single-server), events scoped to `notif:<userId>`.
- **Preference in DB over localStorage**: Survives logout/login, consistent across devices.
- **Haptic default enabled**: User can disable in settings.
- **`vibrate(40)`**: 40ms single buzz — short enough not to be annoying, long enough to notice.

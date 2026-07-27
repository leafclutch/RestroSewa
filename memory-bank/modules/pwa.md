# PWA

# Overview
RestroSewa is an installable Progressive Web App with an offline safety gate and push
notifications. See `architecture.md` → "PWA flow".

# Responsibilities
- Make the app installable; provide a manifest + service worker.
- Refuse unsafe writes while offline; deliver push notifications to installed devices.

# Features
- **Installation** — web manifest (`/manifest.webmanifest`) + icons; installable on
  mobile/desktop.
- **Offline capabilities** — an **OfflineGate** that blocks WRITE actions while offline (both
  floor and admin) with a clear message; reads may still show last-known state.
- **Push notifications** — web-push (VAPID); see `modules/notifications.md`.
- **Sync** — no stale write queue: mutations are refused offline rather than queued and replayed.

# Business Rules
- **Do NOT queue offline writes.** Money/stock mutations must not be applied against stale state,
  so the gate refuses them; the user retries when back online. This is deliberate (see the
  OfflineGate rationale).
- PWA assets are generated via `npm run pwa:assets`.

# Important Components
- `components/pwa/offline-gate.tsx`, the service worker + manifest, `scripts/generate-pwa-assets.mjs`.
- Push wiring in `app/actions/push.ts` / `app/api/push/action`.

# Database Relations
None of its own; push subscriptions live per device (see `modules/notifications.md`).

# Realtime Behaviour
Online: SSE keeps the app live (`modules/realtime.md`). Offline: no live updates; push reaches
installed devices when events fire server-side.

# Permissions
The gate is orthogonal to permissions — it blocks writes for everyone while offline; permission
checks still apply online.

# Known Limitations
- No offline write queue by design; offline = read-only.
- Push requires install + granted permission per device.

# Future Improvements
- Selective offline caching of read-only screens (menu) for smoother reconnects.

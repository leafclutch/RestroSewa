# Realtime

# Overview
Live updates via **Server-Sent Events** (not Supabase Realtime channels). `/api/realtime` holds a
per-client SSE stream; `useRealtime(channels, onEvent)` re-fetches on the client when a relevant
event broadcasts. See `architecture.md` → "Realtime flow".

# Responsibilities
- Broadcast server-side changes to connected clients and trigger targeted re-fetches.
- Keep the floor dashboards live without polling.

# Features
- **Subscribe** — `useRealtime(["orders","stock",…], cb)` opens/joins the SSE stream and calls `cb`
  on matching events.
- **Publish** — server writes broadcast channel events (e.g. after an order/payment/stock change).
- **Channels** — logical names like `orders`, `stock`, `purchases`, `vendors`, tables/sessions,
  notifications. Consumers subscribe to only what they render.
- **Cleanup** — the hook closes the stream on unmount; the route drops the client on disconnect.

# Business Rules
- Realtime is a *refresh trigger*, not the data source — clients re-call the Server Action to get
  fresh, permission-checked data (never trust a pushed payload for authorization).
- The dashboard keeps an open SSE, so `networkidle` never settles — E2E tests use content waits
  (the login page has no SSE and is safe for `networkidle`).

# Important Components
- `app/api/realtime/route.ts` (SSE endpoint), `lib/realtime/use-realtime.ts` (client hook).
- Consumers: employee dashboard sections, admin lists (stock/purchases/vendors), notifications.

# Database Relations
None of its own — it signals changes to rows owned by other modules (orders, sessions, stock,
payments). See `database.md`.

# Performance considerations
Fits the **latency-bound** model (`decisions.md`): SSE avoids polling round trips; a re-fetch is a
single cheap query. Subscribe narrowly (only needed channels) to avoid needless re-fetches; the
hook must clean up to avoid leaking streams. Don't add DB indexes for realtime — remove round
trips instead.

# Permissions
Re-fetches go through permission-checked actions, so realtime never widens access. See
`modules/permissions.md`.

# Known Limitations
- SSE is one-directional (server→client); actions are the write path. Offline clients get nothing
  live (push covers installed devices — see `modules/pwa.md`, `modules/notifications.md`).

# Future Improvements
- Backpressure/coalescing for very busy floors; presence (who's viewing a table).

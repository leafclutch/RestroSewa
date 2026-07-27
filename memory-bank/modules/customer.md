# Customer

# Overview
The guest-facing experience at `app/c/[slug]` — no account, reached by scanning a table/room QR.
Menu browsing, ordering, calling a waiter, requesting the bill. See `modules/qr.md` for the entry
mechanics and modes.

# Responsibilities
- Show the restaurant's menu and let a guest order, call staff, and ask for the bill.
- Present a clean, installable, theme-aware customer surface.

# Features
- **QR flow** — scan → land on the restaurant's customer page for that table/room (see
  `modules/qr.md` for With-PIN / Without-PIN / Menu-Only modes).
- **Menu** — categories + items + variants; availability reflects kitchen toggles.
- **Ordering** — build an order; it attaches to the table/room **session** and appears in the
  staff queue + rings the group's staff (see `modules/tables.md`, `modules/notifications.md`).
- **Call waiter** — signal staff for attention.
- **Bill request** — ask staff to bring/settle the bill.
- **PWA** — the customer page is part of the installable app (`modules/pwa.md`).
- **Dark mode** — device-driven dark theme via a `.customer-surface` token layer; `color-scheme`
  opt-out kills browser force-dark so the menu's own theme wins (see `customer-dark-and-color-scheme`).

# Business Rules
- No customer account or auth; the PIN (in With-PIN mode) is a **client-only** convenience gate,
  not security.
- The customer's order/session follows the **session**, not the QR — a table shift carries it.
- Menu-Only mode shows the menu with no ordering.

# Important Components
- `app/c/[slug]/*` (customer pages), `app/actions/customer.ts`, `app/actions/menu.ts`.
- Customer theme tokens (`.customer-surface`) in the global CSS.

# Database Relations
`restaurants` (qr_mode, menu, logo), `menu_*`, `sessions`, `session_orders`/`session_order_items`.
See `database.md`.

# Realtime Behaviour
The guest's own order feed updates live; new orders push to staff (SSE + web-push). See
`modules/realtime.md`.

# Permissions
None (unauthenticated). Ordering availability is governed by the restaurant's `qr_mode`.

# Known Limitations
- No customer login/history; no online payment (settlement is at the counter/staff).

# Future Improvements
- Optional customer accounts/loyalty; online payment; order status tracking for the guest.

# QR

# Overview
How a guest enters the system by scanning a table/room QR, and the per-restaurant ordering
**mode** that governs what they can do. The guest experience itself is in `modules/customer.md`.

# Responsibilities
- Resolve a scanned QR to the right restaurant + table/room + session.
- Enforce the restaurant's ordering mode and the (client-only) PIN gate.

# Features
- **QR entry** — each table/room has a QR that opens `app/c/[slug]` pointed at that location.
- **Ordering modes** (`restaurants.qr_mode`):
  - **With PIN** — guest enters a PIN before ordering (client-only gate).
  - **Without PIN** — order directly.
  - **Menu Only** — browse the menu; no ordering.
- **QR generation** — codes rendered via `qrcode.react` for tables/rooms.

# Business Rules
- The **PIN is a client-only** convenience gate — never a security boundary (no server secret).
- The QR points at a location, but the customer follows the **session**, not the QR — a table
  shift (see `modules/tables.md`) carries the guest without re-scanning.
- Mode is per-restaurant and set by the owner (see `modules/settings.md`).

# Important Components
- `app/c/[slug]/*` (entry + mode handling), `qrcode.react` usage in admin tables/rooms.
- `restaurants.qr_mode` read via `getRestaurantConfig`.

# Database Relations
`restaurants.qr_mode`, tables/rooms, `sessions`. See `database.md`, `modules/tables.md`.

# Permissions
None (guest, unauthenticated). Owner sets the mode.

# Known Limitations
- PIN gate is client-side only (by design — deters accidental orders, not attackers).

# Future Improvements
- Per-table QR analytics; dynamic QR that encodes the current session.

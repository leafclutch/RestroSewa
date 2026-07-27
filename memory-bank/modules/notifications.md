# Notifications

# Overview
Signalling to staff about things that need attention — primarily new orders and activation
requests — via web-push and the in-app panel. See `architecture.md` → "Notification flow".

# Responsibilities
- Ring the right staff when an order arrives or a table activation needs approval.
- Keep the in-app notification panel as the record.

# Features
- **Realtime/in-app notifications** — the panel + live updates via SSE (see `modules/realtime.md`).
- **PWA push notifications** — web-push (VAPID) to installed devices.
- **New-order ring** — recipients = the order's workstations **∪** the table-group's assigned
  staff, computed **disjoint** (no double-ring).
- **Approval notifications** — table activation requests surface as an approval card
  (accept/reject; `reject_table_activation` is a compare-and-swap).

# Business Rules
- Push is for *signalling*; the in-app panel is the *record* (deliberate split).
- Recipients are deduped across stations + group staff — a staffer is rung once.
- Payment/close pushes were **removed** — only new-order (and approvals) ring.
- Offline devices can't receive live SSE; push covers installed devices (see `modules/pwa.md`).

# Important Components
- `app/api/push/action/route.ts`, `app/actions/push.ts`, `app/actions/notifications.ts`.
- `app/api/realtime` (SSE), `lib/realtime/use-realtime.ts`.
- VAPID keys in env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).

# Database Relations
Push subscriptions per staff/device; notification/order rows. See `database.md` (orders,
sessions) — no schema duplicated here.

# Realtime Behaviour
The in-app panel subscribes to notification/order channels; push fires server-side on the same
events. See `modules/realtime.md`.

# Permissions
Notifications follow the staff's order/table visibility (`view_dashboard`/`view_orders`/
`create_orders`/etc.). See `modules/permissions.md`.

# Known Limitations
- No per-event user preferences; push depends on the device having installed the PWA + granted
  permission.

# Future Improvements
- Per-staff notification preferences; low-stock / failed-report alerts; quiet hours.

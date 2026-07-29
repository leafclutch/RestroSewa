# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Custom items (manual order lines).** Built and verified on DEV. `tsc` clean; DB smoke-test
confirms a custom row inserts with `menu_item_id` NULL + `is_custom` true and moves no stock. See
`modules/custom-items.md`, `docs/superpowers/specs/2026-07-29-custom-items-design.md`.

## Files involved
- `supabase/migrations/20260729200000_custom_items.sql` (`session_order_items.is_custom`).
- `lib/custom-items.ts` (validate/snapshot); `lib/permissions.ts` (`manage_custom_items` + presets).
- `app/actions/pos.ts` `submitOrder` (accepts `custom_items`, permission-gated) + `is_custom` on
  `OrderItemRow`/`QueueOrderItem`/`PaidBillItem` and their selects.
- `add/page.tsx` + `add/_components/menu-browser.tsx` (form + cart); markers in `order-item.tsx`,
  `orders-queue.tsx`, `bill-ticket.tsx`, `print-tickets.tsx` (docket skip for station-less custom).

## Completed
- DEV migration applied; `tsc --noEmit` clean; DB insert semantics smoke-tested.
- Memory Bank updated.

## Remaining
1. **Prod DB migration (user triggers):** `node scripts/migrate.mjs up --prod` — applies BOTH
   pending prod migrations: `20260729100000_security_pin.sql` and `20260729200000_custom_items.sql`.
   Nothing else prod-side (no env/cron).
2. Deploy the app code (user drives git; nothing committed this session).
3. Manual in-app QA once deployed: grant a waiter `manage_custom_items`; add a custom item routed
   to a station and one bill-only; confirm KOT shows only the routed one, the bill shows both marked
   "Custom", discounts/sales include them, and stock is untouched.

## Risks
- Custom items let staff type any price — mitigated by the dedicated permission (server re-checked)
  and the "CUSTOM" marking everywhere.

## Notes
- Two prior tasks still pending USER ops:
  1. **Security PIN** — prod migration `20260729100000_security_pin.sql` (folded into step 1 above)
     + in-app QA. See `modules/security-pin.md`.
  2. **Daily Finance Report** prod rollout (Vercel env GMAIL_USER/GMAIL_APP_PASSWORD/
     SUMMARY_FROM_NAME/CRON_SECRET; pg_cron/Vault per `docs/daily-summary-setup.md`; enable per
     restaurant). No code left in either.

---

### Template (reset to this when idle)
```
## Current Feature
(none — idle)
## Files involved
## Completed
## Remaining
## Risks
## Notes
```

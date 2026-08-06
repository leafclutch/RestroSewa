# Settings

# Overview
Owner-only restaurant configuration at `/admin/settings` (`requireRestaurantAdmin`). Each
setting is its own card + its own Server Action so an unrelated "Save" never rides along.

# Responsibilities
- Business closing time, PAN/VAT + bill phone, bill numbering, per-workstation OT numbering, discount PIN,
  daily finance report recipients + history, logo (via branding).

# Features
- **Business closing time** — the day boundary; changing it re-buckets every date-based figure
  (warned in UI). Stored `settings.business_closing_hour`. See `modules/finance.md`,
  `decisions.md`.
- **Bill header / numbering** — editable PAN **and phone** (both print in the bill header, PAN then phone), next bill number, padding, "Bill"/"Order" label;
  stamped by a DB trigger on payment (history-preserving; unused numbers roll back).
- **OT numbering** — per-workstation prefix (`ticket_code`) + next number (see `modules/printing.md`).
- **Discount PIN** — set/clear the PIN that gates discounts (hashed in-DB via `set_discount_pin`;
  hash never leaves the server). No PIN ⇒ discounts impossible.
- **Security PIN + Security activity** — independent admin PIN that gates editing completed
  payments/purchases (and future sensitive ops), plus a read-only audit list. See
  `modules/security-pin.md`. No PIN ⇒ those edits are OFF.
- **Daily Finance Report Recipients** — up to 3 emails (add/edit/remove, validated, deduped) +
  **Report history** table with per-row Retry. See `modules/finance.md`, `lib/reports/*`.
- **Logo** — restaurant logo in Supabase Storage (branding system).

# Business Rules
- All settings live in `restaurants` (columns + `settings jsonb`); every writer calls
  `revalidateRestaurantInfo` (config is cached 60s). See `database.md` → restaurants.
- Sync config helpers (e.g. `normalizeDailySummaryConfig`) live in a PLAIN module, imported into
  the `"use server"` settings actions — never exported from the server module.

# Important Components
- `app/actions/settings.ts` (billing, business-day, discount PIN, OT numbering, daily-summary
  get/update, `getReportHistory`, `retryReportDelivery`); `app/actions/security.ts` +
  `security-pin-client`/`security-activity-client` (Security PIN + audit).
- `app/(admin)/admin/settings/page.tsx` + `_components/*` (settings, business-day, discount-pin,
  workstation-numbering, daily-summary clients).
- `lib/restaurant-info.ts` (`getRestaurantConfig`, `revalidateRestaurantInfo`), `lib/business-day.ts`.

# Database Relations
`restaurants` (config columns + `settings` jsonb); `report_deliveries` for report history.

# Permissions
Owner-only (admin role) — the page redirects non-admins and every action re-checks.

# Known Limitations
- `report_deliveries.recipients`/history is per-restaurant; no per-recipient delivery status.

# Future Improvements
- Configurable report send-time offset; more branding controls; tax/service-charge editors.

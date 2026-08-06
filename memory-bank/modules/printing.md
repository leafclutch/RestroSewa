# Printing

# Overview
Kitchen/bar order tickets and customer bills on thermal printers. Built around per-workstation
**Order-Ticket (OT) batching**. See `architecture.md` → "Printing flow" and `decisions.md` → "OT
batching".

# Responsibilities
- Print Order Tickets (KOT/BOT/COT…) per workstation and customer bills.
- Own OT and bill numbering; keep numbers stable and gap-aware.

# Features
- **OT printing** — each workstation prints its own ticket for the items routed to it; the ticket
  header/button uses the workstation's `ticket_code` prefix.
- **Bills** — customer receipt with restaurant header, **PAN then phone**, bill number,
  tax/service. Both header lines are set by the owner in Admin → Settings → Bill header
  (`restaurants.pan_vat_number` / `contact_phone` — the same `contact_phone` column the superadmin
  surface edits; both writers call `revalidateRestaurantInfo`).
- **Workstations** — kitchen/bar/etc. stations; category→item routing is DB-trigger-enforced.
- **Thermal printing** — 58mm or 80mm layout from `settings.print_paper_width`; the print modal
  portals to `document.body`.
- **Receipt / OT numbering** — bill numbers are sequential + trigger-stamped; OT numbers are
  per-workstation and assigned at **print time** (commit-on-Print) with reprint history.

# Business Rules
- An item belongs to **one ticket for life** (`order_tickets.ticket_id`); print-time numbering
  replaced insert-time so a reprint doesn't renumber history and a number is never reused.
- Bill numbers: changing the sequence affects only future bills; unused numbers roll back on
  cancel/abandon (latest only); issued numbers are immutable.
- Printing gates on billing permissions.
- Workstation routing lives in the DB trigger — the "variant bug" was never about variants.
- A customer bill is titled **BILL whether it is paid or not** (and its number line reads "Bill No"
  unless Settings overrides the label). It used to flip to "TAX INVOICE" / "Receipt No" once paid —
  one sale printing as two differently-titled documents. The PAID/tender block is what changes.
- **Side margins are CONTENT padding, never a smaller `@page`.** The page must keep matching the
  driver's advertised printable width exactly (72mm / 48mm) or Chrome stops honouring it and clips
  the right-hand column — the bug the geometry exists to fix. So `SIDE_MARGIN_MM` insets the ticket
  INSIDE that page (`box-sizing: border-box`, so 72mm stays 72mm and content becomes 66mm).

# Important Components
- `lib/workstations/ticket-code.ts` (`ticketCodeOf`, `defaultTicketCode`),
  `lib/billing/bill-number.ts` (`normalizeBillLabel`).
- `app/actions/workstations.ts`, `app/actions/settings.ts` (OT + bill numbering config).
- Print modal component (portals to body); `order_tickets` migrations (`20260722000000`).

# Database Relations
`workstations` (ot_next, ticket_code), `order_tickets` (ticket_id, ot_number, location_label),
`payments` (bill_number). See `database.md`.

# Permissions
Billing permissions gate printing/bills; OT numbering config is owner-only (Settings). See
`modules/permissions.md`, `modules/settings.md`.

# Known Limitations
- Currently thermal printers; kitchen and bar separated by workstation. No multi-printer routing
  layer (each station prints its own ticket).

# Future Improvements
- Multiple-printer routing / network print server; PDF/A4 bill option.

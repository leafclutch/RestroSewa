# Security PIN system — design

**Date:** 2026-07-29
**Status:** Approved (design). Implementation in progress.

## Goal

An independent **Security PIN** (separate from the existing Discount PIN) that the restaurant
**admin** sets in Admin → Settings and that gates sensitive financial edits:

- Editing a completed **payment** record (re-tender: cash/online/card split + derived method).
- Editing a **purchase** record (amount/quantity/product/vendor/payment method).
- Future sensitive ops (refunds, stock reset, finance reset) reuse the same service.

Every attempt — success, failure, or blocked-by-reconciliation — is written to an audit log
visible to the owner in Settings.

## Decisions (locked with the user)

1. **Reconcile model:** in-place edit + before→after audit snapshot. Finance/stock re-derive
   automatically; the audit log IS the immutability guarantee.
2. **Payment edits:** method + cash/online/card split ONLY. Total, discount and bill number stay
   frozen. The split is the source of truth; `payment_method` is *derived* from it (one non-zero
   tender → that method, several → `mixed`). Never changes the sale amount — only how it was tendered.
3. **Purchase edits:** reconcile vendor credit **in-transaction**; if the result would make any
   affected vendor's `credit_balance` inconsistent (negative — e.g. payments already exceed the
   reduced debt), the edit is **refused** with a clear message. The DB `vendors_credit_balance_check
   (>= 0)` backs this up.
4. **Audit surface:** owner-only, a read-only "Security activity" section on `/admin/settings`.
5. **Edit window:** any record, any date (corrections often reach back). Past-day edits re-derive
   that day; the audit row records who/what/when.
6. **No PIN configured = sensitive edits are OFF** (mirrors the Discount PIN's "no un-gated path").
7. **No lockout in v1** — every failed attempt is logged; a lockout can be layered on the audit log
   later.
8. These ops are **admin-only** (`requireRestaurantAdmin`) AND PIN-gated. Staff never see Edit.

## Architecture

### Layer 1 — Database (one migration, mirrors `20260717120000_discount_pin.sql`)

- `restaurants.security_pin_hash text` (NULL = not set) — independent of `discount_pin_hash`.
- `set_security_pin(restaurant_id, pin)` / `verify_security_pin(restaurant_id, pin)` — bcrypt,
  `SECURITY DEFINER`, `service_role` only. Verbatim clones of the discount RPCs.
- `security_audit_log` table:
  `id, restaurant_id, actor_user_id, actor_name text, operation text, target_type text,
   target_id uuid, outcome text ('success'|'failure'|'blocked'), detail jsonb, created_at`.
  Index `(restaurant_id, created_at desc)`. `service_role`-only.
- `edit_payment_tender(restaurant_id, actor_id, actor_name, payment_id, cash, online, card)` RPC:
  loads the payment (must be this restaurant's), asserts `cash+online+card = coalesce(total_amount,
  amount)` (± sub-paisa), derives `payment_method`, updates the row, and inserts a `success` audit
  row with before→after — **atomically**. Bill number, total, discount untouched.
- `edit_purchase(restaurant_id, actor_id, actor_name, purchase_id, vendor_id, method, cash, online,
  items jsonb, notes)` RPC: recomputes the bill from `items` (like `record_purchase`), reverses the
  purchase's OLD credit impact on its OLD vendor and applies the NEW credit to the (possibly new)
  vendor, replaces `purchase_items`, recomputes `last_unit_cost` for every affected product to that
  product's latest purchase, and inserts the `success` audit row — atomically. Locks affected
  vendor(s) `for update`. Raises `VENDOR_BALANCE_NEGATIVE` (rolling everything back) if a vendor
  balance would go < 0.

Failure logging is **not** inside these RPCs (a RAISE would roll the audit insert back). It lives
in the TS layer so a rejected attempt always persists.

### Layer 2 — Reusable authorization service

- `lib/restaurant-info.ts` → add `securityPinSet` boolean (hash never leaves this function).
- `app/actions/security.ts` (`"use server"`):
  - `getSecurityPinStatus()` → `{ securityPinSet }`.
  - `updateSecurityPin(prev, formData)` — set/change/clear; 4-digit + confirm (same shape as the
    discount PIN); calls `set_security_pin`; `revalidateRestaurantInfo` + `revalidatePath`.
  - `verifySecurityPin(operation, pin)` — the reusable primitive: `requireRestaurantAdmin` →
    `verify_security_pin` RPC → on failure writes a `failure` audit row and returns
    `{ authorized: false }`; on success returns `{ authorized: true }`. Failure logging lives here.
  - `logSecurityBlocked(operation, target, detail)` — for reconciliation refusals (a caught coded
    error after a successful PIN).
  - `getSecurityAuditLog(limit)` → rows for the Settings surface.
- **Flow for any sensitive op:** action calls `verifySecurityPin(op, pin)`; if not authorized,
  return error (failure already logged); if authorized, call the op's RPC (which writes the
  `success` row atomically); on a coded reconciliation error, call `logSecurityBlocked` and return
  a friendly message. Future refunds/stock-reset/finance-reset reuse `verifySecurityPin` + their own
  RPC with a new `operation` string — no new plumbing.

### Layer 3 — Edit actions

- `updatePaymentTender(pin, paymentId, { cash, online, card })` → gated + `edit_payment_tender`.
- `updatePurchase(pin, purchaseId, changes)` → gated + `edit_purchase`.

### Layer 4 — UI

- **Settings** (`/admin/settings`): `<SecurityPinClient>` card (set/change/clear) next to the
  Discount PIN card, plus a read-only **"Security activity"** section from `getSecurityAuditLog`.
- **Reusable `<SecurityPinDialog>`**: click Edit → prompts 4-digit PIN → submits to the calling
  action → allow/reject. Used by both edit flows and any future one.
- **Edit entry points**: Edit button on completed payments (Sales surface) and on purchases
  (Purchases surface) — admin-only, disabled with "Set a Security PIN in Settings first" when no PIN.

## Deliberately frozen (not editable)

Bill numbers, payment totals, discount amounts (payment edits only re-tender the same total);
purchases are never deleted. A total change to a purchase goes through editing its items.

## Verified schema facts (live DEV DB, 2026-07-29)

- `payments`: `amount NOT NULL`, `total_amount` nullable, `cash_amount/online_amount/card_amount
  NOT NULL default 0`, `discount_amount`, `bill_number`. No CHECK ties the split to the total — the
  RPC enforces it. `payments_source_check` = session XOR room_stay.
- `purchases`: CHECK `cash+online+credit = total`, `total > 0`; method cash/online/credit.
- `vendors.credit_balance` CHECK `>= 0`.
- `payment_method` enum: cash, card, upi, other, online, mixed, credit.
- `restaurants.security_pin_hash` does not yet exist.

## Out of scope (v1)

PIN lockout/rate-limit; editing bill numbers, totals, or discounts; purchase deletion; reversal/
void accounting entries; super-admin cross-restaurant audit view.

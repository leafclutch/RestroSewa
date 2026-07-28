# Bugs

Active bugs at the top; resolved ones moved to the bottom. Each: Title · Priority · Affected
modules · Status · Possible cause · Fix · (Resolved date).

## Active
_None currently tracked._ When a bug is found, add it here with a priority (High/Med/Low) and
enough detail to reproduce.

---

## Resolved

### Dashboard action abort race — High — resolved 2026-07-22
*Modules:* staff dashboard, server actions. *Cause:* concurrent/aborted dashboard actions could
land out of order. *Fix:* addressed via the latency/round-trip model (see `decisions.md` →
latency-bound); the obvious optimistic-UI fix was rejected as worse. *Note:* don't re-introduce
optimistic UI here.

### Stock retro-deduction on linking a menu item — High — resolved (Stock module)
*Modules:* stock, `stock_report`. *Cause:* usage joined ALL past sales of a menu item when a
product link was added, driving stock deeply negative on day one. *Fix:* load-bearing filter
`soi.created_at >= mip.created_at` — tracking starts at link time. Do not "simplify" it away.

### @theme `inline` broke dark mode — Med — resolved
*Modules:* globals.css / theming. *Cause:* `inline` in the Tailwind v4 `@theme` froze every
utility to a literal hex and made the `.dark` block inert. *Fix:* removed `inline`; tokens live
in `:root`/`.dark`, not `@theme`. Never re-add it.

### `.rs-page` fixed modals trapped off-screen on mobile — Med — resolved
*Modules:* page animation / modals. *Cause:* animation `fill-mode: both` left an identity-matrix
transform on the ancestor, which traps `position:fixed` children. *Fix:* use
`fill-mode: backwards`.

### Timezone / "yesterday shows in today's sales" — High — resolved (business-day)
*Modules:* reporting. *Cause:* day computed in the server's timezone (UTC on Vercel), so post-
midnight Nepal sales landed on the wrong day. *Fix:* all day maths pinned to Nepal UTC+05:45 in
`lib/business-day.ts`; anchor on `businessDate(now)`.

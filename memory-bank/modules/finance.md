# Finance

# Overview
The money picture: four derived balances, credit, vendor payments, profit, and the daily report.
Everything is DERIVED from source rows — see `decisions.md` → "Four derived balances". This
module covers the on-screen Finance report and the emailed daily report.

# Responsibilities
- Opening/closing balances, cash/online/credit movement, purchases/expenses, profit estimate.
- Customer credit (receivable) and vendor credit (payable) rollups.
- The Daily Finance Report (PDF emailed after close).

# Features
- **Finance report** (`/admin/finance`) — `finance_report(restaurant, from, to)` derives opening,
  sales split, purchases, vendor+customer credit, salaries, and closing. CSV export mirrors it.
- **Opening balance seed** (`finance_openings`) — the one non-derivable number; every later day's
  opening carries forward.
- **Business closing time** — periods anchor on the per-restaurant closing hour (see
  `modules/settings.md`, `lib/business-day.ts`).
- **Daily Finance Report** — automatic per-business-day PDF from `lib/reports/*`, emailed via
  HRestroSewa Gmail; recipients + history/retry in Settings. Model adds mixed payments +
  inventory value. See `decisions.md` → "Daily Finance Report design", `modules/settings.md`.

# Business Rules
- **Four balances**: cash, online/bank, credit-to-us (receivable), credit-by-us (payable).
  Closing = opening + in − out; a period's opening = the same sum at its start ⇒ carry-forward
  cannot drift. Credit moves NO cash the day it's created (accrual — the sale counts at billing).
- Card is bank money for balances (own Sales line). Mixed = cash+online in lockstep.
- **Estimated profit** = sales − purchases − salaries; it's optimistic (bought-stock cost, not
  consumed; unlinked dishes have no cost) and must always be labelled an estimate.
- Report exactly-once via `report_deliveries`; failures logged + retryable.

# Important Components
- `app/actions/finance.ts`, `lib/finance.ts`; RPCs `finance_report`, `set_finance_opening`,
  `dashboard_stats`.
- `lib/reports/{daily-summary,daily-summary-pdf,daily-summary-send}.ts`,
  `lib/reports/pdf/report-document.ts`, `lib/email/mailer.ts`, `app/api/cron/daily-summary`.

# Database Relations
`payments`, `credits`/`credit_payments`, `purchases`/`vendor_payments`, `finance_openings`,
`report_deliveries` — see `database.md`. Stock valuation reuses `stock_report` (see `modules/stock.md`).

# Permissions
`view_finance` (separate from stock — it exposes takings, margins, all debt). Opening-balance
write needs `manage_stock` + `view_finance`. Daily-report config is owner-only. See
`modules/permissions.md`.

# Known Limitations
- Profit is an estimate (COGS only for product-linked items).
- Daily report is per-restaurant; no weekly/monthly yet.

# Future Improvements
- Weekly/monthly/yearly reports reusing the report service (see `roadmap.md`).
- Verified sending domain for deliverability; charts in the PDF.

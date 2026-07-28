# Roadmap

Future work, grouped by priority. Keep this the long-term plan; move items to `current-task.md`
when picked up and to `completed.md` when shipped.

## High priority
- **Ship the Daily Finance Report to production** (ops config only — see `current-task.md`).
- **Weekly / monthly / yearly reports.** Reuse the reporting service (`ReportPdf` chrome, Gmail
  mailer, orchestrator shape, `report_deliveries.period_type`) — a new model builder + layout +
  `sendWeeklySummary`, `period_type='weekly'`. No infra rewrite.

## Medium priority
- **Restaurant-admin staff surface.** `create_staff` / `edit_staff` / `delete_staff` permissions
  already exist (reserved, currently unused — staff CRUD is super-admin only). Build an in-admin
  staff management screen gated on them when needed.
- **Deliverability hardening for reports.** Consider a verified sending domain (SPF/DKIM) instead
  of a bare Gmail sender to reduce spam-foldering; watch Gmail's daily cap as tenants grow.
- **Report contents polish.** Charts/sparklines in the PDF; per-day comparison; branded logo in
  the header once every tenant has one uploaded.

## Low priority
- **Cost / hosting review.** Earlier discussion on Supabase cost vs a self-hosted VPS
  (DigitalOcean). Revisit only if Supabase spend becomes material; current stance: stay managed.
- **Retry/observability polish** for the cron (surface `cron.job_run_details`, alert on repeated
  failures).

## Ideas (unvetted)
- In-app "download report now" button (reuse `renderDailySummaryPdf` on demand).
- Configurable report send-time offset after closing (currently ~within the hour after close).
- Multi-currency / multi-locale if expanding beyond Nepal/NPR.
- Export/accounting integrations (CSV already exists for finance; consider Tally/Excel formats).

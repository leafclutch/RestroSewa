# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Daily Finance Report — production rollout.** The feature is built, verified end-to-end on DEV
(real data → PDF → live Gmail delivery confirmed). Remaining work is prod configuration only —
no code changes.

## Files involved
- `lib/reports/*` (daily-summary, daily-summary-pdf, daily-summary-send, pdf/report-document)
- `lib/email/mailer.ts`, `app/api/cron/daily-summary/route.ts`
- `app/actions/settings.ts`, `app/(admin)/admin/settings/_components/daily-summary-client.tsx`
- `supabase/migrations/20260727300000_report_deliveries.sql`,
  `20260727500000_report_delivery_history.sql`
- `supabase/cron/daily-summary-cron.sql`, `docs/daily-summary-setup.md`

## Completed
- Gmail SMTP verified (App Password); live test emails delivered.
- PDF renderer + reusable report chrome; model incl. mixed payments + inventory value.
- Orchestrator (cron + manual retry share one path); admin history + retry UI.
- DEV: migrations applied; env vars set in `.env.local` (+ prod values in `.env.production`).
- `tsc` + `next build` green.

## Remaining (ops — user performs)
1. Vercel (Production env): add `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SUMMARY_FROM_NAME`,
   `CRON_SECRET` (prod value), then redeploy.
2. Prod DB: `node scripts/migrate.mjs up --prod` (adds `report_deliveries` + history columns).
3. Prod Supabase: enable `pg_cron`+`pg_net`; Vault `app_base_url` + `cron_secret` (= prod
   CRON_SECRET); run `supabase/cron/daily-summary-cron.sql`.
4. Per restaurant: enable the report + add recipients in Admin → Settings.

## Risks
- Prod `CRON_SECRET` in Vercel must equal the Vault `cron_secret` or the cron gets 404.
- Gmail ~500 mails/day cap (ample); first-send may land in Spam until marked "Not spam".

## Notes
- The account password the owner first pasted is NOT the App Password (Gmail rejects it);
  only the 16-char App Password works. Both were placed in env — App Password is the live one.

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

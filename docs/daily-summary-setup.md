# Daily Finance Report — setup

After a restaurant's business day closes, the app generates a **PDF financial report** and
emails it (from our HRestroSewa Gmail) to the recipients configured in
**Admin → Settings → Daily Finance Report Recipients** (up to 3). Not opted in ⇒ skipped.
Failures are logged and retryable from the **Report history** in Settings.

Owners configure recipients in the UI. The pieces below are the one-time infrastructure
setup an operator (HRestroSewa) does per environment.

## 1. Environment variables

Add to `.env.local` (DEV) and the Vercel project env (prod). **Append with a trailing
newline** — never `>>` onto a file with no final newline (it silently concatenates onto the
previous value). These are the SENDER credentials — one HRestroSewa account for every
restaurant; restaurants never configure SMTP.

| Var | What |
|---|---|
| `GMAIL_USER` | The HRestroSewa Gmail address that sends all reports (the `from`). |
| `GMAIL_APP_PASSWORD` | A Google **App Password** (not the account password). See below. |
| `SUMMARY_FROM_NAME` | Optional display name; defaults to `HRestroSewa Reports`. |
| `CRON_SECRET` | A long random string. The cron job sends it back in the `x-cron-secret` header. Generate one: `openssl rand -hex 32`. |

## 2. Gmail App Password

1. On the HRestroSewa Google account, enable **2-Step Verification**.
2. Create an **App Password** (Google Account → Security → App passwords) → use it as
   `GMAIL_APP_PASSWORD`. Set `GMAIL_USER` to that Gmail address.
3. Mail sends via `smtp.gmail.com:465` (implicit TLS). Gmail caps ~500 recipients/day —
   ample for daily reports. Credentials live only in server env vars; they never reach the
   client (the mailer is `server-only`).

## 3. Database

Apply the migrations (the `report_deliveries` log + its history columns):

```
node scripts/migrate.mjs up            # dev
node scripts/migrate.mjs up --prod     # prod
```

## 4. Scheduler (Supabase pg_cron)

Run **once per environment**, in the Supabase SQL editor:

1. Enable the `pg_cron` and `pg_net` extensions (Dashboard → Database → Extensions, or the
   `create extension` lines in the cron file).
2. Store two Vault secrets (Dashboard → Project Settings → Vault, or SQL):
   ```sql
   select vault.create_secret('https://your-app.example.com', 'app_base_url');
   select vault.create_secret('<same value as CRON_SECRET>',   'cron_secret');
   ```
3. Run `supabase/cron/daily-summary-cron.sql` to schedule the hourly job.

The job runs hourly and POSTs `/api/cron/daily-summary` with the secret header. The route
always reports on each restaurant's **previous** business day (always fully closed) and
dedupes via `report_deliveries`, so one hourly job correctly covers every restaurant's
different closing time, and a missed hour self-heals on the next tick.

## 5. Test it

- Manually trigger the route (replace host + secret):
  ```
  curl -X POST -H "x-cron-secret: $CRON_SECRET" https://your-app.example.com/api/cron/daily-summary
  ```
  Response is a JSON summary: `{ processed, sent, skipped, failed }`. A wrong/missing
  secret returns `404`.
- Inspect the schedule and runs in Supabase:
  ```sql
  select * from cron.job;
  select * from cron.job_run_details order by start_time desc limit 20;
  select * from report_deliveries order by sent_at desc limit 20;
  ```

## Extending to weekly / monthly

`report_deliveries` already keys on `(restaurant_id, period_type, period_key)`. A weekly or
monthly sender reuses the same table with `period_type = 'weekly' | 'monthly'` and an
appropriate `period_key` (ISO week / month) — no schema change, and the same exactly-once
guarantee.

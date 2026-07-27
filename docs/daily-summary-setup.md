# Daily financial-summary emails — setup

After a restaurant's business day closes, the app emails a financial summary to the
addresses configured in **Admin → Settings → Daily summary emails** (up to 3). If a
restaurant hasn't turned it on, it's skipped.

Owners configure recipients in the UI. The pieces below are the one-time infrastructure
setup an operator does per environment.

## 1. Environment variables

Add to `.env.local` (DEV) and the Vercel project env (prod). **Append with a trailing
newline** — never `>>` onto a file with no final newline (it silently concatenates onto the
previous value).

| Var | What |
|---|---|
| `RESEND_API_KEY` | Resend API key (Resend → API Keys). |
| `SUMMARY_FROM_EMAIL` | The `from` address, e.g. `reports@yourdomain.com`. Its domain should be **verified** in Resend; until then use their sandbox sender. |
| `CRON_SECRET` | A long random string. The cron job must send it back in the `x-cron-secret` header. Generate one: `openssl rand -hex 32`. |

## 2. Resend

1. Create a Resend account and an API key → `RESEND_API_KEY`.
2. Add and verify your sending domain (DNS records), or start on Resend's onboarding
   sandbox domain for testing. Set `SUMMARY_FROM_EMAIL` accordingly.

## 3. Database

Apply the migration (adds the `report_deliveries` exactly-once log):

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

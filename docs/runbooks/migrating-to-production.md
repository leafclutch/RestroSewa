# Applying migrations to production

The step-by-step you run in a terminal, from the repo root
(`C:\Users\Dell\Downloads\RestroSewa`). Every command is safe to copy verbatim.

**The golden rule: DB before app.** Every migration in this repo is additive, and RPC parameters
are always appended with defaults, so the *currently deployed* build keeps working against the new
schema. That is what makes it safe to migrate first and deploy after — and it is why you must
never do it the other way round.

---

## 0. Know the two targets

| target | env file | how you reach it |
| --- | --- | --- |
| DEV | `.env.local` | the default — no flag needed |
| PRODUCTION | `.env.production` | needs **both** `--prod` and `--yes` |

Three interlocks stop you writing to production by accident:

1. `--prod` is required to even look at it.
2. `--yes` is required on top of that to write.
3. The project ref inside the env file must actually be the production one
   (`qsccnzgrhrnjggyymefr`), or the run is refused — a mislabelled env file cannot smuggle itself in.

⚠️ `npm run` **swallows flags**. `npm run migrate --prod` silently drops `--prod` and targets DEV.
Call the script directly, as below, or use `--` (`npm run migrate -- --prod`).

---

## 1. See what is pending

```bash
node scripts/migrate.mjs status --prod
```

Read-only. Expect something like:

```
target: PRODUCTION (qsccnzgrhrnjggyymefr)
migrations on disk: 94   applied: 91   pending: 3

  PENDING  20260817000000_saving_opening_amount.sql
  PENDING  20260818000000_room_stay_cancelled_enum.sql
  PENDING  20260818000100_cancel_room_stay.sql
```

Confirm the list is what you expect. `2 ledger row(s) with no matching file` at the bottom is
**normal** — two stale June rows pointing at deleted files. Harmless, deliberately left alone.

Also check DEV is ahead, i.e. everything has been proved somewhere first:

```bash
node scripts/migrate.mjs status
```

DEV should read `pending: 0`. **If DEV still has pending migrations, stop** — you are about to put
something into production that has never run anywhere.

---

## 2. Dry run (optional but free)

Omit `--yes` and the runner tells you what it *would* do, without writing:

```bash
node scripts/migrate.mjs up --prod
```

```
  would apply  20260817000000_saving_opening_amount.sql
  ...
This is PRODUCTION. Re-run with --yes to apply.
```

---

## 3. Read the migrations you are about to apply

Not optional. Two minutes here has caught real problems.

```bash
cat supabase/migrations/20260818000100_cancel_room_stay.sql
```

What to look for:

- **A `drop function` before a `create`** whenever a function's return type OR argument list
  changes. Without the drop you get a second overload and calls start failing with
  `42725 … is not unique`. If a migration drops a function, check the signature it names matches
  what production actually has (step 4).
- **`alter type … add value` must be ALONE in its file.** The runner wraps each migration in
  `begin … commit`, and Postgres refuses to *use* an enum value added in the same transaction
  (`55P04 unsafe use of new value`). If you see an enum value added and used in one file, split it.
- **Appended columns and defaulted parameters**, never reordered ones — positional readers depend
  on the order.

---

## 4. Pre-flight against production (read-only)

Confirm production actually has what the new SQL depends on. Quickest route is the Supabase SQL
editor, or psql:

```bash
psql "$SUPABASE_DB_URL" -c "\df cancel_room_stay"
```

Worth checking before a risky one:

- **Function signature**, if a migration drops by exact signature:
  ```sql
  select pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_in_room';
  ```
  A mismatch means the `drop` will silently no-op and leave you with two overloads.
- **Columns the new bodies read** exist.
- **Live rows that could be affected** — e.g. `select count(*) from room_stays where status='active'`
  before anything that changes how a stay is priced.

---

## 5. Snapshot the money (for anything touching finance)

So you can prove afterwards that nothing moved:

```sql
select r.name, f.closing_cash, f.closing_online, f.sales_total,
       f.customer_credit_outstanding, f.closing_advances_held
  from restaurants r
  cross join lateral finance_report(r.id, '2000-01-01'::timestamptz, now()) f
 order by r.name;
```

Save the output. You will diff against it in step 7.

---

## 6. Apply

```bash
node scripts/migrate.mjs up --prod --yes
```

```
  20260817000000_saving_opening_amount.sql               applied
  20260818000000_room_stay_cancelled_enum.sql            applied
  20260818000100_cancel_room_stay.sql                    applied

applied 3 migration(s)
```

How it protects you:

- **Each migration runs in its own transaction, together with its ledger row**, so "applied" and
  "recorded" can never disagree — even if the machine dies mid-run.
- **A failure stops the whole run.** Later migrations almost always depend on earlier ones, and
  continuing past a break produces a schema matching nothing.

**If one fails**, the output names the file and the Postgres error, and says
`Stopped. Nothing from this migration was kept.` Fix the SQL, commit it, and re-run — the ones that
already succeeded are recorded and will be skipped.

---

## 7. Verify

```bash
node scripts/migrate.mjs status --prod     # expect: pending: 0
```

Then, in order of how much they actually tell you:

**a. The function bodies match DEV.** The strongest check available — it proves the two databases
now hold the same code, and that no DEV drift escaped its migration file.

```sql
select proname, md5(pg_get_functiondef(oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname in ('finance_report','finance_transactions','cancel_room_stay')
 order by 1;
```

Run on both and compare the hashes.

**b. Nothing moved.** Re-run the step-5 query and diff. Every figure should be identical.

**c. The ledger still reconciles** — the check that catches a leg added to one finance function and
not the other:

```sql
select r.name,
       round(f.opening_cash   + coalesce(d.cash,0)   - f.closing_cash,   4) cash_gap,
       round(f.opening_online + coalesce(d.online,0) - f.closing_online, 4) online_gap
  from restaurants r
  cross join lateral finance_report(r.id,'2000-01-01'::timestamptz, now()) f
  left  join lateral (select sum(t.cash_delta) cash, sum(t.online_delta) online
                        from finance_transactions(r.id,'2000-01-01'::timestamptz, now()) t) d on true
 order by r.name;
```

Every gap must be `0.0000`.

**d. New tables reachable through the API.** PostgREST caches its schema; Supabase normally reloads
it automatically, but confirm rather than assume:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/<new_table>?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Expect `200`.

**e. Deploy-window safety**, when an RPC gained parameters. There must be exactly ONE overload, and
the currently deployed build's shorter call must still bind:

```sql
select proname, pronargs total, pronargdefaults defaulted, pronargs - pronargdefaults required,
       count(*) over () overloads
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname = 'check_in_room';
```

`overloads = 1` and `required` ≤ the argument count the deployed app sends.

---

## 8. Deploy the app

Only now. The database is ahead, which is the safe direction.

---

## If you need to roll back

There is no `down`. Migrations are additive by design, so the usual answer is **forward**: write a
new migration that corrects the problem.

- An **added column** is harmless to an older app build — leave it.
- A **replaced function** is the real risk. That is why step 7a captures hashes: keep the previous
  `pg_get_functiondef` output before you apply, and you can restore the old body by pasting it back
  as a new migration.
- **Never** hand-edit production and leave the ledger untouched — the next `status` will then lie
  about what is applied.

---

## Quick reference

```bash
node scripts/migrate.mjs status              # DEV, read-only
node scripts/migrate.mjs up --yes            # DEV, apply
node scripts/migrate.mjs status --prod       # PRODUCTION, read-only
node scripts/migrate.mjs up --prod           # PRODUCTION, dry run
node scripts/migrate.mjs up --prod --yes     # PRODUCTION, apply
```

The self-hosted DigitalOcean stack uses the same script over Kong instead of a direct connection:

```bash
node scripts/migrate.mjs up --env .env.hrestrosewa --http --yes
```

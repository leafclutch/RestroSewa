// READ-ONLY pre-flight against PRODUCTION, runbook step 4.
// Confirms every signature a migration DROPS matches what production actually has —
// a mismatch means the drop silently no-ops and leaves a second overload behind.
import fs from "node:fs";
import pg from "pg";

function client(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return { env, c: new pg.Client({ connectionString: env.SUPABASE_DB_URL.replace(
    /^(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/, (_m, a, pw, b) => a + encodeURIComponent(pw) + b) }) };
}

const { c } = client(".env.production");
await c.connect();
const q = async (s, p = []) => (await c.query(s, p)).rows;

let warn = 0;
const ok = (cond, msg) => { console.log((cond ? "  OK    " : "  ⚠     ") + msg); if (!cond) warn++; };

console.log("=== functions the migrations DROP by signature ===");
for (const fn of ["record_credit_payment", "finance_report", "finance_transactions", "stock_report"]) {
  const rows = await q(
    `select pg_get_function_identity_arguments(p.oid) args, md5(pg_get_functiondef(p.oid)) h
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname=$1 order by 1`, [fn]);
  console.log(`\n${fn}: ${rows.length} overload(s)`);
  for (const r of rows) console.log(`    (${r.args})  ${r.h}`);
}

console.log("\n=== do the DROP targets exist exactly? ===");
const sigExists = async (fn, args) => (await q(
  `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=$1
      and pg_get_function_identity_arguments(p.oid)=$2`, [fn, args])).length > 0;

ok(await sigExists("record_credit_payment", "p_restaurant_id uuid, p_customer_id uuid, p_amount numeric, p_method text, p_notes text, p_received_by uuid, p_cash numeric, p_online numeric"),
   "record_credit_payment 8-arg exists (the one the deployed app calls) — will be dropped and replaced");
ok(await sigExists("finance_report", "p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone"),
   "finance_report 3-arg exists");
ok(await sigExists("stock_report", "p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone"),
   "stock_report 3-arg exists");

console.log("\n=== objects the migrations CREATE must not already exist ===");
for (const [kind, name] of [["table", "session_order_item_cancellations"], ["view", "order_item_release"]]) {
  const n = (await q(`select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
                       where ns.nspname='public' and c.relname=$1`, [name])).length;
  ok(n === 0, `${kind} ${name} does not exist yet (${n})`);
}
for (const col of ["cancelled_quantity", "served_quantity", "active_quantity"]) {
  const n = (await q(`select 1 from information_schema.columns
                       where table_name='session_order_items' and column_name=$1`, [col])).length;
  ok(n === 0, `session_order_items.${col} not present yet (${n})`);
}
ok((await q(`select 1 from information_schema.columns where table_name='saving_titles' and column_name='closed_at'`)).length === 0,
   "saving_titles.closed_at not present yet");
ok((await q(`select 1 from information_schema.columns where table_name='credit_payments' and column_name='discount_amount'`)).length === 0,
   "credit_payments.discount_amount not present yet");

console.log("\n=== data the migrations depend on / will rewrite ===");
console.log("  session_order_items rows (stored generated col = table rewrite):",
  (await q(`select count(*) n from session_order_items`))[0].n);
console.log("  already-cancelled rows (backfilled into the event table):",
  (await q(`select count(*) n from session_order_items where cancelled_at is not null`))[0].n);
ok(Number((await q(`select count(*) n from session_order_items
                     where item_status='served' and cancelled_at is not null`))[0].n) === 0,
   "no rows are BOTH served and cancelled (would violate the new unit-counts CHECK)");
console.log("  extra_expenses with category='gas' (renamed to fuel):",
  (await q(`select count(*) n from extra_expenses where category='gas'`))[0].n);
ok((await q(`select 1 from information_schema.columns where table_name='saving_titles' and column_name='opening_amount'`)).length === 1,
   "saving_titles.opening_amount exists (20260823 folds into it)");
ok((await q(`select 1 from information_schema.columns where table_name='order_tickets' and column_name='kind'`)).length === 1,
   "order_tickets.kind exists (void tickets use it)");

console.log("\n=== duplicate open pot names? (new partial unique index) ===");
const dupes = await q(
  `select restaurant_id, lower(btrim(name)) n, count(*) c from saving_titles
    group by 1,2 having count(*) > 1`);
ok(dupes.length === 0, `no duplicate pot names that would break the rebuilt index (${dupes.length})`);

console.log(`\n${warn === 0 ? "PRE-FLIGHT CLEAN" : `PRE-FLIGHT: ${warn} warning(s)`}`);
await c.end();

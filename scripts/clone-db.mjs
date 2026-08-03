#!/usr/bin/env node
/**
 * Whole-database copier: hosted Supabase → another Postgres.
 *
 * WHY NOT pg_dump: the source is PostgreSQL 17.6 and the destination is a
 * self-hosted Supabase container on an older major, so the destination's own
 * pg_dump cannot read the source, and there is no client install on the machine
 * driving the move. This talks the wire protocol through `pg` instead, so the
 * server versions on either end stop mattering. At ~6,500 rows that costs
 * nothing.
 *
 * It copies DATA ONLY. The schema must already be in place — build it with
 * `migrate.mjs up`, so the destination's migration ledger stays truthful rather
 * than inheriting a dump's idea of history.
 *
 *   node scripts/clone-db.mjs --env .env.production001 --http --yes
 *   node scripts/clone-db.mjs --env … --dry-run          plan + row counts, no writes
 *   node scripts/clone-db.mjs --env … --reset --yes      empty it first, then copy
 *
 * Design decisions that matter:
 *
 *   1. EVERY PRIMARY KEY IS PRESERVED. `restaurant_users.auth_user_id` points into
 *      auth.users, `restaurants.id` is baked into QR codes, and the app derives
 *      staff logins from `emp-<restaurant_user_id>@restrosewa.internal`. Renumber
 *      anything and printed QR codes and every staff login break at once.
 *
 *   2. EVERY CHUNK RUNS WITH `session_replication_role = replica`, which
 *      suppresses triggers AND foreign-key checks. Both matter: the bill-number
 *      and workstation-cascade triggers would otherwise REWRITE the rows being
 *      copied, turning a faithful copy into a subtly different database.
 *      Requires superuser, which we have on the destination and did not on
 *      hosted Supabase.
 *
 *   3. Tables are still ordered by a topological sort of the foreign-key graph,
 *      even though replica mode makes order unnecessary. It costs nothing, it
 *      makes a partial failure legible, and it means the script still behaves if
 *      it is ever pointed at a database where replica mode is unavailable.
 *
 *   4. Columns are INTERSECTED between source and destination, and any difference
 *      is REPORTED rather than silently skipped. Between two Supabase versions the
 *      internal `auth` tables genuinely differ, and that is fine — but a missing
 *      column in `public` means the schema migration did not do its job, and you
 *      want to hear about that before the data lands on top of it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HttpClient, dollarQuote } from "./lib/pg-http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD_REF = "qsccnzgrhrnjggyymefr";

// A `date` is a CALENDAR DAY, not an instant, but node-postgres parses OID 1082
// into a JS Date at LOCAL midnight. Serialising that with toISOString() then
// shifts it by the machine's UTC offset — and this machine is UTC+05:45, so
// every date would land a day early. Keep dates as the strings Postgres sent.
//
// Only `date` needs this. `timestamptz` is a genuine instant, so the round trip
// through ISO-8601 is exact, and there are no `timestamp without time zone`
// columns in this schema to worry about.
pg.types.setTypeParser(1082, (v) => v);

// One HTTP request per chunk; each is its own transaction. Big enough that the
// 7k-row copy is a few dozen requests, small enough that no single payload is
// unreasonable.
const CHUNK = 500;

// auth tables worth moving. Everything else in that schema is either live session
// state bound to the OLD project's JWT secret (sessions, refresh_tokens,
// mfa_amr_claims) or GoTrue's own bookkeeping (schema_migrations) — copying any of
// it would import garbage that the destination's GoTrue must then reconcile.
// Users re-authenticate once; their PASSWORDS survive because the bcrypt hash
// lives on auth.users and is portable between servers.
const AUTH_TABLES = ["users", "identities"];

const args = process.argv.slice(2);
const noSsl = args.includes("--no-ssl");
const useHttp = args.includes("--http");
const confirmed = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const reset = args.includes("--reset");
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  if (!args[i + 1]) throw new Error(`${name} needs a value`);
  return args[i + 1];
};
const targetEnv = flag("--env", null);
const sourceEnv = flag("--from", ".env.production");
if (!targetEnv) throw new Error("--env <file> is required (the DESTINATION env file)");

// ── connection ────────────────────────────────────────────────────────────────
function connect(envFile, { ssl, http = false }) {
  const file = path.join(ROOT, envFile);
  if (!fs.existsSync(file)) throw new Error(`${envFile} not found`);
  const env = fs.readFileSync(file, "utf8");
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  const ref = url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";

  if (http) {
    const key = get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) throw new Error(`SUPABASE_SERVICE_ROLE_KEY missing from ${envFile}`);
    return { client: new HttpClient({ url, key }), ref };
  }

  const raw = get("SUPABASE_DB_URL");
  if (!raw) throw new Error(`SUPABASE_DB_URL missing from ${envFile}`);
  // Parsed by regex, not by URL(): the password may contain characters (`#`, `@`)
  // that a URL parser either rejects or truncates at.
  const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`SUPABASE_DB_URL in ${envFile} is not a parseable connection string`);
  return {
    client: new pg.Client({
      user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
      ssl: ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 20000,
    }),
    ref,
  };
}

// ── introspection ─────────────────────────────────────────────────────────────
/** Column names in `schema.table`, excluding ones the server computes itself. */
async function columns(c, schema, table) {
  const { rows } = await c.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = $1 and table_name = $2
        -- A GENERATED column is derived from its own row; writing to one is an
        -- error, and its value reappears on insert anyway.
        and is_generated <> 'ALWAYS'
        and (is_identity <> 'YES' or identity_generation <> 'ALWAYS')
      order by ordinal_position`,
    [schema, table]
  );
  return rows;
}

/** Base tables in `schema` — deliberately NOT views. */
async function baseTables(c, schema) {
  const { rows } = await c.query(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE' order by table_name`,
    [schema]
  );
  return rows.map((r) => r.table_name);
}

/**
 * Parents-before-children ordering from the real foreign-key graph.
 *
 * Derived rather than written down: the one place the order WAS written down
 * (`delete_restaurant_cascade`, in reverse) is already known to be wrong for
 * `restaurant_user_rooms` / `restaurant_user_room_types`, which sit with their
 * sibling join tables but actually depend on `rooms` / `room_types`. Asking the
 * database removes the chance of remembering it wrong again.
 */
async function topoSort(c, tables) {
  const { rows } = await c.query(
    `select ch.relname as child, pa.relname as parent
       from pg_constraint k
       join pg_class ch on ch.oid = k.conrelid
       join pg_class pa on pa.oid = k.confrelid
       join pg_namespace n on n.oid = ch.relnamespace
       join pg_namespace pn on pn.oid = pa.relnamespace
      where k.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public'`
  );
  const set = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of rows) {
    // A self-reference (sessions→sessions, categories→categories) is satisfied
    // within one table's own insert; treating it as a dependency invents a cycle.
    if (child === parent || !set.has(child) || !set.has(parent)) continue;
    deps.get(child).add(parent);
  }
  const out = [];
  const done = new Set();
  while (out.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...deps.get(t)].every((p) => done.has(p)));
    if (!ready.length) {
      // A genuine FK cycle. Replica mode makes this harmless, so append the rest
      // rather than refusing to run — but say so, because it is worth knowing.
      const left = tables.filter((t) => !done.has(t));
      console.log(`  note: FK cycle among ${left.join(", ")} — appending in name order`);
      out.push(...left);
      break;
    }
    for (const t of ready) { out.push(t); done.add(t); }
  }
  return out;
}

// ── copying ───────────────────────────────────────────────────────────────────
/**
 * Build the INSERT for one chunk of rows.
 *
 * The rows travel as a single JSON document that POSTGRES parses and coerces,
 * via `jsonb_populate_recordset(null::the_table, …)`. Nothing is escaped by hand
 * and no per-type rendering happens on this side, which removes the entire class
 * of bug where one row containing a quote, a backslash or an emoji silently
 * corrupts the statement around it. It also sidesteps node-postgres rendering a
 * JS array as `{a,b}` — right for `text[]`, rejected by `jsonb` — because the
 * types are resolved from the table's own row type instead of guessed.
 *
 * The column list is explicit rather than `select *` because seven columns in
 * this schema are GENERATED ALWAYS (credits.balance, vendors.vendor_code,
 * purchase_items.line_total, …). Postgres computes those itself and refuses an
 * insert that names them.
 */
function insertChunk(schema, table, cols, rows) {
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  const rel = `"${schema}"."${table}"`;
  return (
    `begin;\n` +
    // Suppresses triggers AND foreign-key checks for this transaction only.
    // Without it the bill-number and workstation-cascade triggers rewrite the
    // rows as they land, and a faithful copy stops being faithful.
    `set local session_replication_role = replica;\n` +
    `insert into ${rel} (${quoted})\n` +
    `select ${quoted} from jsonb_populate_recordset(null::${rel}, ` +
    `${dollarQuote(JSON.stringify(rows))}::jsonb);\n` +
    `commit;`
  );
}

async function copyTable(src, dst, schema, table, report) {
  const [sCols, dCols] = await Promise.all([columns(src, schema, table), columns(dst, schema, table)]);
  const dByName = new Map(dCols.map((c) => [c.column_name, c.data_type]));
  const shared = sCols.filter((c) => dByName.has(c.column_name)).map((c) => c.column_name);

  const onlySource = sCols.filter((c) => !dByName.has(c.column_name)).map((c) => c.column_name);
  const onlyDest = dCols.filter((c) => !sCols.some((s) => s.column_name === c.column_name)).map((c) => c.column_name);
  if (onlySource.length) report.push(`${schema}.${table}: source-only columns NOT copied → ${onlySource.join(", ")}`);
  if (onlyDest.length) report.push(`${schema}.${table}: destination-only columns left at default → ${onlyDest.join(", ")}`);
  if (!shared.length) { console.log(`  ${table.padEnd(34)} SKIPPED (no columns in common)`); return 0; }

  const quoted = shared.map((c) => `"${c}"`).join(", ");
  const { rows } = await src.query(`select ${quoted} from "${schema}"."${table}"`);
  if (!rows.length) { console.log(`  ${schema}.${table}`.padEnd(44) + "0"); return 0; }
  if (dryRun) { console.log(`  ${schema}.${table}`.padEnd(44) + `${rows.length} (dry run)`); return rows.length; }

  for (let i = 0; i < rows.length; i += CHUNK) {
    await dst.query(insertChunk(schema, table, shared, rows.slice(i, i + CHUNK)));
  }
  console.log(`  ${schema}.${table}`.padEnd(44) + rows.length);
  return rows.length;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // The source is read-only, and it is production — it always speaks TLS.
  // --no-ssl describes the DESTINATION container only.
  const { client: src, ref: srcRef } = connect(sourceEnv, { ssl: true });
  const { client: dst, ref: dstRef } = connect(targetEnv, { ssl: !noSsl, http: useHttp });

  if (dstRef === PROD_REF) throw new Error(`${targetEnv} points at PRODUCTION — refusing to write there`);
  if (srcRef === dstRef) throw new Error(`source and destination are the same database (${srcRef})`);

  console.log(`source:      ${sourceEnv} (${srcRef})   READ ONLY`);
  console.log(`destination: ${targetEnv} (${dstRef})\n`);

  await src.connect();
  await dst.connect();

  const dstVersion = (await dst.query("select version()")).rows[0].version;
  const srcVersion = (await src.query("select version()")).rows[0].version;
  console.log(`  source pg:      ${srcVersion.split(" ").slice(0, 2).join(" ")}`);
  console.log(`  destination pg: ${dstVersion.split(" ").slice(0, 2).join(" ")}\n`);

  const tables = await baseTables(dst, "public");
  const ordered = await topoSort(dst, tables);

  // Refuse to run twice. Every table here has a primary key, so a second run
  // would mostly fail on conflicts — but "mostly" is not a safety property, and a
  // half-duplicated database is far worse than one that refused to start.
  const all = [...AUTH_TABLES.map((t) => ["auth", t]), ...ordered.map((t) => ["public", t])];

  // `--reset` empties the destination so a failed run can simply be retried.
  // Guarded by the same production interlock as everything else, and it only
  // ever touches a database this script was already willing to write to.
  if (reset && !dryRun) {
    if (!confirmed) throw new Error("--reset also needs --yes");
    console.log("resetting destination…");
    // One statement: TRUNCATE takes ACCESS EXCLUSIVE on every table it names, so
    // doing them together avoids deadlocking against itself, and CASCADE settles
    // the foreign keys without needing an order.
    await dst.query(
      `truncate ${all.map(([s, t]) => `"${s}"."${t}"`).join(", ")} cascade;`
    );
    console.log(`  emptied ${all.length} table(s)\n`);
  }

  const occupied = [];
  for (const [s, t] of all) {
    const { rows } = await dst.query(`select 1 from "${s}"."${t}" limit 1`);
    if (rows.length) occupied.push(`${s}.${t}`);
  }
  if (occupied.length && !dryRun) {
    throw new Error(
      `destination is not empty — ${occupied.length} table(s) already hold rows ` +
        `(${occupied.slice(0, 5).join(", ")}${occupied.length > 5 ? ", …" : ""}).\n` +
        `       Refusing to copy on top of existing data. Re-run with --reset --yes to empty it first.`
    );
  }

  if (!dryRun && !confirmed) {
    console.log(`would copy auth.{${AUTH_TABLES.join(", ")}} + ${ordered.length} public tables.`);
    console.log("Re-run with --yes to write.");
    await src.end(); await dst.end(); return;
  }

  const report = [];
  let total = 0;

  // ATOMICITY IS PER CHUNK, NOT PER RUN — see insertChunk(). Under --http a
  // transaction cannot span requests, because each request is its own
  // connection, so a whole-copy rollback is not available to buy. What replaces
  // it: the destination must start empty, `--reset --yes` puts it back to empty,
  // and verify-parity.mjs re-derives the result afterwards. A half-finished copy
  // is therefore obvious and one command to undo, rather than silent.
  try {
    console.log("auth schema:");
    for (const t of AUTH_TABLES) total += await copyTable(src, dst, "auth", t, report);

    console.log("\npublic schema (foreign-key order):");
    for (const t of ordered) total += await copyTable(src, dst, "public", t, report);

    if (!dryRun) {
      // Assert the thing the whole move is for.
      const { rows } = await dst.query(
        `select u.email from super_admins s join auth.users u on u.id = s.auth_user_id`
      );
      if (!rows.length) throw new Error("no super_admins row landed");
      console.log(`\nsuperadmin(s): ${rows.map((r) => r.email).join(", ")}`);
    }
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    console.error("The destination is PARTIALLY COPIED. Re-run with --reset --yes to start clean.");
    await src.end(); await dst.end();
    process.exit(1);
  }

  console.log(`\n${dryRun ? "would copy" : "copied"} ${total} rows`);
  if (report.length) {
    console.log("\ncolumn differences (review these):");
    for (const line of report) console.log(`  ${line}`);
  }

  await src.end();
  await dst.end();
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

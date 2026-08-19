#!/usr/bin/env node
/**
 * Compares a migrated database against production and reports every difference.
 *
 * WHY: "the migrations ran without error" is not the same claim as "this database
 * matches production", and the gap between them is where a migration to a new
 * server goes wrong quietly. This asks both databases the same questions and
 * diffs the answers.
 *
 *   node scripts/verify-parity.mjs --env .env.hrestrosewa --http
 *
 * Structure checks always run. Data checks (row counts, then derived financial
 * values) run once the destination has rows — a derived-value check is the only
 * one of these that can catch a MANGLED RELATIONSHIP: row counts agree perfectly
 * on a database whose foreign keys all point at the wrong parents.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HttpClient } from "./lib/pg-http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A `date` is a calendar day. node-postgres turns OID 1082 into a JS Date at
// LOCAL midnight, which then serialises to the WRONG DAY from a non-UTC machine.
// Keep it as the string Postgres sent, which is also what the HTTP side returns.
pg.types.setTypeParser(1082, (v) => v);

/**
 * Put a result set into a form that can be compared across two different
 * drivers and two different servers. Without this, three things masquerade as
 * data corruption:
 *
 *   • TIMESTAMP FORMATTING. node-postgres parses timestamptz into a JS Date
 *     ("2026-07-23T11:43:37.343Z"); postgres-meta returns the server's text
 *     ("2026-07-23 11:43:37.343+00"). Same instant, different spelling.
 *   • ROW ORDER. Several of these functions have no ORDER BY, so their row order
 *     is not defined and the two servers are free to disagree.
 *   • KEY ORDER inside jsonb, which Postgres normalises and does not preserve.
 *
 * Normalising all three is what makes a remaining difference mean something.
 */
function canon(rows) {
  const value = (v) => {
    if (v instanceof Date) return v.toISOString();
    // Only strings carrying a TIME are timestamps; a bare "2026-07-01" is a date
    // and must be left exactly as it is.
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(v)) {
      const d = new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (v && typeof v === "object") return sortKeys(v);
    return v;
  };
  const sortKeys = (o) => {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (o && typeof o === "object" && !(o instanceof Date)) {
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, value(o[k])]));
    }
    return o;
  };
  return rows
    .map((r) => JSON.stringify(sortKeys(r)))
    .sort()
    .join("\n");
}

const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const noSsl = args.includes("--no-ssl");
const flag = (n, d) => { const i = args.indexOf(n); if (i === -1) return d; if (!args[i + 1]) throw new Error(`${n} needs a value`); return args[i + 1]; };
const targetEnv = flag("--env", null);
const sourceEnv = flag("--from", ".env.production");
if (!targetEnv) throw new Error("--env <file> is required");

function open(envFile, { http = false, ssl = true } = {}) {
  const e = fs.readFileSync(path.join(ROOT, envFile), "utf8");
  const g = (k) => e.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  if (http) return new HttpClient({ url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("SUPABASE_SERVICE_ROLE_KEY") });
  const m = g("SUPABASE_DB_URL").match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`SUPABASE_DB_URL in ${envFile} is not parseable`);
  return new pg.Client({ user: m[1], password: m[2], host: m[3], port: +m[4], database: m[5],
    ssl: ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 20000 });
}

let failures = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label.padEnd(46)} ${detail}`);
const bad = (label, detail = "") => { failures++; console.log(`  FAIL  ${label.padEnd(46)} ${detail}`); };

/**
 * Runs `sql` on both sides and diffs the rows as sorted key strings.
 *
 * `allowMissing` waives keys the SOURCE has and the destination deliberately
 * does not. It is never applied to `extra`: something the destination has and
 * production does not is always a finding, whatever it is.
 */
async function diff(label, sql, src, dst, key, allowMissing = null) {
  const a = await src.query(sql); const b = await dst.query(sql);
  const norm = (rows) => new Set(rows.map(key));
  const A = norm(a.rows), B = norm(b.rows);
  let missing = [...A].filter((x) => !B.has(x));
  const extra = [...B].filter((x) => !A.has(x));
  const waived = allowMissing ? missing.filter(allowMissing).length : 0;
  if (waived) missing = missing.filter((x) => !allowMissing(x));
  if (!missing.length && !extra.length)
    return ok(label, `${A.size - waived} matched` + (waived ? `, ${waived} waived` : ""));
  bad(label, `${missing.length} missing, ${extra.length} unexpected`);
  for (const x of missing.slice(0, 12)) console.log(`          missing from destination: ${x}`);
  for (const x of extra.slice(0, 12)) console.log(`          only in destination:       ${x}`);
}

const Q = {
  columns: `select table_name||'.'||column_name as k, udt_name, is_nullable
              from information_schema.columns where table_schema='public'`,
  tables: `select table_name as k, table_type from information_schema.tables where table_schema='public'`,
  enums: `select t.typname||'='||e.enumlabel as k from pg_type t
            join pg_enum e on e.enumtypid=t.oid
            join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'`,
  routines: `select p.proname as k from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public'`,
  constraints: `select conname as k, contype from pg_constraint c
                  join pg_namespace n on n.oid=c.connamespace where n.nspname='public'`,
  indexes: `select indexname as k from pg_indexes where schemaname='public'`,
  triggers: `select tgname||' on '||c.relname as k from pg_trigger t
               join pg_class c on c.oid=t.tgrelid
               join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and not t.tgisinternal`,
  grants: `select grantee||' '||privilege_type||' '||table_name as k
             from information_schema.role_table_grants
            where table_schema='public' and grantee in ('service_role','anon','authenticated')`,
};

/**
 * The ONLY grant difference that is not a defect.
 *
 * Hosted Supabase ships `alter default privileges … grant ALL … to service_role`,
 * so on the hosted projects service_role also holds TRUNCATE, REFERENCES and
 * TRIGGER on every relation. `20260801000000_service_role_grants.sql` grants
 * select/insert/update/delete and nothing else, on purpose — so a database built
 * from the migrations is deliberately TIGHTER than the one built by the platform.
 * Nothing needs the other three: there is no SQL `TRUNCATE` anywhere in the app or
 * the migrations, and PostgREST never issues one. REFERENCES and TRIGGER are DDL
 * privileges, and all DDL runs as the owner.
 *
 * Deliberately narrow — service_role only, those three privileges only. A missing
 * SELECT, or ANY grant at all to `anon`/`authenticated`, still fails.
 */
const LEGACY_SERVICE_ROLE_GRANT = (k) =>
  /^service_role (TRUNCATE|REFERENCES|TRIGGER) /.test(k);

async function main() {
  const src = open(sourceEnv);
  const dst = open(targetEnv, { http: useHttp, ssl: !noSsl });
  if (src.connect) await src.connect();
  await dst.connect();

  const v = async (c) => (await c.query("select current_setting('server_version') as v")).rows[0].v;
  console.log(`source:      ${sourceEnv}  PostgreSQL ${await v(src)}`);
  console.log(`destination: ${targetEnv}  PostgreSQL ${await v(dst)}\n`);

  console.log("STRUCTURE");
  await diff("tables & views", Q.tables, src, dst, (r) => `${r.k} (${r.table_type})`);
  await diff("columns (name, type, nullability)", Q.columns, src, dst, (r) => `${r.k} ${r.udt_name} null=${r.is_nullable}`);
  await diff("enum types & labels", Q.enums, src, dst, (r) => r.k);
  await diff("functions", Q.routines, src, dst, (r) => r.k);
  await diff("constraints", Q.constraints, src, dst, (r) => `${r.k} (${r.contype})`);
  await diff("indexes", Q.indexes, src, dst, (r) => r.k);
  await diff("triggers", Q.triggers, src, dst, (r) => r.k);
  await diff("grants", Q.grants, src, dst, (r) => r.k, LEGACY_SERVICE_ROLE_GRANT);

  // ── data ────────────────────────────────────────────────────────────────────
  const tablesRes = await dst.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE' order by table_name`);
  const tables = tablesRes.rows.map((r) => r.table_name);

  const countSql = (list) =>
    list.map((t) => `select '${t}' as t, count(*)::int as n from "${t}"`).join(" union all ");

  console.log("\nROW COUNTS");
  const sc = await src.query(countSql(tables)); const dc = await dst.query(countSql(tables));
  const sMap = new Map(sc.rows.map((r) => [r.t, Number(r.n)]));
  const dMap = new Map(dc.rows.map((r) => [r.t, Number(r.n)]));
  const totalDst = [...dMap.values()].reduce((a, b) => a + b, 0);

  if (totalDst === 0) {
    console.log("  destination has no rows yet — skipping row and derived checks");
  } else {
    let mismatched = 0, totalSrc = 0;
    for (const t of tables) {
      const s = sMap.get(t) ?? 0, d = dMap.get(t) ?? 0;
      totalSrc += s;
      if (s !== d) { mismatched++; console.log(`  FAIL  ${t.padEnd(38)} source ${s}, destination ${d}`); }
    }
    if (mismatched) { failures++; console.log(`  ${mismatched} table(s) differ`); }
    else ok("all tables", `${totalSrc} rows matched across ${tables.length} tables`);

    // auth is not in the public schema but is the reason logins work at all.
    for (const t of ["users", "identities"]) {
      const q = `select count(*)::int as n from auth.${t}`;
      const a = await src.query(q); const b = await dst.query(q);
      const s = Number(a.rows[0].n), d = Number(b.rows[0].n);
      s === d ? ok(`auth.${t}`, `${s} rows`) : bad(`auth.${t}`, `source ${s}, destination ${d}`);
    }

    // ── derived values ────────────────────────────────────────────────────────
    // The check that actually proves the relationships survived.
    console.log("\nDERIVED VALUES (recomputed independently on each side)");
    const { rows: rs } = await src.query(`select id, name from restaurants order by name`);
    // All four take the same (restaurant, from, to) shape. The window is wide
    // enough to cover every row that exists, so this compares the WHOLE dataset
    // rather than a recent slice of it.
    const win = `'2000-01-01'::timestamptz, '2100-01-01'::timestamptz`;
    for (const r of rs) {
      for (const [label, fn] of [
        ["dashboard_stats", "dashboard_stats"],
        ["finance_report", "finance_report"],
        ["finance_transactions", "finance_transactions"],
        ["stock_report", "stock_report"],
      ]) {
        const sql = `select * from ${fn}('${r.id}'::uuid, ${win})`;
        try {
          // Sequential, not Promise.all: a single pg.Client cannot have two
          // queries in flight, and node-postgres warns and serialises anyway.
          const a = await src.query(sql);
          const b = await dst.query(sql);
          const A = canon(a.rows), B = canon(b.rows);
          A === B ? ok(`${label} — ${r.name}`) : bad(`${label} — ${r.name}`, "OUTPUT DIFFERS");
          if (A !== B) {
            console.log(`          source:      ${A.slice(0, 200)}`);
            console.log(`          destination: ${B.slice(0, 200)}`);
          }
        } catch (e) {
          bad(`${label} — ${r.name}`, e.message.slice(0, 120));
        }
      }
    }

    const { rows: sa } = await dst.query(
      `select u.email from super_admins s join auth.users u on u.id = s.auth_user_id`);
    sa.length ? ok("superadmin present", sa.map((x) => x.email).join(", ")) : bad("superadmin present", "none");
  }

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  if (src.end) await src.end();
  await dst.end();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

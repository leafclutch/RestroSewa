#!/usr/bin/env node
/**
 * Deep structural audit: Supabase Cloud (source of truth) vs the rebuilt hrestrosewa.
 *
 * WHY: scripts/verify-parity.mjs compares NAMES, not DEFINITIONS —
 *   functions   -> proname only
 *   constraints -> conname + contype
 *   indexes     -> indexname
 *   triggers    -> tgname
 * and it never looks at RLS POLICIES, column DEFAULTS, column ORDER, generated
 * expressions, view bodies or sequence parameters. A database can pass it while a
 * foreign key points somewhere else entirely or a function body differs.
 *
 * This compares the actual definitions via pg_get_*def(). Source is PG 17.6 and
 * destination is 15.8, so a handful of differences are the SERVER rendering the
 * same object differently; those are normalised below and anything left over is
 * reported verbatim for a human to judge.
 */
import pg from "pg";
import fs from "node:fs";

pg.types.setTypeParser(1082, (v) => v); // dates as text; see clone-db.mjs

const env = (f) => {
  const t = fs.readFileSync(f, "utf8");
  return (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
};
const prod = env("C:/Users/Dell/Downloads/RestroSewa/.env.production");
const m = prod("SUPABASE_DB_URL").match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);

const SRC = new pg.Client({
  user: m[1], password: m[2], host: m[3], port: +m[4], database: m[5],
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000,
});
const DST = new pg.Client({
  user: "postgres", password: "vAEshe6Xe5OvHN4kCOmOBYKzAt7603zU",
  host: "127.0.0.1", port: 15432, database: "hrestrosewa", ssl: false,
  connectionTimeoutMillis: 30000,
});

/** Differences that are the SERVER VERSION talking, not the schema. */
const normalise = (s) =>
  String(s)
    .replace(/\s+/g, " ")
    .trim()
    // PG16+ renders these with the extra keyword; PG15 omits it.
    .replace(/ NULLS NOT DISTINCT/g, "")
    // PG16+ qualifies collations that PG15 leaves bare.
    .replace(/ COLLATE pg_catalog\."default"/g, "")
    .replace(/::character varying/g, "::varchar")
    .replace(/pg_catalog\./g, "");

const Q = {
  "columns (type, default, nullable, order, generated)": `
    select c.relname||'.'||a.attname as k,
           a.attnum::text||' | '||format_type(a.atttypid, a.atttypmod)
             ||' | null='||(not a.attnotnull)::text
             ||' | default='||coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
             ||' | generated='||coalesce(nullif(a.attgenerated::text,''),'-')
             ||' | identity='||coalesce(nullif(a.attidentity::text,''),'-') as def
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname='public' and c.relkind in ('r','v','m','p')
       and a.attnum > 0 and not a.attisdropped`,

  "constraint DEFINITIONS (fk targets, check bodies, on-delete)": `
    select c.relname||'.'||k.conname as k, pg_get_constraintdef(k.oid) as def
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public'`,

  "index DEFINITIONS (columns, uniqueness, partial WHERE)": `
    select indexname as k, indexdef as def from pg_indexes where schemaname='public'`,

  "trigger DEFINITIONS (timing, events, function, WHEN)": `
    select c.relname||'.'||t.tgname as k, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and not t.tgisinternal`,

  "function SIGNATURES + BODIES + volatility + security": `
    select p.oid::regprocedure::text as k,
           md5(p.prosrc)||' | ret='||pg_get_function_result(p.oid)
             ||' | vol='||p.provolatile::text||' | secdef='||p.prosecdef::text
             ||' | strict='||p.proisstrict::text as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public'`,

  "view DEFINITIONS": `
    select table_name as k, md5(regexp_replace(view_definition, '\\s+', ' ', 'g')) as def
      from information_schema.views where table_schema='public'`,

  "RLS enabled / forced": `
    select c.relname as k,
           'rls='||c.relrowsecurity::text||' forced='||c.relforcerowsecurity::text as def
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'`,

  "RLS POLICIES (roles, USING, WITH CHECK)": `
    select c.relname||'.'||pol.polname as k,
           'cmd='||pol.polcmd::text||' permissive='||pol.polpermissive::text
             ||' roles='||coalesce((select string_agg(pg_get_userbyid(r), ',' order by pg_get_userbyid(r))
                                      from unnest(pol.polroles) r), '-')
             ||' using='||coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-')
             ||' check='||coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-') as def
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public'`,

  "enum labels (ordered)": `
    select t.typname as k, string_agg(e.enumlabel, ',' order by e.enumsortorder) as def
      from pg_type t join pg_enum e on e.enumtypid=t.oid
      join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='public' group by t.typname`,

  "sequences (type, increment, bounds, cycle)": `
    select c.relname as k,
           s.seqtypid::regtype::text||' inc='||s.seqincrement||' min='||s.seqmin
             ||' max='||s.seqmax||' cycle='||s.seqcycle::text as def
      from pg_sequence s
      join pg_class c on c.oid = s.seqrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public'`,

  "relations (kind)": `
    select c.relname as k, c.relkind::text as def
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','v','m','p','S')`,
};

const report = [];
let hardFail = 0;

async function compare(label, sql) {
  const [a, b] = await Promise.all([SRC.query(sql), DST.query(sql)]);
  const A = new Map(a.rows.map((r) => [r.k, normalise(r.def)]));
  const B = new Map(b.rows.map((r) => [r.k, normalise(r.def)]));

  const missing = [...A.keys()].filter((k) => !B.has(k));
  const extra = [...B.keys()].filter((k) => !A.has(k));
  const differing = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k));

  const bad = missing.length + extra.length + differing.length;
  if (bad) hardFail++;
  report.push({ label, cloud: A.size, dest: B.size, missing, extra, differing, A, B });

  const status = bad ? "DIFF" : "OK  ";
  console.log(
    `  ${status}  ${label.padEnd(56)} cloud=${String(A.size).padStart(4)} new=${String(B.size).padStart(4)}` +
      (bad ? `   missing=${missing.length} extra=${extra.length} differing=${differing.length}` : "")
  );
}

const main = async () => {
  await Promise.all([SRC.connect(), DST.connect()]);
  const v = async (c) => (await c.query("select current_setting('server_version') v")).rows[0].v;
  console.log(`source (Supabase Cloud): PostgreSQL ${await v(SRC)}`);
  console.log(`destination (hrestrosewa): PostgreSQL ${await v(DST)}\n`);
  console.log("DEEP STRUCTURAL COMPARISON — definitions, not just names\n");

  for (const [label, sql] of Object.entries(Q)) await compare(label, sql);

  console.log("\n" + "=".repeat(78));
  for (const r of report) {
    if (!r.missing.length && !r.extra.length && !r.differing.length) continue;
    console.log(`\n### ${r.label}`);
    for (const k of r.missing.slice(0, 15)) console.log(`  MISSING in new : ${k}`);
    for (const k of r.extra.slice(0, 15)) console.log(`  EXTRA in new   : ${k}`);
    for (const k of r.differing.slice(0, 15)) {
      console.log(`  DIFFERS        : ${k}`);
      console.log(`      cloud: ${r.A.get(k).slice(0, 300)}`);
      console.log(`      new  : ${r.B.get(k).slice(0, 300)}`);
    }
  }
  console.log("\n" + "=".repeat(78));
  console.log(hardFail ? `\n${hardFail} categor(ies) with differences — see above.` : "\nSTRUCTURE IS AN EXACT MATCH across every category.");
  await Promise.all([SRC.end(), DST.end()]);
  process.exit(hardFail ? 1 : 0);
};
main().catch((e) => { console.error("ERR:", e.message); process.exit(2); });

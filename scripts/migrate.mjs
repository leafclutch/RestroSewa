#!/usr/bin/env node
/**
 * Migration runner.
 *
 * WHY THIS EXISTS: migrations used to be applied by hand, and the only record of
 * what had run where was somebody's memory. Production's Supabase ledger held two
 * rows from June pointing at files that no longer exist, while all 56 real
 * migrations were unrecorded — so `supabase db push` would have tried to replay
 * everything from scratch.
 *
 * It writes to `supabase_migrations.schema_migrations`, the SAME table the
 * Supabase CLI uses, rather than inventing a private one. That way the ledger
 * stays truthful for both this runner and the CLI.
 *
 *   node scripts/migrate.mjs status            what's applied where (default: dev)
 *   node scripts/migrate.mjs up                apply pending migrations to DEV
 *   node scripts/migrate.mjs up --prod         …to PRODUCTION (asks for --yes)
 *   node scripts/migrate.mjs baseline          record every file as already applied
 *   node scripts/migrate.mjs status --prod
 *
 * Safety rules, in order of importance:
 *   1. DEV is the default target. Production needs BOTH --prod and --yes.
 *   2. Each migration runs in its OWN transaction, together with the ledger
 *      insert — so "applied" and "recorded" can never disagree, even on a crash.
 *   3. A failure stops the run. Later migrations almost always depend on earlier
 *      ones, and continuing past a break produces a schema matching nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "supabase", "migrations");
const PROD_REF = "qsccnzgrhrnjggyymefr";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-")) ?? "status";
const useProd = args.includes("--prod");
const confirmed = args.includes("--yes");

// ── connection ────────────────────────────────────────────────────────────────
function connect(envFile) {
  const file = path.join(ROOT, envFile);
  if (!fs.existsSync(file)) throw new Error(`${envFile} not found`);
  const env = fs.readFileSync(file, "utf8");
  const raw = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error(`SUPABASE_DB_URL missing from ${envFile}`);
  const m = raw.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error(`SUPABASE_DB_URL in ${envFile} is not a parseable connection string`);
  const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return {
    client: new pg.Client({
      user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
    }),
    ref: url.match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown",
  };
}

const files = () =>
  fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ file: f, version: f.split("_")[0], name: f.replace(/^\d+_/, "").replace(/\.sql$/, "") }));

async function ensureLedger(c) {
  await c.query(`create schema if not exists supabase_migrations`);
  await c.query(`
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    )`);
}

const applied = async (c) =>
  new Set((await c.query(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version));

// ── commands ──────────────────────────────────────────────────────────────────
async function main() {
  const envFile = useProd ? ".env.production" : ".env.local";
  const { client: c, ref } = connect(envFile);
  const target = useProd ? "PRODUCTION" : "DEV";

  // Belt and braces: the flag says prod, the project ref must agree.
  if (useProd && ref !== PROD_REF) throw new Error(`--prod given but ${envFile} points at ${ref}`);
  if (!useProd && ref === PROD_REF) throw new Error(`.env.local points at PRODUCTION — refusing`);

  await c.connect();
  await ensureLedger(c);

  const all = files();
  const done = await applied(c);
  const pending = all.filter((m) => !done.has(m.version));

  console.log(`target: ${target} (${ref})`);
  console.log(`migrations on disk: ${all.length}   applied: ${all.length - pending.length}   pending: ${pending.length}\n`);

  if (cmd === "status") {
    for (const m of pending) console.log(`  PENDING  ${m.file}`);
    // Ledger rows with no file: stale history, worth surfacing but never deleted.
    const orphans = [...done].filter((v) => !all.some((m) => m.version === v));
    if (orphans.length) console.log(`\n  ${orphans.length} ledger row(s) with no matching file: ${orphans.join(", ")}`);
    if (!pending.length) console.log("  up to date");
  }

  else if (cmd === "baseline") {
    // Records every file as applied WITHOUT running it — for a database that
    // already has the schema but no ledger. Never use on a fresh database.
    if (!confirmed) {
      console.log("baseline records all files as applied WITHOUT running them.");
      console.log("Only correct when the schema is already in place. Re-run with --yes.");
      await c.end(); return;
    }
    for (const m of pending) {
      await c.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3) on conflict (version) do nothing`,
        [m.version, m.name, [`-- baselined ${new Date().toISOString()}: schema already present`]]
      );
      console.log(`  recorded ${m.file}`);
    }
    console.log(`\nbaselined ${pending.length} migration(s)`);
  }

  else if (cmd === "up") {
    if (!pending.length) { console.log("nothing to do"); await c.end(); return; }
    if (useProd && !confirmed) {
      for (const m of pending) console.log(`  would apply  ${m.file}`);
      console.log(`\nThis is PRODUCTION. Re-run with --yes to apply.`);
      await c.end(); return;
    }
    for (const m of pending) {
      const sql = fs.readFileSync(path.join(DIR, m.file), "utf8");
      process.stdout.write(`  ${m.file.padEnd(54)} `);
      await c.query("begin");
      try {
        await c.query(sql);
        // Ledger insert rides in the SAME transaction as the migration, so a
        // crash can never leave one without the other.
        await c.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)`,
          [m.version, m.name, [sql]]
        );
        await c.query("commit");
        console.log("applied");
      } catch (e) {
        await c.query("rollback");
        console.log("FAILED");
        console.error(`\n${m.file}:\n${e.message}\n`);
        console.error("Stopped. Nothing from this migration was kept.");
        await c.end();
        process.exit(1);
      }
    }
    console.log(`\napplied ${pending.length} migration(s)`);
  }

  else {
    console.log(`unknown command "${cmd}" — use status | up | baseline`);
  }

  await c.end();
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });

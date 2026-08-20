// Temporary: snapshot prod payroll numbers before/after the salary_cycles migration.
const fs = require("fs");
const pg = require("pg");
pg.types.setTypeParser(1082, (v) => v); // dates as text — never through a JS Date

const env = fs.readFileSync(process.argv[2] || ".env.production", "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
const m = get("SUPABASE_DB_URL").match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);

(async () => {
  const c = new pg.Client({
    user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000,
  });
  await c.connect();

  const rs = (await c.query(`select id, name from restaurants order by name`)).rows;
  for (const r of rs) {
    const s = (await c.query(
      `select * from payroll_summary($1, '2000-01-01'::timestamptz, '2100-01-01'::timestamptz)`, [r.id]
    )).rows[0];
    if (!s) { console.log(`${r.name}: no summary`); continue; }
    console.log(`${r.name}  liability=${s.outstanding_liability}  period_total=${s.period_total}  cash=${s.period_cash}  online=${s.period_online}`);
  }

  const per = (await c.query(`
    select ru.display_name, sp.salary_month::text as mon,
           sum(sp.amount) as paid, count(*)::int as n,
           sum(sp.cash_amount) as cash, sum(sp.online_amount) as online
      from salary_payments sp join restaurant_users ru on ru.id = sp.restaurant_user_id
     group by 1,2 order by 1,2`)).rows;
  console.log("--- payments by staff/month ---");
  for (const p of per) console.log(`${p.display_name} ${p.mon} paid=${p.paid} n=${p.n} cash=${p.cash} online=${p.online}`);

  const pr = (await c.query(`
    select ru.display_name, p.joining_date::text as jd, p.is_active, salary_for_month(p.restaurant_user_id, date_trunc('month', now())::date) as sal
      from staff_payroll p join restaurant_users ru on ru.id = p.restaurant_user_id
     order by 1`)).rows;
  console.log("--- staff_payroll ---");
  for (const p of pr) console.log(`${p.display_name} salary=${p.sal} joined=${p.jd} active=${p.is_active}`);

  const sal = (await c.query(`select count(*)::int n from staff_salaries`)).rows[0];
  console.log(`--- staff_salaries rows: ${sal.n}`);

  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

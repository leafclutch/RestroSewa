import fs from "node:fs";
import pg from "pg";

async function run() {
  const connectionString = "postgresql://postgres.ojqomyunjmaivsyvnvbv:Leafclutch404%23@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new pg.Client({ connectionString });
  await client.connect();
  const sql = fs.readFileSync("supabase/migrations/20260820000000_credit_payment_discount.sql", "utf8");
  await client.query(sql);
  console.log("Migration executed successfully!");
  await client.end();
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});

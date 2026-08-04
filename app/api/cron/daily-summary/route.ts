import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "node:crypto";
import { addBusinessDays, businessToday, normalizeClosingHour } from "@/lib/business-day";
import { normalizeDailySummaryConfig } from "@/lib/reports/daily-summary";
import { sendDailySummary } from "@/lib/reports/daily-summary-send";

// Real network calls (Supabase + Gmail SMTP) + PDF generation; never prerender/cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily financial-summary sender.
 *
 * Called every 15 minutes by Supabase pg_cron (see supabase/cron/daily-summary-cron.sql).
 * For every restaurant that opted in, it emails the summary for the PREVIOUS
 * business day — which, by construction, is always fully closed no matter what
 * hour the job fires (businessToday is the day in progress, so the day before it
 * has ended). Exactly-once + retry-on-failure live in `sendDailySummary`, which the
 * admin "Retry" button also calls; this route just fans it out per restaurant.
 *
 * The 15-minute tick is not arbitrary: pg_cron schedules in GMT and Nepal is
 * UTC+05:45, so every whole Nepal hour falls on UTC HH:15 and a quarter-hour
 * schedule lands exactly on each restaurant's closing instant. An hourly schedule
 * fired at :45 past every Nepal hour and made every report 45 minutes late.
 *
 * Secret-gated by `x-cron-secret` == CRON_SECRET (constant-time). Anything else
 * gets 404, so the endpoint isn't discoverable by probing. Same posture as
 * app/api/_perf/route.ts.
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request) {
  if (!authorised(req)) return notFound();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurants } = await (service as any)
    .from("restaurants")
    .select("id, settings");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (restaurants ?? []) as any[];

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    // Cheap pre-filter so a restaurant that hasn't opted in isn't even loaded by
    // the orchestrator (which re-checks anyway).
    const config = normalizeDailySummaryConfig(r.settings?.daily_summary);
    if (!config.enabled || config.emails.length === 0) continue;
    processed += 1;

    try {
      const hour = normalizeClosingHour(r.settings?.business_closing_hour);
      const day = addBusinessDays(businessToday(hour), -1); // the just-closed day
      const outcome = await sendDailySummary(r.id, day, hour, { force: false });
      // Log WHO each run addressed. Owners edit their recipient list in Settings,
      // and "it still went to the old address" is otherwise unanswerable without a
      // database session — this puts the resolved list in the deploy logs, next to
      // the outcome. (report_deliveries.recipients is the durable record; this is
      // the one that survives a row being overwritten by a later retry.)
      const to = "recipients" in outcome ? outcome.recipients.join(", ") : "—";
      console.log(`daily-summary: ${r.id} ${day} ${outcome.status} → ${to}`);
      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "skipped") skipped += 1;
      else failed += 1;
    } catch (e) {
      // One restaurant's failure must never abort the rest.
      failed += 1;
      console.error(`daily-summary: restaurant ${r.id} failed`, e);
    }
  }

  return Response.json(
    { ok: true, processed, sent, skipped, failed },
    { headers: { "Cache-Control": "no-store" } }
  );
}

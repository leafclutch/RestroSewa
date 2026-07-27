import { createServiceClient } from "@/lib/supabase/service";
import { timingSafeEqual } from "node:crypto";
import { addBusinessDays, businessToday, normalizeClosingHour } from "@/lib/business-day";
import {
  buildDailySummary,
  normalizeDailySummaryConfig,
  renderDailySummaryEmail,
} from "@/lib/reports/daily-summary";
import { sendEmail } from "@/lib/email/mailer";

// Real network calls (Supabase + Resend); must not be prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily financial-summary sender.
 *
 * Called hourly by Supabase pg_cron (see supabase/cron/daily-summary-cron.sql).
 * For every restaurant that opted in, it emails the summary for the PREVIOUS
 * business day — which, by construction, is always fully closed no matter what
 * hour the job fires (businessToday is the day in progress, so the day before it
 * has ended). Exactly-once is guaranteed by `report_deliveries`: a day already
 * marked 'sent' is skipped, so re-running the hourly job is safe.
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
    .select("id, name, settings");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (restaurants ?? []) as any[];

  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const config = normalizeDailySummaryConfig(r.settings?.daily_summary);
    if (!config.enabled || config.emails.length === 0) continue;
    processed += 1;

    try {
      const hour = normalizeClosingHour(r.settings?.business_closing_hour);
      const day = addBusinessDays(businessToday(hour), -1); // the just-closed day

      // Skip only when a SUCCESSFUL delivery already exists — a prior 'failed'
      // attempt is allowed to retry on the next hourly tick.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (service as any)
        .from("report_deliveries")
        .select("status")
        .eq("restaurant_id", r.id)
        .eq("period_type", "daily")
        .eq("period_key", day)
        .maybeSingle();
      if (existing?.status === "sent") {
        skipped += 1;
        continue;
      }

      const model = await buildDailySummary(r.id, day, hour);
      const email = renderDailySummaryEmail(model, r.name ?? "Restaurant");
      const result = await sendEmail({
        to: config.emails,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      // Upsert so a later successful retry overwrites an earlier 'failed' row —
      // one row per (restaurant, day), never a duplicate.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).from("report_deliveries").upsert(
        {
          restaurant_id: r.id,
          period_type: "daily",
          period_key: day,
          status: result.ok ? "sent" : "failed",
          recipient_count: result.ok ? config.emails.length : 0,
          error: result.ok ? null : result.error,
          sent_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,period_type,period_key" }
      );

      if (result.ok) sent += 1;
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

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildDailySummary,
  normalizeDailySummaryConfig,
  renderDailySummaryEmail,
} from "./daily-summary";
import { renderDailySummaryPdf } from "./daily-summary-pdf";
import { sendEmail } from "@/lib/email/mailer";
import type { ReportLogo } from "./pdf/report-document";

// ─── Orchestrator: build → PDF → email → log ───────────────────────────────────
// The ONE code path that produces and sends a daily report, shared by the hourly
// cron and the admin "Retry" button. It builds the model, renders the PDF, sends it
// from the HRestroSewa Gmail with the PDF attached, and records the outcome in
// report_deliveries (generated_at, sent_at, recipients, attempts, status/error).
// Exactly-once: unless `force`, a day already marked 'sent' is skipped.

export type SendOutcome =
  | { status: "sent"; recipients: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; recipients: string[] };

/** Fetch the restaurant logo and detect PNG/JPG (the only formats pdf-lib embeds).
 *  Best-effort — a missing or unsupported logo just omits it, never fails the send. */
async function fetchLogo(url: string | null): Promise<ReportLogo | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPng = ct.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
    const isJpg =
      ct.includes("jpeg") || ct.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
    if (isPng) return { bytes, type: "png" };
    if (isJpg) return { bytes, type: "jpg" };
    return null; // svg/webp/etc — skip
  } catch {
    return null;
  }
}

function pdfFilename(restaurantName: string, businessDate: string): string {
  const slug =
    restaurantName
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .toLowerCase() || "restaurant";
  return `daily-finance-${slug}-${businessDate}.pdf`;
}

export async function sendDailySummary(
  restaurantId: string,
  businessDate: string,
  closingHour: number,
  opts?: { force?: boolean }
): Promise<SendOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;

  const { data: rest } = await service
    .from("restaurants")
    .select("name, logo_url, settings")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!rest) return { status: "skipped", reason: "restaurant not found" };

  const config = normalizeDailySummaryConfig(rest.settings?.daily_summary);
  if (!config.enabled || config.emails.length === 0) {
    return { status: "skipped", reason: "disabled or no recipients" };
  }

  // One read serves both the dedup check and the attempts accumulator.
  const { data: existing } = await service
    .from("report_deliveries")
    .select("status, attempts")
    .eq("restaurant_id", restaurantId)
    .eq("period_type", "daily")
    .eq("period_key", businessDate)
    .maybeSingle();
  if (!opts?.force && existing?.status === "sent") {
    return { status: "skipped", reason: "already sent" };
  }
  const priorAttempts = Number(existing?.attempts ?? 0);

  const generatedAt = new Date().toISOString();
  const restaurantName = rest.name ?? "Restaurant";
  const model = await buildDailySummary(restaurantId, businessDate, closingHour);
  const logo = await fetchLogo(rest.logo_url ?? null);
  const pdf = await renderDailySummaryPdf(model, { restaurantName, logo });
  const email = renderDailySummaryEmail(model, restaurantName);

  const result = await sendEmail({
    to: config.emails,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [
      { filename: pdfFilename(restaurantName, businessDate), content: pdf, contentType: "application/pdf" },
    ],
  });

  // Upsert so a later successful retry overwrites an earlier 'failed' row — one row
  // per (restaurant, day), never a duplicate. attempts accumulates across runs.
  await service.from("report_deliveries").upsert(
    {
      restaurant_id: restaurantId,
      period_type: "daily",
      period_key: businessDate,
      status: result.ok ? "sent" : "failed",
      recipient_count: result.ok ? config.emails.length : 0,
      recipients: config.emails,
      error: result.ok ? null : result.error,
      generated_at: generatedAt,
      sent_at: new Date().toISOString(),
      attempts: priorAttempts + result.attempts,
    },
    { onConflict: "restaurant_id,period_type,period_key" }
  );

  if (result.ok) return { status: "sent", recipients: config.emails };
  return { status: "failed", error: result.error, recipients: config.emails };
}

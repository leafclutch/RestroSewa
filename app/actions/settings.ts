"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { normalizeBillLabel, type BillNumberLabel } from "@/lib/billing/bill-number";
import {
  addBusinessDays,
  earlyCloseWindow,
  businessDayRule,
  businessDayStart,
  normalizeEarlyCloses,
} from "@/lib/business-day";
import { defaultTicketCode, ticketCodeOf } from "@/lib/workstations/ticket-code";
import { revalidateRestaurantInfo } from "@/lib/restaurant-info";
import { revalidateWorkstations } from "@/lib/cache/tenant-cache";
import {
  normalizeDailySummaryConfig,
  MAX_SUMMARY_EMAILS,
  EMAIL_RE,
  type DailySummaryConfig,
} from "@/lib/reports/daily-summary";
import { sendDailySummary } from "@/lib/reports/daily-summary-send";
import { historyPeriodDateBounds, type HistoryPeriod } from "@/lib/history-period";
import { normalizeCurrency } from "@/lib/currency";

export type ActionResult = { error: string } | { ok: true } | null;

export type BillingSettings = {
  /** PAN / VAT registration number printed on bills. Empty when unset. */
  panNumber: string;
  /** Contact number printed on bills, under the PAN. Empty when unset.
   *  Stored on `restaurants.contact_phone` — the SAME column the superadmin surface
   *  edits, deliberately: two columns for one phone number would print whichever the
   *  bill happened to read. */
  contactPhone: string;
  /** The number the NEXT bill will use; null = custom numbering off (legacy refs). */
  billNumberNext: number | null;
  /** Minimum digits to zero-pad the printed number to (0 = no padding). */
  billNumberPad: number;
  /** Whether bills read "Bill No" or "Order No". */
  billNumberLabel: BillNumberLabel;
  /** Whether a discount PIN is configured — i.e. whether discounts are possible at all.
   *  Only ever a boolean: the PIN itself never leaves the DB (see set_discount_pin). */
  discountPinSet: boolean;
};

export type BusinessDaySettings = {
  /** The hour a business day rolls over, 0–23. 0 = midnight (the default). */
  closingHour: number;
  /** The business day we are inside now (YYYY-MM-DD). */
  today: string;
  /** When it began and when it will end, as ISO instants. */
  startedAt: string;
  endsAt: string;
  /** The day before, and the instant it was closed early (null if it wasn't). */
  previousDay: string;
  previousClosedEarlyAt: string | null;
  /** Whether that early close can still be undone. */
  canReopen: boolean;
  /** The day sales will count toward after an early close. */
  nextDay: string;
  /** Whether "Close today's business" is allowed right now, and from when it is. */
  canCloseNow: boolean;
  closableFrom: string;
};

// Reads the restaurant's billing settings for the admin form. Admin-only; the page
// guards too, but the action is the security boundary.
export async function getBillingSettings(): Promise<BillingSettings> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("pan_vat_number, contact_phone, bill_number_next, settings, discount_pin_hash")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const s = data?.settings ?? {};
  return {
    panNumber: data?.pan_vat_number ?? "",
    contactPhone: data?.contact_phone ?? "",
    billNumberNext: data?.bill_number_next ?? null,
    billNumberPad: Number.isFinite(Number(s.bill_number_pad)) ? Number(s.bill_number_pad) : 0,
    billNumberLabel: normalizeBillLabel(s.bill_number_label),
    // Collapsed to a boolean HERE, server-side — the hash must never reach the client.
    discountPinSet: !!data?.discount_pin_hash,
  };
}

// Sets, changes or removes the discount authorization PIN. Without a PIN a restaurant
// cannot apply discounts at all, so removing it is the off switch — that's deliberate:
// there is no configuration in which a discount can be applied unauthorized.
//
// The PIN goes straight into `set_discount_pin`, which hashes it (bcrypt) inside the DB.
// It is never stored, logged or returned in plaintext.
export async function updateDiscountPin(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const clearing = formData.get("clear_pin") === "1";
  const pin = ((formData.get("discount_pin") as string) || "").trim();

  if (!clearing) {
    // Matches the 4-digit staff-login PIN format, so there's one PIN shape to remember.
    if (!/^\d{4}$/.test(pin)) return { error: "The discount PIN must be exactly 4 digits." };
    const confirm = ((formData.get("discount_pin_confirm") as string) || "").trim();
    if (confirm !== pin) return { error: "The two PINs don't match." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_discount_pin", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_pin: clearing ? null : pin,
  });
  if (error) return { error: "Could not save the discount PIN. Please try again." };

  // Written by the `set_discount_pin` DB function, not by a .update() here — so this is
  // the one invalidation a grep for `.from("restaurants").update(` would have missed.
  // Setting or clearing the PIN is the on/off switch for discounts existing at all, so a
  // stale `discountEnabled` would show the cashier a field that cannot work (or hide one
  // that now can).
  revalidateRestaurantInfo(restaurantUser.restaurant_id);

  revalidatePath("/admin/settings");
  return { ok: true };
}

// Saves PAN + bill-number configuration. Scoped to the caller's own restaurant, so it can
// never touch another tenant. Changing the sequence only moves the counter for FUTURE
// bills — every past bill already carries its own stamped number, untouched.
export async function updateBillingSettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const pan = ((formData.get("pan_number") as string) || "").trim() || null;

  // The number printed under the PAN. Kept permissive on FORM (Nepali numbers are
  // written +977-71-… , 071-5xxxxx, or with a second number after a slash) but it must
  // still be a phone number rather than a line of free text, so letters are refused and
  // there has to be a plausible count of digits.
  const phoneRaw = ((formData.get("contact_phone") as string) || "").trim();
  let contactPhone: string | null = null;
  if (phoneRaw !== "") {
    if (phoneRaw.length > 40) return { error: "That phone number is too long for a bill." };
    if (!/^[0-9+\-()/ ]+$/.test(phoneRaw)) {
      return { error: "The phone number can only contain digits and + - ( ) / and spaces." };
    }
    const digits = phoneRaw.replace(/\D/g, "").length;
    if (digits < 6) return { error: "That doesn't look like a phone number." };
    contactPhone = phoneRaw;
  }

  // Blank "next number" turns custom numbering OFF (fall back to legacy refs). Otherwise it
  // must be a non-negative integer, and it becomes the number the very next bill will use.
  const rawNext = ((formData.get("bill_number_next") as string) || "").trim();
  let billNumberNext: number | null = null;
  if (rawNext !== "") {
    const n = Number(rawNext);
    if (!Number.isInteger(n) || n < 0) return { error: "Next bill number must be a whole number (0 or more)." };
    billNumberNext = n;
  }

  const rawPad = ((formData.get("bill_number_pad") as string) || "").trim();
  let pad = 0;
  if (rawPad !== "") {
    const p = Number(rawPad);
    if (!Number.isInteger(p) || p < 0 || p > 12) return { error: "Padding must be a whole number between 0 and 12." };
    pad = p;
  }

  const label = normalizeBillLabel(formData.get("bill_number_label"));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = {
    ...(rest?.settings ?? {}),
    bill_number_pad: pad,
    bill_number_label: label,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({
      pan_vat_number: pan,
      contact_phone: contactPhone,
      bill_number_next: billNumberNext,
      settings,
    })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  // PAN, bill numbering and the tax/service percentages all print on a customer receipt,
  // and the config is cached for 60s — so this must be dropped NOW, not on the next TTL.
  revalidateRestaurantInfo(restaurantUser.restaurant_id);

  // The floor reads these when printing, so refresh the surfaces that render a bill.
  revalidatePath("/admin/settings");
  revalidatePath("/employee/sales");
  return { ok: true };
}

// ─── Business day ─────────────────────────────────────────────────────────────
// The hour at which the books roll over — any hour. Before noon is a late close
// (after-midnight sales stay on the previous night); noon or later is an early
// close (sales after it already count toward tomorrow). See lib/business-day.ts.
//
// "Close today's business" ends the current business day NOW, for this one day
// only; the next day runs to the normal closing hour again.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readSettings(service: any, restaurantId: string): Promise<Record<string, unknown>> {
  const { data } = await service
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantId)
    .maybeSingle();
  return (data?.settings ?? {}) as Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeSettings(service: any, restaurantId: string, settings: Record<string, unknown>) {
  const { error } = await service.from("restaurants").update({ settings }).eq("id", restaurantId);
  return error ? { error: error.message as string } : null;
}

// Every date-based figure in the app is re-bucketed by a boundary change, so every
// reporting surface must be refreshed — a cached page would keep showing totals
// computed against the OLD boundary and quietly disagree with the rest of the system.
function refreshBusinessDaySurfaces(restaurantId: string) {
  revalidateRestaurantInfo(restaurantId);
  for (const p of [
    "/admin/settings",
    "/admin/dashboard",
    "/admin/finance",
    "/admin/stock",
    "/admin/purchases",
    "/admin/staff",
    "/employee/sales",
    "/employee/credits",
    "/employee/dashboard",
  ]) {
    revalidatePath(p);
  }
}

/** The day state the settings card shows, worked out on the server's clock. */
function businessDayState(settings: Record<string, unknown>, now = new Date()): BusinessDaySettings {
  const rule = businessDayRule(settings);
  const w = earlyCloseWindow(rule, now);
  const tomorrow = addBusinessDays(w.today, 1);
  return {
    closingHour: rule.hour,
    today: w.today,
    startedAt: w.startedAt.toISOString(),
    endsAt: businessDayStart(tomorrow, rule).toISOString(),
    previousDay: w.previous,
    previousClosedEarlyAt: w.previousClosedEarlyAt?.toISOString() ?? null,
    canReopen: w.canReopen,
    nextDay: tomorrow,
    canCloseNow: w.canClose,
    closableFrom: w.closableFrom.toISOString(),
  };
}

/**
 * Let the scheduler send these days' daily summaries again.
 *
 * A summary is sent once per day and then never again — so when a closing-hour
 * change or a reopen moves sales between days, an email already delivered for an
 * affected day goes on describing the old split. Dropping its delivery row puts
 * the day back in the queue: a day that has closed is re-sent on the next tick,
 * one still open goes out when it closes. Failed and abandoned rows are left as
 * they are — those are already in hand (or deliberately dropped).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requeueDailySummaries(service: any, restaurantId: string, from: string, to: string) {
  await service
    .from("report_deliveries")
    .delete()
    .eq("restaurant_id", restaurantId)
    .eq("period_type", "daily")
    .eq("status", "sent")
    .gte("period_key", from)
    .lte("period_key", to);
}

export async function getBusinessDaySettings(): Promise<BusinessDaySettings> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  return businessDayState(await readSettings(service, restaurantUser.restaurant_id));
}

export async function updateBusinessDaySettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const raw = ((formData.get("closing_hour") as string) || "").trim();
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { error: "Choose a valid closing time." };
  }

  const current = await readSettings(service, restaurantUser.restaurant_id);
  const next = { ...current, business_closing_hour: hour };
  const failed = await writeSettings(service, restaurantUser.restaurant_id, next);
  if (failed) return failed;

  // The days whose emailed summary the move can have made wrong: the last closed
  // day and today, under both the old hour and the new one. (Older days shift
  // too; their reports can be resent by hand from Report history.)
  const before = businessDayState(current);
  const after = businessDayState(next);
  if (before.closingHour !== after.closingHour) {
    const from = before.previousDay < after.previousDay ? before.previousDay : after.previousDay;
    const to = before.today > after.today ? before.today : after.today;
    await requeueDailySummaries(service, restaurantUser.restaurant_id, from, to);
  }

  refreshBusinessDaySurfaces(restaurantUser.restaurant_id);
  return { ok: true };
}

/** End the current business day right now. New sales count toward the next day. */
export async function closeBusinessDayNow(): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  const now = new Date();

  const current = await readSettings(service, restaurantUser.restaurant_id);
  const state = businessDayState(current, now);
  if (!state.canCloseNow) {
    return {
      error: "This business day has only just started — there is nothing to close yet.",
    };
  }

  const failed = await writeSettings(service, restaurantUser.restaurant_id, {
    ...current,
    business_early_closes: {
      ...normalizeEarlyCloses(current.business_early_closes),
      [state.today]: now.toISOString(),
    },
  });
  if (failed) return failed;

  refreshBusinessDaySurfaces(restaurantUser.restaurant_id);
  return { ok: true };
}

/**
 * Undo the most recent early close: the closed day runs to its normal closing
 * hour again, and anything sold since the close moves back onto it.
 */
export async function reopenBusinessDay(): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const current = await readSettings(service, restaurantUser.restaurant_id);
  const state = businessDayState(current);
  if (!state.previousClosedEarlyAt) return { error: "There is no early close to undo." };
  if (!state.canReopen) {
    return { error: "That day has already passed its normal closing time." };
  }

  const closes = normalizeEarlyCloses(current.business_early_closes);
  delete closes[state.previousDay];
  const failed = await writeSettings(service, restaurantUser.restaurant_id, {
    ...current,
    business_early_closes: closes,
  });
  if (failed) return failed;

  // Its summary may already have gone out at the early close; it is out of date
  // now, so send it again once the day really ends.
  await requeueDailySummaries(
    service,
    restaurantUser.restaurant_id,
    state.previousDay,
    state.previousDay
  );

  refreshBusinessDaySurfaces(restaurantUser.restaurant_id);
  return { ok: true };
}


// ─── Currency ─────────────────────────────────────────────────────────────────
// The symbol every amount in the app is shown with — menu, bills, finance, reports.
// Display only: amounts are stored as plain numbers, so switching currency relabels
// them without converting anything.

export async function getCurrencySetting(): Promise<string> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  return normalizeCurrency(data?.settings?.currency);
}

export async function updateCurrencySetting(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const raw = ((formData.get("currency") as string) || "").trim().toUpperCase();
  // normalizeCurrency would quietly turn a bad code into the default — refuse instead.
  if (normalizeCurrency(raw) !== raw) return { error: "Choose a currency from the list." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = { ...(rest?.settings ?? {}), currency: raw };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  revalidateRestaurantInfo(restaurantUser.restaurant_id);
  // Every money figure on every surface (admin, staff, customer menu) changes, so drop
  // the whole route cache rather than chase a list of paths that would go stale.
  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Daily financial-summary emails ───────────────────────────────────────────
// Owner opts in and lists up to three recipients. After the business day closes,
// a scheduled job (pg_cron → /api/cron/daily-summary) emails each restaurant's
// summary. No email configured ⇒ nothing is sent. The config lives in the
// settings jsonb; the shape is owned by lib/reports/daily-summary.ts.

export async function getDailySummarySettings(): Promise<DailySummaryConfig> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  return normalizeDailySummaryConfig(data?.settings?.daily_summary);
}

export async function updateDailySummarySettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const enabled = formData.get("enabled") === "1";

  // Up to three fixed slots. A blank slot is fine; a filled one must be a valid
  // address, so a typo is caught here rather than silently dropping a recipient.
  const seen = new Set<string>();
  const emails: string[] = [];
  for (let i = 0; i < MAX_SUMMARY_EMAILS; i++) {
    const raw = ((formData.get(`email_${i}`) as string) || "").trim();
    if (!raw) continue;
    if (!EMAIL_RE.test(raw)) {
      return { error: `“${raw}” is not a valid email address.` };
    }
    const key = raw.toLowerCase();
    if (seen.has(key)) continue; // ignore duplicates rather than erroring
    seen.add(key);
    emails.push(raw);
  }

  if (enabled && emails.length === 0) {
    return { error: "Add at least one email address, or turn the daily summary off." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = {
    ...(rest?.settings ?? {}),
    daily_summary: { enabled, emails },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  revalidatePath("/admin/settings");
  return { ok: true };
}

// ─── Daily Finance Report — delivery history + retry ──────────────────────────

export type ReportDeliveryRow = {
  businessDate: string;    // period_key (YYYY-MM-DD)
  generatedAt: string | null;
  sentAt: string | null;   // only meaningful when status === "sent"
  recipients: string[];
  status: "sent" | "failed";
  error: string | null;
  attempts: number;
};

// The recent daily-report deliveries for this restaurant, newest first. Admin-only
// (the report exposes takings), matching the rest of Settings.
//
// `period` narrows by `period_key` — the business date the REPORT covers, not
// when it was sent — so "This Week" means "the last 7 days of reports", matching
// what the row itself is about. Bounds come from `historyPeriodDateBounds`,
// which stays in YYYY-MM-DD string space end to end — `period_key` is a
// calendar day with no time component, and reconstructing a date string from a
// Date instant (`.toISOString().slice(0, 10)`) reads back in UTC, which can name
// the wrong Nepal day. See `business-day.ts`'s header note.
export async function getReportHistory(
  period: HistoryPeriod = "week",
  date: string | null = null,
  limit = 30
): Promise<ReportDeliveryRow[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("report_deliveries")
    .select("period_key, generated_at, sent_at, recipients, status, error, attempts")
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .eq("period_type", "daily");

  const { from, to } = historyPeriodDateBounds(period, restaurantUser.dayRule, date);
  if (from) query = query.gte("period_key", from);
  if (to) query = query.lt("period_key", to);

  const { data } = await query
    .order("period_key", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    businessDate: r.period_key,
    generatedAt: r.generated_at ?? null,
    sentAt: r.status === "sent" ? r.sent_at ?? null : null,
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    status: r.status === "sent" ? "sent" : "failed",
    error: r.error ?? null,
    attempts: Number(r.attempts ?? 0),
  }));
}

// Re-generate and re-send a single day's report on demand (the history "Retry"
// button). Admin-only; forces a resend even if a row exists. Rebuilds the PDF from
// live data so a retry reflects any corrections since the failure.
export async function retryReportDelivery(
  businessDate: string
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return { error: "Invalid report date." };
  }

  const outcome = await sendDailySummary(
    restaurantUser.restaurant_id,
    businessDate,
    restaurantUser.dayRule,
    { force: true }
  );

  revalidatePath("/admin/settings");

  if (outcome.status === "sent") return { ok: true };
  if (outcome.status === "skipped") {
    return { error: "Nothing to send — add at least one recipient and enable the daily summary." };
  }
  return { error: outcome.error || "Could not send the report. Please try again." };
}

// ─── Per-workstation Order-Ticket (OT) numbering ──────────────────────────────
// Each workstation keeps its OWN independent OT sequence (KOT-00125, BOT-00086, …). Same
// architecture as the bill number, but one counter per workstation. The prefix reuses the
// workstation's ticket_code (the code that already names the "Print KOT" button/header).

export type WorkstationNumbering = {
  id: string;
  name: string;
  /** The effective prefix shown/printed (explicit ticket_code, else derived from name). */
  prefix: string;
  /** Auto default if the admin clears the prefix. */
  defaultPrefix: string;
  /** The number the NEXT ticket for this station will use; null = OT numbering off. */
  next: number | null;
};

// Every workstation the restaurant has — existing AND any future one — so the Settings page
// lists them all without code changes.
export async function getWorkstationNumbering(): Promise<WorkstationNumbering[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("workstations")
    .select("id, name, ticket_code, ot_next, sort_order")
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .order("sort_order")
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    prefix: ticketCodeOf({ name: w.name, ticket_code: w.ticket_code }),
    defaultPrefix: defaultTicketCode(w.name),
    next: w.ot_next ?? null,
  }));
}

// Saves prefix + next-number for every workstation in one go. Reads the restaurant's own
// workstations from the DB (not a client-supplied list) and, for each, applies the matching
// `prefix_<id>` / `next_<id>` fields. Blank next = numbering off. Changing a number only
// moves that ONE workstation's future tickets; stamped tickets keep their numbers.
export async function updateWorkstationNumbering(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stations } = await (service as any)
    .from("workstations")
    .select("id, name")
    .eq("restaurant_id", restaurantUser.restaurant_id);

  const rows = ((stations ?? []) as { id: string; name: string }[]);

  for (const { id, name } of rows) {
    const prefixRaw = ((formData.get(`prefix_${id}`) as string) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nextRaw = ((formData.get(`next_${id}`) as string) || "").trim();

    let otNext: number | null = null;
    if (nextRaw !== "") {
      const n = Number(nextRaw);
      if (!Number.isInteger(n) || n < 0) return { error: "Each next number must be a whole number (0 or more)." };
      otNext = n;
    }

    // Every ticket this station has ever issued keeps its number forever, and two of its
    // tickets may never share one. Winding the counter back into already-issued territory
    // would therefore not renumber history — it would make the NEXT print fail outright,
    // at the counter, mid-service. Refuse it here, where it can still be explained.
    if (otNext !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: highest } = await (service as any)
        .from("order_tickets")
        .select("ot_number")
        .eq("workstation_id", id)
        .not("ot_number", "is", null)
        .order("ot_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const used = highest?.ot_number as number | undefined;
      if (used != null && otNext <= used) {
        return {
          error: `${name} has already issued number ${used}. Its next number must be ${used + 1} or higher.`,
        };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("workstations")
      .update({ ticket_code: prefixRaw || null, ot_next: otNext })
      .eq("id", id)
      .eq("restaurant_id", restaurantUser.restaurant_id);
    if (error) return { error: error.message };
  }

  // This form edits `ticket_code`, which is the prefix printed on every Order Ticket —
  // so a stale station list would keep printing the old code.
  revalidateWorkstations(restaurantUser.restaurant_id);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/workstations");
  return { ok: true };
}

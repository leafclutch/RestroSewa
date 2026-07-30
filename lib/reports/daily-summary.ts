import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { businessDayBounds } from "@/lib/business-day";
import { stockStatus } from "@/lib/stock";

// ─── Config (stored on restaurants.settings.daily_summary) ─────────────────────
// A restaurant opts in and lists up to three recipients. This module owns the
// shape so both the Settings action and the cron route normalise it identically.
// Kept in a PLAIN module (not the "use server" settings.ts) so the sync helpers
// below can be exported and imported without tripping the "server actions must be
// async" rule.

export const MAX_SUMMARY_EMAILS = 3;
// Deliberately loose — enough to catch a typo, not to arbitrate RFC 5322.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DailySummaryConfig = { enabled: boolean; emails: string[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDailySummaryConfig(raw: any): DailySummaryConfig {
  const obj = raw && typeof raw === "object" ? raw : {};
  const emails: string[] = Array.isArray(obj.emails)
    ? obj.emails
        .filter((e: unknown): e is string => typeof e === "string")
        .map((e: string) => e.trim())
        .filter((e: string) => EMAIL_RE.test(e))
        .slice(0, MAX_SUMMARY_EMAILS)
    : [];
  return { enabled: !!obj.enabled, emails };
}

// ─── The report model ──────────────────────────────────────────────────────────

export type DailySummaryModel = {
  businessDate: string; // YYYY-MM-DD (Nepal business day)
  hasOpening: boolean;

  openingCash: number;
  openingOnline: number;
  openingCreditToUs: number;
  openingCreditByUs: number;

  salesCash: number;
  salesOnline: number;
  salesCard: number;
  salesCredit: number;
  salesTotal: number;
  discounts: number;

  purchasesCash: number;
  purchasesOnline: number;
  purchasesCredit: number;
  purchasesTotal: number;

  vendorPayments: number;          // paid against vendor credit
  customerCreditCollected: number; // repayments received
  customerCreditCreated: number;
  vendorCreditCreated: number;
  customerCreditOutstanding: number;
  vendorCreditOutstanding: number;

  salaryPaid: number;    // salary_total (cash + online)
  salaryAdvance: number;

  closingCash: number;
  closingOnline: number;
  closingCreditToUs: number;
  closingCreditByUs: number;
  closingNet: number;    // cash + online

  estimatedProfit: number; // sales − purchase cost − salaries paid

  totalBills: number;   // payments finalised in the day
  totalOrders: number;  // kitchen order batches placed in the day
  inventoryValue: number; // closing stock valued at each product's last cost
  lowStock: number;
  outOfStock: number;
};

const num = (v: unknown) => Number(v ?? 0);

/**
 * Build one restaurant's summary for a single business day, from the same sources
 * the on-screen Finance report uses (`finance_report` RPC) plus a couple of
 * lightweight counts. No user context — the cron caller has no session, so the
 * restaurant is passed explicitly and the service client is used throughout.
 */
export async function buildDailySummary(
  restaurantId: string,
  businessDate: string,
  closingHour: number
): Promise<DailySummaryModel> {
  const { from, to } = businessDayBounds(businessDate, closingHour);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const service = createServiceClient();

  const [financeRes, paymentsRes, ordersRes, stockRes, productsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("finance_report", {
      p_restaurant_id: restaurantId,
      p_from: fromIso,
      p_to: toIso,
    }),
    // Bills (count) + discounts (sum) for the day — the two figures finance_report
    // doesn't carry. Same source as the Sales screen: the `payments` rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("payments")
      .select("discount_amount")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    // Kitchen order batches placed in the day.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("session_orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    // Closing stock per product for the day, to flag low/out.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("stock_report", {
      p_restaurant_id: restaurantId,
      p_from: fromIso,
      p_to: toIso,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("products")
      .select("id, low_stock_threshold, last_unit_cost, is_active")
      .eq("restaurant_id", restaurantId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (Array.isArray(financeRes.data) ? financeRes.data[0] : financeRes.data) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments = (paymentsRes.data ?? []) as any[];
  const totalBills = payments.length;
  const discounts = payments.reduce((s, p) => s + num(p.discount_amount), 0);

  const totalOrders = ordersRes.count ?? 0;

  // Low/out AND inventory value over ACTIVE products only, matching the Stock
  // screen's summary. Value what's on the shelf at what it last cost to buy;
  // negative (oversold) stock is valued at 0, never as a negative asset.
  const closingByProduct = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((stockRes.data ?? []) as any[])) {
    closingByProduct.set(r.product_id, num(r.closing));
  }
  let lowStock = 0;
  let outOfStock = 0;
  let inventoryValue = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((productsRes.data ?? []) as any[])) {
    if (!p.is_active) continue;
    const closing = closingByProduct.get(p.id) ?? 0;
    inventoryValue += Math.max(0, closing) * num(p.last_unit_cost);
    const st = stockStatus(closing, num(p.low_stock_threshold));
    if (st === "low") lowStock += 1;
    else if (st === "out") outOfStock += 1;
  }

  const salesTotal = num(f?.sales_total);
  const purchasesTotal = num(f?.purchases_total);
  const salaryPaid = num(f?.salary_total);
  const closingCash = num(f?.closing_cash);
  const closingOnline = num(f?.closing_online);

  return {
    businessDate,
    hasOpening: !!f?.has_opening,

    openingCash: num(f?.opening_cash),
    openingOnline: num(f?.opening_online),
    openingCreditToUs: num(f?.opening_credit_to_us),
    openingCreditByUs: num(f?.opening_credit_by_us),

    salesCash: num(f?.sales_cash),
    salesOnline: num(f?.sales_online),
    salesCard: num(f?.sales_card),
    salesCredit: num(f?.sales_credit),
    salesTotal,
    discounts,

    purchasesCash: num(f?.purchases_cash),
    purchasesOnline: num(f?.purchases_online),
    purchasesCredit: num(f?.purchases_credit),
    purchasesTotal,

    vendorPayments: num(f?.vendor_credit_paid),
    customerCreditCollected: num(f?.customer_credit_collected),
    customerCreditCreated: num(f?.customer_credit_created),
    vendorCreditCreated: num(f?.vendor_credit_created),
    customerCreditOutstanding: num(f?.customer_credit_outstanding),
    vendorCreditOutstanding: num(f?.vendor_credit_outstanding),

    salaryPaid,
    salaryAdvance: num(f?.salary_advance),

    closingCash,
    closingOnline,
    closingCreditToUs: num(f?.closing_credit_to_us),
    closingCreditByUs: num(f?.closing_credit_by_us),
    closingNet: closingCash + closingOnline,

    // Estimated, not booked: bought-stock cost is used, not stock consumed, so a
    // heavy-stocking day reads low and a run-down day reads high. Labelled as an
    // estimate in the email for exactly that reason.
    estimatedProfit: salesTotal - purchasesTotal - salaryPaid,

    totalBills,
    totalOrders,
    inventoryValue,
    lowStock,
    outOfStock,
  };
}

// ─── Email rendering ───────────────────────────────────────────────────────────

const money = (n: number) =>
  `NPR ${(Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function prettyDate(businessDate: string): string {
  // businessDate is already the Nepal business day; format it as a plain date
  // (no timezone maths — it's a wall-clock day string).
  const [y, m, d] = businessDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A SHORT, professional covering email. The full report is the attached PDF, so
 * the body just orients the reader and highlights two headline numbers. Subject
 * follows the requested format exactly. Self-contained inline styles (no external
 * CSS/images — clients strip both); plain-text fallback included.
 */
export function renderDailySummaryEmail(
  m: DailySummaryModel,
  restaurantName: string
): { subject: string; html: string; text: string } {
  const date = prettyDate(m.businessDate);
  // En-dash separators, per the requested subject format.
  const subject = `Daily Financial Summary – ${restaurantName} – ${date}`;
  const profitColor = m.estimatedProfit >= 0 ? "#15803d" : "#b91c1c";

  const highlight = (label: string, value: string, color = "#0f172a") => `
    <td style="padding:12px 14px;background:#f8fafc;border-radius:10px;">
      <div style="font-size:12px;color:#64748b;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color};margin-top:2px;white-space:nowrap;">${value}</div>
    </td>`;

  const html = `<div style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr>
      <td style="padding:22px 24px;background:#0d253d;">
        <div style="font-size:17px;font-weight:600;color:#ffffff;">${restaurantName}</div>
        <div style="font-size:13px;color:#93c5fd;margin-top:2px;">Daily Financial Summary · ${date}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px 6px;">
        <p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.55;">Hello,</p>
        <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.55;">
          Your financial report for <strong>${date}</strong> is ready. The attached PDF has the full day's
          figures — opening &amp; closing balances, sales, purchases, credit, estimated profit and stock —
          formatted for printing or your accountant.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${highlight("Total sales", money(m.salesTotal))}
            <td style="width:12px;"></td>
            ${highlight("Estimated profit", money(m.estimatedProfit), profitColor)}
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px 22px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Sent automatically by HRestroSewa after your business day closed. Estimated profit is based on stock purchased, not stock consumed.</p>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    `${restaurantName} — Daily Financial Summary`,
    date,
    "",
    `Your financial report for ${date} is ready. The full breakdown is in the attached PDF.`,
    "",
    `Total sales:      ${money(m.salesTotal)}`,
    `Estimated profit: ${money(m.estimatedProfit)}`,
    "",
    "Sent automatically by HRestroSewa after your business day closed.",
  ].join("\n");

  return { subject, html, text };
}

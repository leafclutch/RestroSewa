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
      .select("id, low_stock_threshold, is_active")
      .eq("restaurant_id", restaurantId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (Array.isArray(financeRes.data) ? financeRes.data[0] : financeRes.data) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments = (paymentsRes.data ?? []) as any[];
  const totalBills = payments.length;
  const discounts = payments.reduce((s, p) => s + num(p.discount_amount), 0);

  const totalOrders = ordersRes.count ?? 0;

  // Low/out over ACTIVE products only, matching the Stock screen's summary.
  const closingByProduct = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((stockRes.data ?? []) as any[])) {
    closingByProduct.set(r.product_id, num(r.closing));
  }
  let lowStock = 0;
  let outOfStock = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((productsRes.data ?? []) as any[])) {
    if (!p.is_active) continue;
    const st = stockStatus(closingByProduct.get(p.id) ?? 0, num(p.low_stock_threshold));
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

type Row = { label: string; value: string; strong?: boolean };

function section(title: string, rows: Row[]): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 0;color:#475569;font-size:14px;">${r.label}</td>
        <td style="padding:6px 0;text-align:right;font-size:14px;color:#0f172a;font-weight:${r.strong ? 600 : 400};white-space:nowrap;">${r.value}</td>
      </tr>`
    )
    .join("");
  return `
    <tr><td colspan="2" style="padding:18px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;font-weight:600;">${title}</td></tr>
    ${body}`;
}

/**
 * A self-contained, inline-styled HTML email plus a plain-text fallback. No
 * external CSS or images — email clients strip both.
 */
export function renderDailySummaryEmail(
  m: DailySummaryModel,
  restaurantName: string
): { subject: string; html: string; text: string } {
  const date = prettyDate(m.businessDate);
  const subject = `${restaurantName} — Daily Summary, ${date}`;
  const profitColor = m.estimatedProfit >= 0 ? "#15803d" : "#b91c1c";

  const html = `<!-- daily summary -->
<div style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr>
      <td style="padding:22px 24px;background:#0d253d;">
        <div style="font-size:18px;font-weight:600;color:#ffffff;">${restaurantName}</div>
        <div style="font-size:13px;color:#93c5fd;margin-top:2px;">Daily financial summary · ${date}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${m.estimatedProfit >= 0 ? "#f0fdf4" : "#fef2f2"};border-radius:10px;">
          <tr>
            <td style="padding:14px 16px;font-size:13px;color:#475569;">Estimated profit <span style="color:#94a3b8;">(sales − purchases − salaries)</span></td>
            <td style="padding:14px 16px;text-align:right;font-size:20px;font-weight:700;color:${profitColor};white-space:nowrap;">${money(m.estimatedProfit)}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 24px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${section("Opening balance", [
            { label: "Cash", value: money(m.openingCash) },
            { label: "Online / bank", value: money(m.openingOnline) },
            { label: "Owed to us", value: money(m.openingCreditToUs) },
            { label: "Owed by us", value: money(m.openingCreditByUs) },
          ])}
          ${section("Sales", [
            { label: "Cash", value: money(m.salesCash) },
            { label: "Online", value: money(m.salesOnline) },
            { label: "Card", value: money(m.salesCard) },
            { label: "Credit (billed, not collected)", value: money(m.salesCredit) },
            { label: "Total sales", value: money(m.salesTotal), strong: true },
            { label: "Discounts given", value: money(m.discounts) },
          ])}
          ${section("Purchases & expenses", [
            { label: "Purchases — cash", value: money(m.purchasesCash) },
            { label: "Purchases — online", value: money(m.purchasesOnline) },
            { label: "Purchases — credit", value: money(m.purchasesCredit) },
            { label: "Total purchases", value: money(m.purchasesTotal), strong: true },
            { label: "Vendor payments", value: money(m.vendorPayments) },
            { label: "Salaries paid", value: money(m.salaryPaid) },
            { label: "Salary advances", value: money(m.salaryAdvance) },
          ])}
          ${section("Credit", [
            { label: "Customer credit collected", value: money(m.customerCreditCollected) },
            { label: "New customer credit", value: money(m.customerCreditCreated) },
            { label: "Owed to us (total)", value: money(m.customerCreditOutstanding) },
            { label: "Owed by us (total)", value: money(m.vendorCreditOutstanding) },
          ])}
          ${section("Closing balance", [
            { label: "Cash", value: money(m.closingCash) },
            { label: "Online / bank", value: money(m.closingOnline) },
            { label: "Net (cash + bank)", value: money(m.closingNet), strong: true },
          ])}
          ${section("Operations", [
            { label: "Total bills", value: String(m.totalBills) },
            { label: "Total orders", value: String(m.totalOrders) },
            { label: "Low stock items", value: String(m.lowStock) },
            { label: "Out of stock items", value: String(m.outOfStock) },
          ])}
        </table>
        ${m.hasOpening ? "" : `<p style="margin:16px 0 0;font-size:12px;color:#b45309;">No opening balance is set, so balances start from zero. Set one in Finance for accurate carry-forward.</p>`}
        <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;">Sent automatically after your business day closed. Profit is an estimate based on stock purchased, not stock consumed.</p>
      </td>
    </tr>
  </table>
</div>`;

  const line = (label: string, value: string) => `${label}: ${value}`;
  const text = [
    `${restaurantName} — Daily financial summary`,
    date,
    "",
    `ESTIMATED PROFIT: ${money(m.estimatedProfit)} (sales − purchases − salaries)`,
    "",
    "OPENING BALANCE",
    line("  Cash", money(m.openingCash)),
    line("  Online/bank", money(m.openingOnline)),
    line("  Owed to us", money(m.openingCreditToUs)),
    line("  Owed by us", money(m.openingCreditByUs)),
    "",
    "SALES",
    line("  Cash", money(m.salesCash)),
    line("  Online", money(m.salesOnline)),
    line("  Card", money(m.salesCard)),
    line("  Credit (billed)", money(m.salesCredit)),
    line("  Total sales", money(m.salesTotal)),
    line("  Discounts given", money(m.discounts)),
    "",
    "PURCHASES & EXPENSES",
    line("  Total purchases", money(m.purchasesTotal)),
    line("  Vendor payments", money(m.vendorPayments)),
    line("  Salaries paid", money(m.salaryPaid)),
    line("  Salary advances", money(m.salaryAdvance)),
    "",
    "CREDIT",
    line("  Customer credit collected", money(m.customerCreditCollected)),
    line("  Owed to us (total)", money(m.customerCreditOutstanding)),
    line("  Owed by us (total)", money(m.vendorCreditOutstanding)),
    "",
    "CLOSING BALANCE",
    line("  Cash", money(m.closingCash)),
    line("  Online/bank", money(m.closingOnline)),
    line("  Net (cash + bank)", money(m.closingNet)),
    "",
    "OPERATIONS",
    line("  Total bills", String(m.totalBills)),
    line("  Total orders", String(m.totalOrders)),
    line("  Low stock items", String(m.lowStock)),
    line("  Out of stock items", String(m.outOfStock)),
  ].join("\n");

  return { subject, html, text };
}

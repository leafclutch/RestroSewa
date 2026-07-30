import "server-only";
import { ReportPdf, type ReportLogo } from "./pdf/report-document";
import type { DailySummaryModel } from "./daily-summary";

// The daily report's PDF layout. All financial figures the owner asked for, grouped
// into sections, rendered through the reusable ReportPdf chrome (branded header +
// page-numbered HRestroSewa footer). A weekly/monthly report is the same shape with
// its own model + groups — the chrome and page-numbering are shared.

const money = (n: number) =>
  `NPR ${(Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function prettyDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function renderDailySummaryPdf(
  m: DailySummaryModel,
  opts: { restaurantName: string; logo?: ReportLogo | null }
): Promise<Uint8Array> {
  const pdf = await ReportPdf.create({
    title: "Daily Financial Summary",
    restaurantName: opts.restaurantName,
    subtitle: `Business date: ${prettyDate(m.businessDate)}`,
    logo: opts.logo ?? null,
  });

  pdf.sectionTitle("Opening Balance");
  pdf.row("Cash", money(m.openingCash));
  pdf.row("Online / Bank", money(m.openingOnline));
  pdf.row("Credit to us (receivable)", money(m.openingCreditToUs));
  pdf.row("Credit by us (payable)", money(m.openingCreditByUs));

  // A mixed (cash + online) bill is NOT its own line: its cash part is already in
  // "Cash sales" and its online part in "Online sales" (finance_report sums the
  // cash_amount / online_amount columns across every payment, mixed included). A
  // separate "Mixed" row would double-count it and break the section's total.
  pdf.sectionTitle("Sales");
  pdf.row("Cash sales", money(m.salesCash));
  pdf.row("Online sales", money(m.salesOnline));
  pdf.row("Card sales", money(m.salesCard));
  pdf.row("Credit sales (billed, not collected)", money(m.salesCredit));
  pdf.row("Total sales", money(m.salesTotal), { strong: true });
  pdf.row("Total discounts", money(m.discounts));

  pdf.sectionTitle("Purchases & Expenses");
  pdf.row("Purchases - cash", money(m.purchasesCash));
  pdf.row("Purchases - online", money(m.purchasesOnline));
  pdf.row("Purchases - credit", money(m.purchasesCredit));
  pdf.row("Total purchases", money(m.purchasesTotal), { strong: true });
  pdf.row("Vendor payments", money(m.vendorPayments));
  pdf.row("New vendor credit", money(m.vendorCreditCreated));
  pdf.row("Salaries paid", money(m.salaryPaid));
  pdf.row("Salary advances", money(m.salaryAdvance));

  pdf.sectionTitle("Credit");
  pdf.row("Customer credit collected", money(m.customerCreditCollected));
  pdf.row("New customer credit", money(m.customerCreditCreated));
  pdf.row("Customer credit outstanding", money(m.customerCreditOutstanding));
  pdf.row("Vendor credit outstanding", money(m.vendorCreditOutstanding));

  pdf.sectionTitle("Closing Balance");
  pdf.row("Cash", money(m.closingCash));
  pdf.row("Online / Bank", money(m.closingOnline));
  pdf.row("Credit to us (receivable)", money(m.closingCreditToUs));
  pdf.row("Credit by us (payable)", money(m.closingCreditByUs));
  pdf.row("Net balance (cash + bank)", money(m.closingNet), { strong: true });

  pdf.sectionTitle("Estimated Profit");
  pdf.row("Sales - purchases - salaries", money(m.estimatedProfit), { strong: true });

  pdf.sectionTitle("Operations");
  pdf.row("Total bills", String(m.totalBills));
  pdf.row("Total orders", String(m.totalOrders));

  pdf.sectionTitle("Inventory");
  pdf.row("Inventory value", money(m.inventoryValue));
  pdf.row("Low stock items", String(m.lowStock));
  pdf.row("Out of stock items", String(m.outOfStock));

  if (!m.hasOpening) {
    pdf.spacer(10);
    pdf.note(
      "Note: no opening balance is set for this restaurant, so balances start from zero. Set one in Finance for accurate carry-forward."
    );
  }
  pdf.spacer(8);
  pdf.note(
    "Estimated profit is based on stock purchased during the day, not stock consumed, so a heavy-stocking day reads low and a run-down day reads high."
  );

  return pdf.finalize();
}

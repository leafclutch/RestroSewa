// Shared credit vocabulary + math. Kept out of the "use server" action files so
// both the Credits screen and the Sales dashboard derive their figures from the
// exact same code — the two can never disagree about what a customer owes.

export type CreditStatus = "pending" | "partially_paid" | "fully_paid";

export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  pending: "Pending",
  partially_paid: "Partially Paid",
  fully_paid: "Fully Paid",
};

export const CREDIT_STATUS_COLOR: Record<CreditStatus, string> = {
  pending: "#dc2626",        // owes the full amount
  partially_paid: "#f97316", // owes some
  fully_paid: "#1a7a4a",     // settled
};

// How a bill was settled, for the Sales transaction list.
export type BillSettlement = "paid" | "partial_credit" | "full_credit";

export const SETTLEMENT_LABEL: Record<BillSettlement, string> = {
  paid: "Paid",
  partial_credit: "Partial (Credit)",
  full_credit: "On Credit",
};

export const SETTLEMENT_COLOR: Record<BillSettlement, string> = {
  paid: "#1a7a4a",
  partial_credit: "#f97316",
  full_credit: "#dc2626",
};

// Money is stored numeric(10,2); compare with a sub-paisa epsilon so float
// round-tripping never leaves a credit looking 0.001 short of settled.
const EPS = 0.005;

export const isSettled = (billAmount: number, paidAmount: number) =>
  billAmount - paidAmount <= EPS;

/** The rows these stats are computed from (a subset of the DB columns). */
export type CreditStatRow = {
  bill_amount: number;
  down_payment: number;
  paid_amount: number;
  status: CreditStatus;
  created_at: string;
};

export type CreditRepaymentRow = {
  amount: number;
  created_at: string;
};

export type CreditStats = {
  /** Still owed across every open credit, as of now. Not period-scoped — a debt
   *  doesn't belong to the window it was created in. */
  outstanding: number;
  /** Repayments banked inside the selected period ("Credit Collected Today"). */
  collected: number;
  /** Credit *extended* inside the period: the unpaid part of bills closed on
   *  credit during it. This is new debt taken on, not money received. */
  created: number;
  /** Current status counts across all credits. */
  pendingCount: number;
  partiallyPaidCount: number;
  fullyPaidCount: number;
  /** How many credits are still open (pending + partially paid). */
  openCount: number;
};

export function computeCreditStats(
  credits: CreditStatRow[],
  repayments: CreditRepaymentRow[],
  fromMs: number,
  toMs: number
): CreditStats {
  const stats: CreditStats = {
    outstanding: 0,
    collected: 0,
    created: 0,
    pendingCount: 0,
    partiallyPaidCount: 0,
    fullyPaidCount: 0,
    openCount: 0,
  };

  for (const c of credits) {
    const bill = Number(c.bill_amount);
    const paid = Number(c.paid_amount);
    const balance = Math.max(0, bill - paid);

    if (c.status === "fully_paid") {
      stats.fullyPaidCount += 1;
    } else {
      // Outstanding is a "right now" figure, so every open credit counts
      // regardless of when it was created.
      stats.outstanding += balance;
      stats.openCount += 1;
      if (c.status === "pending") stats.pendingCount += 1;
      else stats.partiallyPaidCount += 1;
    }

    // Credit extended during the period = the part of that bill left unpaid at
    // the moment it was billed (bill − down payment), not its balance today.
    const ts = new Date(c.created_at).getTime();
    if (ts >= fromMs && ts <= toMs) {
      stats.created += Math.max(0, bill - Number(c.down_payment));
    }
  }

  for (const p of repayments) {
    const ts = new Date(p.created_at).getTime();
    if (ts >= fromMs && ts <= toMs) stats.collected += Number(p.amount);
  }

  return stats;
}

/**
 * How a bill was settled, from its payment row. A `credit` bill records the full
 * value in total_amount and only what was actually handed over in the tender
 * split — so the gap between them is what went on credit.
 */
export function settlementOf(payment: {
  payment_method: string;
  total_amount: number;
  cash_amount: number;
  online_amount: number;
  card_amount: number;
}): BillSettlement {
  if (payment.payment_method !== "credit") return "paid";
  const tendered =
    Number(payment.cash_amount) + Number(payment.online_amount) + Number(payment.card_amount);
  return tendered > EPS ? "partial_credit" : "full_credit";
}

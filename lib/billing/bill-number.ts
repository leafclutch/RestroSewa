// How a restaurant's sequential bill number is shown on a printed bill.
//
// The number itself is a plain integer stamped on each `payments` row (see the
// assign_bill_number trigger). These helpers are only about PRESENTATION — the label
// ("Bill No" vs "Order No") and optional zero-padding ("125" → "000125") — both of which
// a restaurant configures in Admin → Settings. Kept in one place so the admin preview and
// the printed bill can never format the same number differently.

export type BillNumberLabel = "bill" | "order";

/** Zero-pad to a minimum width; pad ≤ 0 (or absent) leaves the number as-is. */
export function formatBillNumber(n: number, pad = 0): string {
  const s = String(n);
  return pad > 0 ? s.padStart(pad, "0") : s;
}

/** The line label on the bill: "Bill No" or "Order No". */
export function billNumberLabel(label?: BillNumberLabel | null): string {
  return label === "order" ? "Order No" : "Bill No";
}

/** Coerce a stored/form value to a valid label, defaulting to "bill". */
export function normalizeBillLabel(v: unknown): BillNumberLabel {
  return v === "order" ? "order" : "bill";
}
